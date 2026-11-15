//! Frames to a video: RGBA to yuv420p here, in parallel with the rendering, then ffmpeg encodes.

use mrc_core::Pixmap;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::mpsc::{SyncSender, sync_channel};
use std::thread::JoinHandle;

/// ffmpeg, from MR_CAST_FFMPEG or the PATH.
fn ffmpeg() -> String {
    std::env::var("MR_CAST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

/// A frame as yuv420p, BT.601 limited range: what ffmpeg's default conversion of Remotion's RGB frames gives.
/// Two rows at a time, so each chroma sample averages its 2x2 block in the same pass. Frames are opaque, so the
/// premultiplied pixels are the colours.
pub fn yuv420(p: &Pixmap, out: &mut Vec<u8>) {
    let (w, h) = (p.width() as usize, p.height() as usize);
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    out.resize(w * h + 2 * cw * ch, 0);
    let (ys, uv) = out.split_at_mut(w * h);
    let (us, vs) = uv.split_at_mut(cw * ch);
    let px = p.data();
    #[inline(always)]
    fn luma(r: i32, g: i32, b: i32) -> u8 {
        ((16829 * r + 33039 * g + 6416 * b + (16 << 16) + 32768) >> 16) as u8
    }
    // Even widths and heights take the fast path; any odd edge repeats its last pixel. Luma and chroma run as
    // separate simple loops, which the compiler vectorizes.
    if w % 2 == 0 && h % 2 == 0 {
        for (yrow, row) in ys.chunks_exact_mut(w).zip(px.chunks_exact(w * 4)) {
            for (y, p) in yrow.iter_mut().zip(row.as_chunks::<4>().0) {
                *y =
                    ((16829 * p[0] as u32 + 33039 * p[1] as u32 + 6416 * p[2] as u32 + (16 << 16) + 32768) >> 16) as u8;
            }
        }
        let mut sums = vec![[0u32; 3]; cw];
        for (cy, (urow, vrow)) in us.chunks_exact_mut(cw).zip(vs.chunks_exact_mut(cw)).enumerate() {
            let r0 = &px[2 * cy * w * 4..(2 * cy + 1) * w * 4];
            let r1 = &px[(2 * cy + 1) * w * 4..(2 * cy + 2) * w * 4];
            for ((s, a), b) in sums.iter_mut().zip(r0.as_chunks::<8>().0).zip(r1.as_chunks::<8>().0) {
                for c in 0..3 {
                    s[c] = a[c] as u32 + a[c + 4] as u32 + b[c] as u32 + b[c + 4] as u32;
                }
            }
            for ((s, u), v) in sums.iter().zip(urow.iter_mut()).zip(vrow.iter_mut()) {
                let (r, g, b) = (s[0] as i32, s[1] as i32, s[2] as i32);
                // The sums are four pixels: scale the coefficients down by four with the rounding.
                *u = ((-9714 * r - 19070 * g + 28784 * b + (512 << 16) + 131072) >> 18).clamp(0, 255) as u8;
                *v = ((28784 * r - 24103 * g - 4681 * b + (512 << 16) + 131072) >> 18).clamp(0, 255) as u8;
            }
        }
        return;
    }
    for cy in 0..ch {
        let y0 = cy * 2;
        let y1 = (y0 + 1).min(h - 1);
        let r0 = &px[y0 * w * 4..(y0 + 1) * w * 4];
        let r1 = &px[y1 * w * 4..(y1 + 1) * w * 4];
        let (ya, yb) = ys[y0 * w..].split_at_mut(w);
        let urow = &mut us[cy * cw..(cy + 1) * cw];
        let vrow = &mut vs[cy * cw..(cy + 1) * cw];
        for cx in 0..cw {
            let x0 = cx * 2;
            let x1 = (x0 + 1).min(w - 1);
            let (a, b, c, d) =
                (&r0[x0 * 4..x0 * 4 + 3], &r0[x1 * 4..x1 * 4 + 3], &r1[x0 * 4..x0 * 4 + 3], &r1[x1 * 4..x1 * 4 + 3]);
            let px = |p: &[u8]| (p[0] as i32, p[1] as i32, p[2] as i32);
            let (pa, pb, pc, pd) = (px(a), px(b), px(c), px(d));
            ya[x0] = luma(pa.0, pa.1, pa.2);
            if x1 != x0 {
                ya[x1] = luma(pb.0, pb.1, pb.2);
            }
            if y1 != y0 {
                yb[x0] = luma(pc.0, pc.1, pc.2);
                if x1 != x0 {
                    yb[x1] = luma(pd.0, pd.1, pd.2);
                }
            }
            let r = (pa.0 + pb.0 + pc.0 + pd.0 + 2) >> 2;
            let g = (pa.1 + pb.1 + pc.1 + pd.1 + 2) >> 2;
            let b = (pa.2 + pb.2 + pc.2 + pd.2 + 2) >> 2;
            urow[cx] = ((-9714 * r - 19070 * g + 28784 * b + (128 << 16) + 32768) >> 16).clamp(0, 255) as u8;
            vrow[cx] = ((28784 * r - 24103 * g - 4681 * b + (128 << 16) + 32768) >> 16).clamp(0, 255) as u8;
        }
    }
}

/// Where frames go: an ffmpeg process fed by a writer thread, or nowhere (to time rendering alone).
pub struct Sink {
    /// Whether frames carry timestamps, so repeats can be left out.
    pub vfr: bool,
    /// Frame buffers the writer has finished with, for the next frames to reuse.
    pub pool: std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>>,
    tx: Option<SyncSender<(u64, Arc<Vec<u8>>)>>,
    writer: Option<JoinHandle<Result<(), String>>>,
    child: Option<Child>,
}

impl Sink {
    pub fn open(encoder: &str, out: &str, w: u32, h: u32, vfr: bool) -> Result<Sink, String> {
        let codec: &[&str] = match encoder {
            "none" => return Ok(Sink { vfr: true, pool: Default::default(), tx: None, writer: None, child: None }),
            "x264" => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"],
            "x264-ultrafast" => &["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18"],
            "x264-superfast" => &["-c:v", "libx264", "-preset", "superfast", "-crf", "18"],
            "videotoolbox" => &["-c:v", "h264_videotoolbox", "-b:v", "6M", "-profile:v", "high"],
            "copy" => &["-c:v", "copy"],
            other => return Err(format!("unknown encoder {other}; use x264, videotoolbox or none")),
        };
        let size = format!("{w}x{h}");
        let mut child = Command::new(ffmpeg())
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(if vfr {
                vec!["-f", "matroska", "-i", "-", "-fps_mode", "passthrough", "-video_track_timescale", "30"]
            } else {
                vec!["-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", &size, "-r", "30", "-i", "-"]
            })
            .args(codec)
            // B-frames reorder packets, and the mp4 muxer then gets a timestamped stream's durations wrong.
            .args(if vfr && encoder != "copy" { &["-bf", "0"][..] } else { &[][..] })
            .args([
                "-pix_fmt",
                "yuv420p",
                "-color_range",
                "tv",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "iec61966-2-1",
                "-movflags",
                "+faststart",
                out,
            ])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("starting {}: {e}", ffmpeg()))?;
        let mut stdin: ChildStdin = child.stdin.take().unwrap();
        if vfr {
            stdin.write_all(&crate::mkv::header(w, h)).map_err(|e| format!("writing to ffmpeg: {e}"))?;
        }
        let (tx, rx) = sync_channel::<(u64, Arc<Vec<u8>>)>(64);
        let pool: std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>> = Default::default();
        let back = pool.clone();
        let writer = std::thread::spawn(move || {
            for (n, frame) in rx {
                if vfr {
                    stdin
                        .write_all(&crate::mkv::frame_head(n, frame.len()))
                        .map_err(|e| format!("writing to ffmpeg: {e}"))?;
                }
                stdin.write_all(&frame).map_err(|e| format!("writing to ffmpeg: {e}"))?;
                if let Ok(buf) = Arc::try_unwrap(frame) {
                    back.lock().unwrap().push(buf);
                }
            }
            Ok(())
        });
        Ok(Sink { vfr, pool, tx: Some(tx), writer: Some(writer), child: Some(child) })
    }

    /// Sends frame number `n` (from the video's first frame).
    pub fn write(&mut self, n: u64, frame: Arc<Vec<u8>>) -> Result<(), String> {
        match &self.tx {
            Some(tx) => tx.send((n, frame)).map_err(|_| "ffmpeg stopped reading frames".to_string()),
            None => {
                if let Ok(buf) = Arc::try_unwrap(frame) {
                    self.pool.lock().unwrap().push(buf);
                }
                Ok(())
            }
        }
    }

    pub fn finish(mut self) -> Result<(), String> {
        drop(self.tx.take());
        if let Some(w) = self.writer.take() {
            w.join().map_err(|_| "writer thread panicked")??;
        }
        if let Some(mut c) = self.child.take() {
            let status = c.wait().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(format!("ffmpeg exited with {status}"));
            }
        }
        Ok(())
    }
}
