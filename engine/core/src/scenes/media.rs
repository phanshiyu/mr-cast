//! What the picture and diagram scenes (image, svg, mermaid, map) share: the content box a header leaves,
//! focus refs turned into the steps that light them, and a box-filter downscale for pictures.

use crate::chrome::shell::{Shell, callout_box_width};
use crate::steps::{CALM, Emphasis, Spotlight};
use crate::theme::content_box;
use crate::timing::Segment;
use serde_json::Value;
use std::collections::HashMap;
use tiny_skia::Pixmap;

/// The content box a scene lays out in (`headerBox` in src/fit/shell.ts): the header is as tall as a title's, and
/// a title wrapped onto more lines pushes the box down.
pub fn header_box(scene: &Value, shell: &Shell) -> (f64, f64) {
    let has_callout = callout_box_width(scene) > 0.0;
    let (w, h) = content_box(shell.title.is_some() || has_callout);
    match &shell.title {
        Some(t) => (w, h - (t.lines.len() as f64 - 1.0) * (t.size * t.line_height).round()),
        None => (w, h),
    }
}

/// A step's `focus` as a list of refs: one ref, or several.
pub fn focus_refs(step: &Value) -> Vec<&Value> {
    match step.get("focus") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(Value::Null) | None => Vec::new(),
        Some(v) => vec![v],
    }
}

/// For each item key, the steps that light it (`targetSteps`), given how a ref resolves to item keys.
pub fn target_steps(scene: &Value, resolve: impl Fn(&Value) -> Vec<String>) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    let steps = scene.get("steps").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    for (k, step) in steps.iter().enumerate() {
        let mut keys: Vec<String> = Vec::new();
        for r in focus_refs(step) {
            for key in resolve(r) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        for key in keys {
            out.entry(key).or_default().push(k);
        }
    }
    out
}

/// When each step lights its items: the start of its segment (`focusSpotlight`).
pub fn focus_starts(segments: &[Segment]) -> Vec<f64> {
    segments.iter().skip(1).map(|s| s.from).collect()
}

/// Emphasis by item key at a frame (`focusSpotlight`).
pub struct Focus<'a> {
    spot: Spotlight,
    steps: &'a HashMap<String, Vec<usize>>,
}

impl<'a> Focus<'a> {
    pub fn new(frame: f64, segments: &[Segment], steps: &'a HashMap<String, Vec<usize>>) -> Focus<'a> {
        Focus { spot: Spotlight::new(frame, &focus_starts(segments)), steps }
    }
    pub fn of(&self, key: &str) -> Emphasis {
        self.steps.get(key).map_or_else(|| self.spot.emphasis(&[]), |s| self.spot.emphasis(s))
    }
}

/// The emphasis of an item nothing lights or dims.
pub const STILL: Emphasis = CALM;

/// A picture scaled down to `w` by `h` by averaging the source pixels each one covers (premultiplied, so
/// transparent edges do not bleed), the way a browser filters a large picture drawn small.
pub fn downscale(src: &Pixmap, w: u32, h: u32) -> Option<Pixmap> {
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    if w == 0 || h == 0 || w as usize >= sw && h as usize >= sh {
        return None;
    }
    let (w, h) = ((w as usize).min(sw), (h as usize).min(sh));
    let weights = |from: usize, to: usize| -> Vec<Vec<(usize, f32)>> {
        let k = from as f32 / to as f32;
        (0..to)
            .map(|i| {
                let (a, b) = (i as f32 * k, (i as f32 + 1.0) * k);
                let mut v = Vec::new();
                let mut j = a.floor() as usize;
                while (j as f32) < b && j < from {
                    let cover = (b.min(j as f32 + 1.0) - a.max(j as f32)).max(0.0);
                    if cover > 0.0 {
                        v.push((j, cover / k));
                    }
                    j += 1;
                }
                v
            })
            .collect()
    };
    let (wx, wy) = (weights(sw, w), weights(sh, h));
    let data = src.data();
    let mut mid = vec![0f32; w * sh * 4];
    for y in 0..sh {
        for (x, ws) in wx.iter().enumerate() {
            let mut acc = [0f32; 4];
            for &(sx, wt) in ws {
                let p = (y * sw + sx) * 4;
                for c in 0..4 {
                    acc[c] += data[p + c] as f32 * wt;
                }
            }
            mid[(y * w + x) * 4..][..4].copy_from_slice(&acc);
        }
    }
    let mut out = Pixmap::new(w as u32, h as u32)?;
    let dst = out.data_mut();
    for (y, ws) in wy.iter().enumerate() {
        for x in 0..w {
            let mut acc = [0f32; 4];
            for &(sy, wt) in ws {
                let p = (sy * w + x) * 4;
                for c in 0..4 {
                    acc[c] += mid[p + c] * wt;
                }
            }
            let a = acc[3].round().clamp(0.0, 255.0);
            let o = (y * w + x) * 4;
            for c in 0..3 {
                dst[o + c] = acc[c].round().clamp(0.0, a) as u8;
            }
            dst[o + 3] = a as u8;
        }
    }
    Some(out)
}
