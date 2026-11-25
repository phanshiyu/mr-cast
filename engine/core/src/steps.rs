//! Step-driven light and motion every scene shares: a port of src/utils/spotlight.ts.

use crate::anim::{CLAMP, Easing, Spring, clamped, interpolate, spring_full};
use crate::timing::{STEP_SETTLE_FRAMES, Segment};

const STEP_FADE: f64 = 14.0;
const DIM_OPACITY: f64 = 0.42;
const VISITED_OPACITY: f64 = 0.72;

/// How lit an item is: its opacity, the strength of its current-step marker, and 1 only while it is current.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Emphasis {
    pub opacity: f64,
    pub bar: f64,
    pub glow: f64,
}

/// An item no step dims or lights.
pub const CALM: Emphasis = Emphasis { opacity: 1.0, bar: 0.0, glow: 0.0 };

/// When each spotlighted item lights up (`spotlightStarts`).
pub fn spotlight_starts(segments: &[Segment], count: usize, intro_end: f64) -> Vec<f64> {
    if segments.len() > 1 {
        return (0..count).map(|k| segments.get(k + 1).map_or(segments[segments.len() - 1].from, |s| s.from)).collect();
    }
    let n = &segments[0];
    let start = intro_end.max(n.voice_from);
    let end = start.max(n.voice_from + n.speaking_frames);
    (0..count).map(|k| start + (k as f64 * (end - start)) / count as f64).collect()
}

/// Items lit as steps light them (`spotlight`): the current step's at full strength, earlier ones softer, the
/// rest dimmed once the first step starts.
pub struct Spotlight {
    reached: Vec<f64>,
}

impl Spotlight {
    pub fn new(frame: f64, starts: &[f64]) -> Spotlight {
        Spotlight { reached: starts.iter().map(|&s| clamped(frame, s, s + STEP_FADE, 0.0, 1.0)).collect() }
    }
    fn reached(&self, k: usize) -> f64 {
        self.reached.get(k).copied().unwrap_or(0.0)
    }
    /// The emphasis of an item lit by `steps`.
    pub fn emphasis(&self, steps: &[usize]) -> Emphasis {
        let dim = self.reached(0);
        let now: f64 = steps.iter().map(|&k| self.reached(k) - self.reached(k + 1)).sum();
        let seen = steps.iter().min().map_or(0.0, |&k| self.reached(k));
        Emphasis {
            opacity: 1.0 - (1.0 - DIM_OPACITY) * (dim - seen) - (1.0 - VISITED_OPACITY) * (seen - now),
            bar: now + 0.3 * (seen - now),
            glow: now,
        }
    }
}

/// The step shown at `frame`: k from segment k + 1's start, or None before the first step (`currentStep`).
pub fn current_step(segments: &[Segment], frame: f64) -> Option<usize> {
    let mut current = None;
    for (k, s) in segments.iter().enumerate().skip(1) {
        if frame >= s.from {
            current = Some(k - 1);
        }
    }
    current
}

/// How far, 0 to 1, a move a step starts at `from` has gone (`stepMove`).
pub fn step_move(frame: f64, from: f64) -> f64 {
    interpolate(
        frame,
        &[from, from + STEP_SETTLE_FRAMES],
        &[0.0, 1.0],
        CLAMP.eased(Easing::Bezier(0.25, 0.1, 0.25, 1.0)),
    )
}

/// A spring for an item a step starting at `step_from` brings in at `at`, at rest when the step settles.
pub fn step_spring(frame: f64, fps: f64, at: f64, step_from: f64, config: Spring) -> f64 {
    spring_full(frame - at, fps, config, Some((step_from + STEP_SETTLE_FRAMES - at).max(1.0)))
}

/// The stronger of two emphases, part by part (`brighter`).
pub fn brighter(a: Emphasis, b: Emphasis) -> Emphasis {
    Emphasis { opacity: a.opacity.max(b.opacity), bar: a.bar.max(b.bar), glow: a.glow.max(b.glow) }
}

/// An item at least as bright as the brightest of `others` (`asBrightAs`).
pub fn as_bright_as(own: Emphasis, others: &[Emphasis]) -> Emphasis {
    Emphasis { opacity: others.iter().fold(own.opacity, |m, e| m.max(e.opacity)), ..own }
}

/// Emphasis by item key for a scene whose steps take `focus` (`focusSpotlight`); `steps` is `scenes::refs::target_steps`.
pub struct FocusSpotlight<'a> {
    spot: Spotlight,
    steps: std::borrow::Cow<'a, std::collections::HashMap<String, Vec<usize>>>,
}

impl<'a> FocusSpotlight<'a> {
    /// From the steps that light each key, owned.
    pub fn new(steps: std::collections::HashMap<String, Vec<usize>>, segments: &[Segment], frame: f64) -> Self {
        Self::of(std::borrow::Cow::Owned(steps), segments, frame)
    }
    /// From the steps that light each key, as a scene keeps them from `prepare`.
    pub fn borrowed(
        steps: &'a std::collections::HashMap<String, Vec<usize>>,
        segments: &[Segment],
        frame: f64,
    ) -> Self {
        Self::of(std::borrow::Cow::Borrowed(steps), segments, frame)
    }
    fn of(
        steps: std::borrow::Cow<'a, std::collections::HashMap<String, Vec<usize>>>,
        segments: &[Segment],
        frame: f64,
    ) -> Self {
        let starts: Vec<f64> = segments.iter().skip(1).map(|s| s.from).collect();
        FocusSpotlight { spot: Spotlight::new(frame, &starts), steps }
    }
    pub fn emphasis(&self, key: &str) -> Emphasis {
        self.spot.emphasis(self.steps.get(key).map_or(&[], Vec::as_slice))
    }
    /// The steps that light `key`.
    pub fn steps(&self, key: &str) -> &[usize] {
        self.steps.get(key).map_or(&[], Vec::as_slice)
    }
}

/// When each of `count` ordered items starts to appear (`revealStarts`): with steps, step k reveals every item up
/// to index `lasts[k]` from its segment's start, at most `stagger` frames apart and all drawn `item_frames` after
/// their start by the time the step settles; the last step also brings any items after it. Without steps the items
/// arrive one after another from `from` to `to`.
pub fn reveal_starts(
    segments: &[Segment],
    count: usize,
    lasts: &[i64],
    from: f64,
    to: f64,
    stagger: f64,
    item_frames: f64,
) -> Vec<f64> {
    if segments.len() > 1 && !lasts.is_empty() {
        let mut starts: Vec<f64> = Vec::new();
        for (k, &last) in lasts.iter().enumerate() {
            let at = segments.get(k + 1).map_or(0.0, |s| s.from);
            let end = if k == lasts.len() - 1 { count as i64 - 1 } else { last };
            let shown = end + 1 - starts.len() as i64;
            let gap = stagger.min((STEP_SETTLE_FRAMES - item_frames).max(0.0) / ((shown - 1).max(1) as f64));
            let mut j = 0.0;
            while (starts.len() as i64) <= end {
                starts.push(at + j * gap);
                j += 1.0;
            }
        }
        return starts;
    }
    let gap = if count > 1 { (to - from) / (count as f64 - 1.0) } else { 0.0 };
    (0..count).map(|i| from + i as f64 * gap).collect()
}
