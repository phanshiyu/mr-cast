//! The voice-over as one PCM track. Walkthrough.tsx plays each segment's clip from the segment's `voiceFrom` until
//! the segment ends; here every clip is mixed into one buffer at that frame, at 48 kHz, for the AAC encoder.

use mrc_core::Project;
use std::path::{Component, Path, PathBuf};

const FPS: f64 = 30.0;

/// The voice-over's sample rate.
pub const RATE: u32 = 48_000;

/// A clip on the video's timeline, in frames from the video's first frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub src: String,
    /// Where the clip starts.
    pub from: f64,
    /// Where its segment ends, which cuts the clip off if it runs longer.
    pub to: f64,
}

/// Every clip the frames in `frames` play, placed at their offsets from `frames[0]`. A clip plays only when its
/// start frame is rendered.
pub fn placements(p: &Project, frames: &[u32]) -> Vec<Placed> {
    let Some(&first) = frames.first() else { return vec![] };
    let rendered = |n: f64| frames.binary_search(&(n as u32)).is_ok();
    let end = *frames.last().unwrap() as f64 + 1.0;
    let mut out = Vec::new();
    for t in &p.timeline {
        for s in &t.segments {
            let Some(clip) = &s.clip else { continue };
            let from = t.from + s.voice_from;
            if clip.src.is_empty() || !rendered(from.floor()) {
                continue;
            }
            let to = (t.from + s.from + s.duration).min(end);
            out.push(Placed { src: clip.src.clone(), from: from - first as f64, to: to - first as f64 });
        }
    }
    out
}

/// A clip's samples as mono floats at its own rate.
pub struct Samples {
    pub rate: u32,
    pub data: Vec<f32>,
}

/// Reads a WAV file (integer or float PCM, any channel count) as mono.
pub fn read_wav(path: &Path) -> Result<Samples, String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let spec = r.spec();
    let err = |e: hound::Error| format!("{}: {e}", path.display());
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>().map_err(err)?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|v| v as f32 * scale)).collect::<Result<_, _>>().map_err(err)?
        }
    };
    let ch = spec.channels.max(1) as usize;
    let data = interleaved.chunks(ch).map(|c| c.iter().sum::<f32>() / ch as f32).collect();
    Ok(Samples { rate: spec.sample_rate, data })
}

/// `s` at `rate`, by linear interpolation (clips normally all share one rate, so this rarely runs).
fn resample(s: Samples, rate: u32) -> Vec<f32> {
    if s.rate == rate || s.data.is_empty() {
        return s.data;
    }
    let n = (s.data.len() as f64 * rate as f64 / s.rate as f64).round() as usize;
    let step = s.rate as f64 / rate as f64;
    (0..n)
        .map(|i| {
            let x = i as f64 * step;
            let k = x.floor() as usize;
            let a = s.data[k.min(s.data.len() - 1)];
            let b = s.data[(k + 1).min(s.data.len() - 1)];
            a + (b - a) * (x - k as f64) as f32
        })
        .collect()
}

/// The sample a frame starts at.
pub fn sample_at(frame: f64, rate: u32) -> usize {
    (frame * rate as f64 / FPS).round().max(0.0) as usize
}

/// Mixes clips into a track of `frames` frames at `rate`: each clip from its `from` frame, cut at its `to` frame.
/// Overlaps add up; the sum is clipped to 16 bits.
pub fn mix(frames: f64, rate: u32, clips: &[(&Placed, Vec<f32>)]) -> Vec<i16> {
    let mut out = vec![0f32; sample_at(frames, rate)];
    for (p, data) in clips {
        let start = sample_at(p.from, rate);
        let end = sample_at(p.to, rate).min(out.len());
        for (o, s) in out.iter_mut().take(end).skip(start).zip(data) {
            *o += s;
        }
    }
    out.iter().map(|s| (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16).collect()
}

/// A clip's file in the run's directory. `src` comes from voiceover.json, so it must stay inside the directory.
fn clip_path(dir: &Path, src: &str) -> Result<PathBuf, String> {
    let rel = Path::new(src);
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("voice clip {src} is not a path inside the run"));
    }
    Ok(dir.join(rel))
}

/// The voice-over: mono 16-bit samples at `rate`, from the first rendered frame.
pub struct Voice {
    pub rate: u32,
    pub samples: Vec<i16>,
}

/// The voice-over of the frames in `frames`, read from the clips in the run's directory `dir`, or None when nothing
/// in them speaks.
pub fn track(p: &Project, frames: &[u32], dir: &Path) -> Result<Option<Voice>, String> {
    let placed = placements(p, frames);
    if placed.is_empty() {
        return Ok(None);
    }
    let mut read = Vec::new();
    for pl in &placed {
        read.push((pl, read_wav(&clip_path(dir, &pl.src)?)?));
    }
    let rate = RATE;
    let clips: Vec<_> = read.into_iter().map(|(pl, s)| (pl, resample(s, rate))).collect();
    let length = (frames.last().unwrap() - frames[0] + 1) as f64;
    Ok(Some(Voice { rate, samples: mix(length, rate, &clips) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placed(from: f64, to: f64) -> Placed {
        Placed { src: "a.wav".into(), from, to }
    }

    #[test]
    fn a_clip_starts_at_its_frame() {
        // 24 kHz: a frame is 800 samples, so frame 3 starts at sample 2400.
        let p = placed(3.0, 10.0);
        let track = mix(10.0, 24_000, &[(&p, vec![0.5; 10])]);
        assert_eq!(track.len(), 8000);
        assert_eq!(track[2399], 0);
        assert_eq!(track[2400], 16384);
        assert_eq!(track[2409], 16384);
        assert_eq!(track[2410], 0);
    }

    #[test]
    fn a_clip_is_cut_where_its_segment_ends_and_overlaps_add_up() {
        let a = placed(0.0, 1.0);
        let b = placed(0.5, 4.0);
        let track = mix(4.0, 30, &[(&a, vec![0.25; 30]), (&b, vec![0.25; 30])]);
        // 30 Hz: one sample a frame. `a` covers sample 0 only, `b` starts at sample 1 (0.5 rounds up).
        assert_eq!(track.len(), 4);
        assert_eq!(track[0], 8192);
        assert_eq!(track[1..], [8192, 8192, 8192]);
        let loud = mix(1.0, 30, &[(&a, vec![0.8]), (&a, vec![0.8])]);
        assert_eq!(loud[0], 32767);
    }

    #[test]
    fn clip_paths_stay_inside_the_run() {
        let dir = Path::new("/run");
        assert_eq!(clip_path(dir, "audio/0a1b2c3d.wav").unwrap(), Path::new("/run/audio/0a1b2c3d.wav"));
        assert!(clip_path(dir, "../secret.wav").is_err());
        assert!(clip_path(dir, "/etc/passwd").is_err());
    }

    #[test]
    fn resampling_keeps_the_length_in_seconds() {
        let s = Samples { rate: 24_000, data: vec![0.0; 24_000] };
        assert_eq!(resample(s, 48_000).len(), 48_000);
    }

    #[test]
    fn clips_are_placed_at_their_segments_voice_frames() {
        let json = r#"{
            "storyboard": {"scenes": [
                {"type": "text", "narration": "One two three.", "headline": "A", "items": ["a"]},
                {"type": "text", "narration": "Four five.", "headline": "B", "items": ["b"]}
            ]},
            "voiceover": {"voice": "v", "clips": {}}
        }"#;
        let mut props: mrc_core::model::Props = serde_json::from_str(json).unwrap();
        let v = props.voiceover.as_mut().unwrap();
        for (text, src) in [("One two three.", "audio/a.wav"), ("Four five.", "audio/b.wav")] {
            let key = mrc_core::timing::narration_key(text, "v", 1.0);
            v.clips.insert(key, mrc_core::model::Clip { src: src.into(), seconds: 1.5, sentences: None });
        }
        let p = Project::new(props);
        let frames: Vec<u32> = (0..p.frame_count()).collect();
        let got = placements(&p, &frames);
        assert_eq!(got.len(), 2);
        let (s0, s1) = (&p.timeline[0], &p.timeline[1]);
        assert_eq!(got[0].from, s0.segments[0].voice_from);
        assert_eq!(got[0].to, s0.duration);
        assert_eq!(got[1].from, s1.from + s1.segments[0].voice_from);
        // Rendering only the second scene puts its clip at its offset into that scene.
        let second: Vec<u32> = (s1.from as u32..(s1.from + s1.duration) as u32).collect();
        let got = placements(&p, &second);
        assert_eq!(got, vec![Placed { src: "audio/b.wav".into(), from: s1.segments[0].voice_from, to: s1.duration }]);
    }
}
