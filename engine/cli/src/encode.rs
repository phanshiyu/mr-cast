//! Frames to an MP4. The frames that change are split into one run per core; each run renders and encodes on its
//! own, starting on an IDR frame, and the runs' samples are joined in order. A frame that repeats the frame before
//! is not encoded: the sample before lasts longer (a variable frame rate), unless every frame is asked for.

use crate::{aac, h264, mp4};
use mrc_core::Pixmap;
use rayon::prelude::*;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};

/// A frame as yuv420p, BT.601 limited range, as ffmpeg converted Remotion's RGB frames.
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

/// One sample of the video: a frame and how long it shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Key {
    /// The frame to draw.
    pub frame: u32,
    /// Frames since the video's first.
    pub time: u64,
    pub duration: u32,
    /// It draws something the frame before did not, so it is rendered rather than copied.
    pub fresh: bool,
}

/// The samples of a video of `frames` whose fingerprints are `prints`. With `every`, each frame is a sample;
/// otherwise a frame that repeats the one before only makes the sample before it longer.
pub fn keys(frames: &[u32], prints: &[u64], every: bool) -> Vec<Key> {
    let mut out: Vec<Key> = Vec::new();
    for (i, &n) in frames.iter().enumerate() {
        let fresh = i == 0 || prints[i] != prints[i - 1];
        let time = (n - frames[0]) as u64;
        if let Some(last) = out.last_mut() {
            last.duration = (time - last.time) as u32;
        }
        if every || fresh || i == 0 {
            out.push(Key { frame: n, time, duration: 1, fresh });
        }
    }
    if let Some(last) = out.last_mut() {
        last.duration = (frames[frames.len() - 1] - frames[0]) - last.time as u32 + 1;
    }
    out
}

/// Splits the samples into at most `n` runs of about equal work: each starts on an IDR frame, so runs are at least
/// about ten seconds of changing frames long.
pub fn runs(keys: &[Key], n: usize) -> Vec<std::ops::Range<usize>> {
    let fresh: Vec<usize> = keys.iter().enumerate().filter(|k| k.1.fresh).map(|k| k.0).collect();
    let n = n.clamp(1, (fresh.len() / 300).max(1));
    let mut out = Vec::new();
    let mut start = 0;
    for r in 1..n {
        // A run starts at a frame that changes, so its IDR frame is one that would cost much anyway.
        let at = fresh[fresh.len() * r / n];
        if at > start {
            out.push(start..at);
            start = at;
        }
    }
    out.push(start..keys.len());
    out
}

/// What the MP4 holds besides the frames.
#[derive(Default)]
pub struct Extras {
    pub voice: Option<crate::audio::Voice>,
    pub chapters: Vec<mp4::Chapter>,
}

/// The AAC bit rate of the voice-over: speech, mono.
const VOICE_BITRATE: u32 = 96_000;

/// Draws a frame into a yuv buffer; called on any thread.
pub type Draw<'a> = dyn Fn(u32, &mut Vec<u8>) + Sync + 'a;

/// Renders and encodes `keys` into `out` with `settings`, or only renders them when `settings` is None (to time
/// the drawing alone). `progress` hears how many frames of the video are done.
pub fn encode(
    keys: &[Key],
    settings: Option<h264::Settings>,
    draw: &Draw,
    extras: Extras,
    out: &str,
    progress: &(dyn Fn(u64) + Sync),
) -> Result<(), String> {
    let threads = rayon::current_num_threads();
    let runs = runs(keys, threads);
    let voice =
        std::thread::spawn(move || extras.voice.map(|v| aac::encode(&v.samples, v.rate, VOICE_BITRATE)).transpose());
    let pool: Mutex<Vec<Vec<u8>>> = Mutex::default();
    // One encoder thread per run, fed in order through a short queue; the frames render on rayon's threads.
    let mut senders = Vec::new();
    let mut encoders = Vec::new();
    let back = Arc::new(pool);
    for _ in &runs {
        let (tx, rx) = sync_channel::<(Arc<Vec<u8>>, u64)>(4);
        let back = back.clone();
        senders.push(tx);
        encoders.push(std::thread::spawn(move || -> Result<Option<(h264::Encoder, Vec<h264::Sample>)>, String> {
            let Some(s) = settings else {
                for (frame, _) in rx {
                    if let Ok(buf) = Arc::try_unwrap(frame) {
                        back.lock().unwrap().push(buf);
                    }
                }
                return Ok(None);
            };
            let mut enc = h264::Encoder::new(s)?;
            let mut samples = Vec::new();
            for (frame, time) in rx {
                samples.push(enc.encode(&frame, (time * 1000 / 30) as i64)?);
                if let Ok(buf) = Arc::try_unwrap(frame) {
                    back.lock().unwrap().push(buf);
                }
            }
            Ok(Some((enc, samples)))
        }));
    }
    // Rounds: a few samples of every run at once, rendered in parallel, then queued to their runs' encoders.
    const STEP: usize = 4;
    let mut cursor: Vec<usize> = runs.iter().map(|r| r.start).collect();
    let mut last: Vec<Option<Arc<Vec<u8>>>> = vec![None; runs.len()];
    let mut done = 0u64;
    let sent = (|| -> Result<(), String> {
        loop {
            let mut batch: Vec<(usize, usize)> = Vec::new();
            for (r, run) in runs.iter().enumerate() {
                let end = (cursor[r] + STEP).min(run.end);
                batch.extend((cursor[r]..end).map(|k| (r, k)));
                cursor[r] = end;
            }
            if batch.is_empty() {
                return Ok(());
            }
            let drawn: Vec<Option<Arc<Vec<u8>>>> = batch
                .par_iter()
                .map(|&(r, k)| {
                    // A run's first sample is drawn even when it repeats the frame before, which the run does not have.
                    (keys[k].fresh || k == runs[r].start).then(|| {
                        let mut buf = back.lock().unwrap().pop().unwrap_or_default();
                        draw(keys[k].frame, &mut buf);
                        Arc::new(buf)
                    })
                })
                .collect();
            for (&(r, k), frame) in batch.iter().zip(drawn) {
                let frame = match frame {
                    Some(f) => f,
                    None => last[r].clone().expect("a run starts with a drawn frame"),
                };
                last[r] = Some(frame.clone());
                done += keys[k].duration as u64;
                senders[r].send((frame, keys[k].time)).map_err(|_| "an encoder stopped".to_string())?;
            }
            progress(done);
        }
    })();
    drop(senders);
    drop(last);
    let mut results = Vec::new();
    for e in encoders {
        results.push(e.join().map_err(|_| "an encoder thread panicked".to_string())?);
    }
    let voice = voice.join().map_err(|_| "the voice-over thread panicked".to_string())?;
    sent?;
    let mut encoded = Vec::new();
    for r in results {
        if let Some(r) = r? {
            encoded.push(r);
        }
    }
    let voice = voice?;
    let Some((first, _)) = encoded.first() else { return Ok(()) };
    if encoded.iter().any(|(e, _)| e.sps != first.sps || e.pps != first.pps) {
        return Err("the H.264 encoders wrote different parameter sets".into());
    }
    let s = settings.expect("encoded with settings");
    let mut samples = Vec::with_capacity(keys.len());
    for (key, sample) in keys.iter().zip(encoded.iter().flat_map(|(_, s)| s)) {
        samples.push(mp4::Sample { data: &sample.data, duration: key.duration, sync: sample.sync });
    }
    let video =
        mp4::Video { width: s.width, height: s.height, timescale: 30, sps: &first.sps, pps: &first.pps, samples };
    let audio = voice.as_ref().map(|v| mp4::Audio {
        rate: v.rate,
        channels: 1,
        bitrate: VOICE_BITRATE,
        config: &v.config,
        frames: v.frames.iter().map(Vec::as_slice).collect(),
        skip: v.delay,
        play: v.samples,
    });
    let part = format!("{out}.part");
    let write = || -> std::io::Result<()> {
        let mut f = std::io::BufWriter::new(std::fs::File::create(&part)?);
        mp4::write(&mut f, video, audio, &extras.chapters)?;
        std::io::Write::flush(&mut f)?;
        drop(f);
        std::fs::rename(&part, out)
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("{out}: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_lengthen_the_sample_before() {
        let frames: Vec<u32> = (10..20).collect();
        let prints = [1, 1, 2, 2, 2, 3, 4, 4, 4, 4];
        let k = keys(&frames, &prints, false);
        let got: Vec<(u32, u64, u32)> = k.iter().map(|k| (k.frame, k.time, k.duration)).collect();
        assert_eq!(got, [(10, 0, 2), (12, 2, 3), (15, 5, 1), (16, 6, 4)]);
        let every = keys(&frames, &prints, true);
        assert_eq!(every.len(), 10);
        assert!(every.iter().all(|k| k.duration == 1));
        assert_eq!(every.iter().filter(|k| k.fresh).count(), 4);
    }

    #[test]
    fn runs_split_the_changing_frames_evenly() {
        let keys: Vec<Key> =
            (0..3000).map(|i| Key { frame: i, time: i as u64, duration: 1, fresh: i % 3 != 1 }).collect();
        let r = runs(&keys, 4);
        assert_eq!(r.len(), 4);
        assert_eq!(r[0].start, 0);
        assert_eq!(r[3].end, 3000);
        for w in r.windows(2) {
            assert_eq!(w[0].end, w[1].start);
            assert!(keys[w[1].start].fresh);
        }
        // Too few changing frames for four runs of ten seconds.
        assert_eq!(runs(&keys[..600], 8).len(), 1);
    }
}
