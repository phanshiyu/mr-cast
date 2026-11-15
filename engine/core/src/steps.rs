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
