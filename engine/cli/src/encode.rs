//! Frames to a video: RGBA to yuv420p here, in parallel with the rendering, then ffmpeg encodes.

use mrc_core::Pixmap;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::thread::JoinHandle;

/// ffmpeg, from MR_CAST_FFMPEG or the PATH.
fn ffmpeg() -> String {
    std::env::var("MR_CAST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

/// A frame as yuv420p, BT.601 limited range: what ffmpeg's default conversion of Remotion's RGB frames gives.
pub fn yuv420(p: &Pixmap) -> Vec<u8> {
    let (w, h) = (p.width() as usize, p.height() as usize);
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    let mut out = vec![0u8; w * h + 2 * cw * ch];
    let (ys, uv) = out.split_at_mut(w * h);
    let (us, vs) = uv.split_at_mut(cw * ch);
    let px = p.data();
    // Fixed-point BT.601 limited-range coefficients, scaled by 2^16.
    let y_of = |r: i32, g: i32, b: i32| ((16829 * r + 33039 * g + 6416 * b + (16 << 16) + 32768) >> 16) as u8;
    for y in 0..h {
        let row = &px[y * w * 4..(y + 1) * w * 4];
        for x in 0..w {
            let i = x * 4;
            ys[y * w + x] = y_of(row[i] as i32, row[i + 1] as i32, row[i + 2] as i32);
        }
    }
    for cy in 0..ch {
        for cx in 0..cw {
            let (mut r, mut g, mut b, mut n) = (0, 0, 0, 0);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let (x, y) = (cx * 2 + dx, cy * 2 + dy);
                if x < w && y < h {
                    let i = (y * w + x) * 4;
                    r += px[i] as i32;
                    g += px[i + 1] as i32;
                    b += px[i + 2] as i32;
                    n += 1;
                }
            }
            let (r, g, b) = (r / n, g / n, b / n);
            us[cy * cw + cx] = ((-9714 * r - 19070 * g + 28784 * b + (128 << 16) + 32768) >> 16).clamp(0, 255) as u8;
            vs[cy * cw + cx] = ((28784 * r - 24103 * g - 4681 * b + (128 << 16) + 32768) >> 16).clamp(0, 255) as u8;
        }
    }
    out
}

/// Where frames go: an ffmpeg process fed by a writer thread, or nowhere (to time rendering alone).
pub struct Sink {
    tx: Option<SyncSender<Vec<u8>>>,
    writer: Option<JoinHandle<Result<(), String>>>,
    child: Option<Child>,
}

impl Sink {
    pub fn open(encoder: &str, out: &str, w: u32, h: u32) -> Result<Sink, String> {
        let codec: &[&str] = match encoder {
            "none" => return Ok(Sink { tx: None, writer: None, child: None }),
            "x264" => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"],
            "videotoolbox" => &["-c:v", "h264_videotoolbox", "-b:v", "6M", "-profile:v", "high"],
            other => return Err(format!("unknown encoder {other}; use x264, videotoolbox or none")),
        };
        let size = format!("{w}x{h}");
        let mut child = Command::new(ffmpeg())
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "yuv420p",
                "-s",
                &size,
                "-r",
                "30",
                "-i",
                "-",
            ])
            .args(codec)
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
        let (tx, rx) = sync_channel::<Vec<u8>>(64);
        let writer = std::thread::spawn(move || {
            for frame in rx {
                stdin.write_all(&frame).map_err(|e| format!("writing to ffmpeg: {e}"))?;
            }
            Ok(())
        });
        Ok(Sink { tx: Some(tx), writer: Some(writer), child: Some(child) })
    }

    pub fn write(&mut self, frame: Vec<u8>) -> Result<(), String> {
        match &self.tx {
            Some(tx) => tx.send(frame).map_err(|_| "ffmpeg stopped reading frames".to_string()),
            None => Ok(()),
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
