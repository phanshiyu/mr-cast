//! Scene durations and spoken segments: a port of shared/timing.mjs, shared/steps.mjs and the voice lookup in
//! shared/voice.mjs. Frame numbers are f64, as in the JS, so every derived value matches it exactly.

use crate::markup::plain_text;
use crate::model::{Clip, Voiceover};
use crate::speech::speech_text;
use serde_json::Value;

pub const FPS: f64 = 30.0;
const WORDS_PER_MINUTE: f64 = 195.0;
const NARRATION_LEAD: f64 = 1.0;
const STEP_LEAD: f64 = 0.3;
const NARRATION_TAIL: f64 = 0.4;
const STEP_TAIL: f64 = 0.2;
const SILENT_TAIL: f64 = 1.5;
const MIN_SILENT_SECONDS: f64 = 3.0;
/// Every scene fades out over its last SCENE_EXIT_FRAMES.
pub const SCENE_EXIT_FRAMES: f64 = 8.0;
/// Frames every scene has, from a step's start, to bring the step's items to rest.
pub const STEP_SETTLE_FRAMES: f64 = 15.0;
/// The shortest a step's lead is: the voice starts as its items are most of the way in, not once they rest.
const STEP_LEAD_MIN_FRAMES: f64 = 9.0;
const PEN_FRAMES: f64 = 12.0;
const BUILD_SETTLE: f64 = 0.3;

/// `Math.round`: halves round up, towards +infinity.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// JS `String(n)` for a number: whole numbers without a fraction, and -0 as "0".
pub fn js_num(v: f64) -> String {
    if v == 0.0 {
        "0".into()
    } else if v.fract() == 0.0 && v.abs() < 9e15 {
        format!("{}", v as i64)
    } else {
        v.to_string()
    }
}

fn build_seconds(ty: &str) -> f64 {
    match ty {
        "graph" | "sequence" | "er" | "state" | "table" | "timeline" | "layers" | "files" | "review" | "reading"
        | "memory" => 1.5,
        "flow" | "array" | "svg" | "plot" | "map" => 1.2,
        "tests" | "chart" | "compare" => 1.8,
        "mermaid" | "terminal" => 0.8,
        "image" => 1.0,
        _ => 0.0,
    }
}

/// Frames a scene type takes to draw in; its narration's voice starts after them.
pub fn build_frames(ty: &str) -> f64 {
    js_round(build_seconds(ty) * FPS)
}

pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

/// The steps a scene speaks, in order; empty for a scene without them (shared/steps.mjs `sceneSteps`).
pub fn scene_steps(scene: &Value) -> &[Value] {
    const OWN: [&str; 20] = [
        "code", "graph", "sequence", "er", "state", "table", "chart", "timeline", "layers", "files", "tests", "text",
        "compare", "terminal", "array", "memory", "svg", "plot", "map", "image",
    ];
    let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
    let steps = scene.get("steps").and_then(Value::as_array);
    let speaks = if ty == "flow" {
        steps.is_some_and(|s| s.iter().any(|step| step.get("say").is_some_and(|v| !v.is_null())))
    } else {
        OWN.contains(&ty)
    };
    match steps {
        Some(s) if speaks => s,
        _ => &[],
    }
}

/// An item index or an inclusive "a-b" range of indexes (shared/steps.mjs `indexRange`).
pub fn index_range(r: &Value) -> Option<(usize, usize)> {
    if let Some(n) = r.as_u64() {
        return Some((n as usize, n as usize));
    }
    let s = r.as_str()?.trim();
    let (a, b) = s.split_once('-')?;
    let (a, b): (usize, usize) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
    (a <= b).then_some((a, b))
}

/// FNV-1a over the voice, the speed and the text, as 8 hex digits (shared/voice.mjs `narrationKey`).
pub fn narration_key(text: &str, voice: &str, speed: f64) -> String {
    let pace = if speed == 1.0 { String::new() } else { format!("{}\n", js_number(speed)) };
    let input = format!("{voice}\n{pace}{}", text.trim());
    let mut hash: u32 = 0x811c9dc5;
    for unit in input.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

/// A number as JavaScript's `String(n)` writes it, for the short decimals a pace uses.
fn js_number(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
}

fn pace_of(v: Option<&Voiceover>) -> (f64, f64) {
    (v.and_then(|v| v.speed).unwrap_or(1.0), v.and_then(|v| v.pauses).unwrap_or(1.0))
}

fn clip_for<'a>(v: Option<&'a Voiceover>, text: &str) -> Option<&'a Clip> {
    let v = v?;
    v.clips.get(&narration_key(text, &v.voice, pace_of(Some(v)).0))
}

/// One spoken text of a scene, timed from the scene's start.
#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    pub text: String,
    pub from: f64,
    pub mark_from: f64,
    pub voice_from: f64,
    pub duration: f64,
    pub speaking_frames: f64,
    pub clip: Option<Clip>,
}

/// The texts a scene speaks: its narration, then each step's `say`, without markup and as the voice reads them.
pub fn spoken_texts(scene: &Value) -> Vec<String> {
    std::iter::once(scene.get("narration"))
        .chain(scene_steps(scene).iter().map(|s| s.get("say")))
        .map(|t| match t {
            Some(Value::String(s)) => speech_text(&plain_text(s)),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        })
        .collect()
}

/// The scene's spoken segments (shared/timing.mjs `sceneSegments`).
pub fn scene_segments(scene: &Value, voiceover: Option<&Voiceover>) -> Vec<Segment> {
    let (speed, pauses) = pace_of(voiceover);
    let pause = |s: f64| js_round(s * pauses * FPS);
    let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
    let narration_lead = pause(NARRATION_LEAD).max(build_frames(ty) + js_round(BUILD_SETTLE * FPS));
    let steps = scene_steps(scene);
    let mut from = 0.0;
    spoken_texts(scene)
        .into_iter()
        .enumerate()
        .map(|(i, text)| {
            let clip = clip_for(voiceover, &text).cloned();
            let mark_from = from + if i == 0 { narration_lead } else { pause(STEP_LEAD).max(STEP_LEAD_MIN_FRAMES) };
            let pen = i > 0
                && steps.get(i - 1).is_some_and(|s| {
                    s.get("mark").is_some_and(Value::is_string) || s.get("flag").is_some_and(Value::is_string)
                });
            let voice_from = mark_from + if pen { PEN_FRAMES } else { 0.0 };
            let speaking_frames = match &clip {
                Some(c) => c.seconds * FPS,
                None => (word_count(&text) as f64 / (WORDS_PER_MINUTE * speed)) * 60.0 * FPS,
            };
            let after = match &clip {
                Some(_) => speaking_frames.ceil() + pause(if i == 0 { NARRATION_TAIL } else { STEP_TAIL }),
                None => (MIN_SILENT_SECONDS * FPS).max(speaking_frames.ceil() + pause(SILENT_TAIL)),
            };
            let seg = Segment {
                text,
                from,
                mark_from,
                voice_from,
                duration: voice_from - from + after,
                speaking_frames,
                clip,
            };
            from += seg.duration;
            seg
        })
        .collect()
}

pub fn scene_duration(segments: &[Segment]) -> f64 {
    segments.last().map_or(0.0, |s| s.from + s.duration)
}

/// A frame just before the fade-out, where every scene's animation has settled.
pub fn settled_frame(duration: f64) -> f64 {
    (duration - SCENE_EXIT_FRAMES - 2.0).max(0.0)
}

fn sentences_match(seg: &Segment, words: usize) -> Option<&[crate::model::Sentence]> {
    let s = seg.clip.as_ref()?.sentences.as_deref()?;
    (!s.is_empty() && s.iter().map(|s| s.words).sum::<usize>() == words).then_some(s)
}

fn words_spoken(seg: &Segment, seconds: f64) -> usize {
    let words = word_count(&seg.text);
    if let Some(sentences) = sentences_match(seg, words) {
        let mut before = 0;
        for s in sentences {
            if seconds < s.start {
                return before;
            }
            if seconds < s.end {
                if let Some(times) = s.times.as_deref().filter(|t| t.len() == s.words) {
                    let mut k = 0;
                    while k + 1 < times.len() && times[k + 1] <= seconds {
                        k += 1;
                    }
                    return before + k;
                }
                return before + (((seconds - s.start) / (s.end - s.start)) * s.words as f64).floor() as usize;
            }
            before += s.words;
        }
        return words;
    }
    let speaking = seg.speaking_frames / FPS;
    if speaking <= 0.0 {
        words
    } else {
        ((seconds / speaking) * words as f64).floor().clamp(0.0, words as f64) as usize
    }
}

/// Which segment is spoken at a frame of its scene, and which of its words (shared/timing.mjs `spokenAt`).
pub fn spoken_at(segments: &[Segment], frame: f64) -> (usize, usize) {
    let mut index = 0;
    for (i, s) in segments.iter().enumerate().skip(1) {
        if frame >= s.voice_from {
            index = i;
        }
    }
    let seg = &segments[index];
    (index, words_spoken(seg, (frame - seg.voice_from).max(0.0) / FPS))
}

/// One scene placed on the video's timeline.
#[derive(Clone, Debug)]
pub struct TimedScene {
    pub index: usize,
    pub from: f64,
    pub duration: f64,
    pub segments: Vec<Segment>,
}

/// Every scene's place on the timeline (src/utils/timing.ts `timeline`).
pub fn timeline(scenes: &[Value], voiceover: Option<&Voiceover>) -> Vec<TimedScene> {
    let mut from = 0.0;
    scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let segments = scene_segments(scene, voiceover);
            let duration = scene_duration(&segments);
            let t = TimedScene { index, from, duration, segments };
            from += duration;
            t
        })
        .collect()
}

/// A spoken text's words, lower case without punctuation, each with its index among the text's words.
fn cue_tokens(text: &str) -> Vec<(String, usize)> {
    text.split_whitespace()
        .enumerate()
        .map(|(i, w)| (w.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>(), i))
        .filter(|(w, _)| !w.is_empty())
        .collect()
}

/// Where `cue` starts among the words of a spoken `text`, as the index of its first word (`cueWord`).
pub fn cue_word(text: &str, cue: &str) -> Option<usize> {
    let said = cue_tokens(text);
    let want: Vec<String> = cue_tokens(&speech_text(&plain_text(cue))).into_iter().map(|t| t.0).collect();
    if want.is_empty() || want.len() > said.len() {
        return None;
    }
    (0..=said.len() - want.len())
        .find(|&i| want.iter().enumerate().all(|(j, w)| &said[i + j].0 == w))
        .map(|i| said[i].1)
}

/// Seconds after a segment's voice starts at which it reaches word `index` (`wordStart`).
pub fn word_start(seg: &Segment, index: usize) -> f64 {
    let words = word_count(&seg.text);
    if let Some(sentences) = sentences_match(seg, words) {
        let mut before = 0;
        for s in sentences {
            if index < before + s.words {
                if let Some(times) = s.times.as_deref().filter(|t| t.len() == s.words) {
                    return times[index - before];
                }
                return s.start + ((index - before) as f64 / s.words as f64) * (s.end - s.start);
            }
            before += s.words;
        }
    }
    if words > 0 { (index as f64 / words as f64) * (seg.speaking_frames / FPS) } else { 0.0 }
}

/// Frame, from the scene's start, at which a segment's voice says `cue`, less a short lead (`cueFrame`).
pub fn cue_frame(seg: &Segment, cue: &str) -> Option<f64> {
    let index = cue_word(&seg.text, cue)?;
    Some(seg.mark_from.max(seg.voice_from + js_round(word_start(seg, index) * FPS) - 3.0))
}
