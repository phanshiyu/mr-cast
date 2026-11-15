//! Remotion's `interpolate`, `spring` and `Easing`, with the same numbers (remotion/dist/cjs/{interpolate,
//! spring/*,easing,bezier}.js).

use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Extrapolate {
    Extend,
    Clamp,
    Identity,
}

/// An easing curve over 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Easing {
    Linear,
    /// `Easing.out(Easing.cubic)`.
    OutCubic,
    /// `Easing.in(Easing.cubic)`.
    InCubic,
    /// `Easing.inOut(Easing.cubic)`.
    InOutCubic,
    /// `Easing.bezier(x1, y1, x2, y2)`.
    Bezier(f64, f64, f64, f64),
}

impl Easing {
    pub fn apply(self, t: f64) -> f64 {
        match self {
            Easing::Linear => t,
            Easing::OutCubic => 1.0 - (1.0 - t).powi(3),
            Easing::InCubic => t * t * t,
            Easing::InOutCubic => {
                if t < 0.5 {
                    (t * 2.0).powi(3) / 2.0
                } else {
                    1.0 - ((1.0 - t) * 2.0).powi(3) / 2.0
                }
            }
            Easing::Bezier(x1, y1, x2, y2) => bezier(x1, y1, x2, y2, t),
        }
    }
}

/// Options for [`interpolate`]: Remotion's `extrapolateLeft`, `extrapolateRight` and `easing`.
#[derive(Clone, Copy, Debug)]
pub struct Opts {
    pub left: Extrapolate,
    pub right: Extrapolate,
    pub easing: Easing,
}

/// No options: extend on both sides, linear.
pub const EXTEND: Opts = Opts { left: Extrapolate::Extend, right: Extrapolate::Extend, easing: Easing::Linear };
/// `{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }`, the `clamp` of src/components/theme.ts.
pub const CLAMP: Opts = Opts { left: Extrapolate::Clamp, right: Extrapolate::Clamp, easing: Easing::Linear };

impl Opts {
    pub fn eased(self, easing: Easing) -> Opts {
        Opts { easing, ..self }
    }
}

fn segment(input: f64, ir: (f64, f64), or: (f64, f64), o: &Opts) -> f64 {
    let mut result = input;
    if result < ir.0 {
        match o.left {
            Extrapolate::Identity => return result,
            Extrapolate::Clamp => result = ir.0,
            Extrapolate::Extend => {}
        }
    }
    if result > ir.1 {
        match o.right {
            Extrapolate::Identity => return result,
            Extrapolate::Clamp => result = ir.1,
            Extrapolate::Extend => {}
        }
    }
    if or.0 == or.1 {
        return or.0;
    }
    result = (result - ir.0) / (ir.1 - ir.0);
    result = o.easing.apply(result);
    or.0 + result * (or.1 - or.0)
}

/// Maps `input` from `input_range` onto `output_range`, piecewise linearly, then eased.
pub fn interpolate(input: f64, input_range: &[f64], output_range: &[f64], o: Opts) -> f64 {
    debug_assert_eq!(input_range.len(), output_range.len());
    if input_range.len() == 1 {
        return output_range[0];
    }
    let mut i = 1;
    while i < input_range.len() - 1 {
        if input_range[i] >= input {
            break;
        }
        i += 1;
    }
    let k = i - 1;
    segment(input, (input_range[k], input_range[k + 1]), (output_range[k], output_range[k + 1]), &o)
}

/// `interpolate(input, [a, b], [from, to], clamp)`.
pub fn clamped(input: f64, a: f64, b: f64, from: f64, to: f64) -> f64 {
    interpolate(input, &[a, b], &[from, to], CLAMP)
}

// --- Cubic bezier easing, as bezier-easing (which Remotion copies). ---

const NEWTON_ITERATIONS: usize = 4;
const NEWTON_MIN_SLOPE: f64 = 0.001;
const SUBDIVISION_PRECISION: f64 = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS: usize = 10;
const SPLINE_TABLE_SIZE: usize = 11;
const SAMPLE_STEP: f64 = 1.0 / (SPLINE_TABLE_SIZE as f64 - 1.0);

fn a(a1: f64, a2: f64) -> f64 {
    1.0 - 3.0 * a2 + 3.0 * a1
}
fn b(a1: f64, a2: f64) -> f64 {
    3.0 * a2 - 6.0 * a1
}
fn c(a1: f64) -> f64 {
    3.0 * a1
}
fn calc(t: f64, a1: f64, a2: f64) -> f64 {
    ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t
}
fn slope(t: f64, a1: f64, a2: f64) -> f64 {
    3.0 * a(a1, a2) * t * t + 2.0 * b(a1, a2) * t + c(a1)
}

fn bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    if x1 == y1 && x2 == y2 {
        return x;
    }
    if x == 0.0 || x == 1.0 {
        return x;
    }
    let samples: Vec<f64> = (0..SPLINE_TABLE_SIZE).map(|i| calc(i as f64 * SAMPLE_STEP, x1, x2)).collect();
    let mut start = 0.0;
    let mut cur = 1;
    let last = SPLINE_TABLE_SIZE - 1;
    while cur != last && samples[cur] <= x {
        start += SAMPLE_STEP;
        cur += 1;
    }
    cur -= 1;
    let dist = (x - samples[cur]) / (samples[cur + 1] - samples[cur]);
    let guess = start + dist * SAMPLE_STEP;
    let s = slope(guess, x1, x2);
    let t = if s >= NEWTON_MIN_SLOPE {
        let mut g = guess;
        for _ in 0..NEWTON_ITERATIONS {
            let sl = slope(g, x1, x2);
            if sl == 0.0 {
                break;
            }
            g -= (calc(g, x1, x2) - x) / sl;
        }
        g
    } else if s == 0.0 {
        guess
    } else {
        let (mut lo, mut hi) = (start, start + SAMPLE_STEP);
        let mut t = 0.0;
        for _ in 0..SUBDIVISION_MAX_ITERATIONS {
            t = lo + (hi - lo) / 2.0;
            let v = calc(t, x1, x2) - x;
            if v > 0.0 {
                hi = t;
            } else {
                lo = t;
            }
            if v.abs() <= SUBDIVISION_PRECISION {
                break;
            }
        }
        t
    };
    calc(t, y1, y2)
}

// --- Springs. ---

/// A spring's physics; `Default` is Remotion's (damping 10, mass 1, stiffness 100).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spring {
    pub damping: f64,
    pub mass: f64,
    pub stiffness: f64,
    pub overshoot_clamping: bool,
}

impl Default for Spring {
    fn default() -> Self {
        Spring { damping: 10.0, mass: 1.0, stiffness: 100.0, overshoot_clamping: false }
    }
}

impl Spring {
    pub fn damping(damping: f64) -> Self {
        Spring { damping, ..Default::default() }
    }
    pub fn with_stiffness(mut self, stiffness: f64) -> Self {
        self.stiffness = stiffness;
        self
    }
}

#[derive(Clone, Copy)]
struct State {
    last: f64,
    current: f64,
    velocity: f64,
}

fn advance(s: State, now: f64, c: &Spring) -> State {
    let to = 1.0;
    let dt = (now - s.last).min(64.0);
    let v0 = -s.velocity;
    let x0 = to - s.current;
    let zeta = c.damping / (2.0 * (c.stiffness * c.mass).sqrt());
    let omega0 = (c.stiffness / c.mass).sqrt();
    let omega1 = omega0 * (1.0 - zeta * zeta).sqrt();
    let t = dt / 1000.0;
    let (sin1, cos1) = (omega1 * t).sin_cos();
    let env = (-zeta * omega0 * t).exp();
    let frag = env * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
    let under_pos = to - frag;
    let under_vel = zeta * omega0 * frag - env * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);
    let cenv = (-omega0 * t).exp();
    let crit_pos = to - cenv * (x0 + (v0 + omega0 * x0) * t);
    let crit_vel = cenv * (v0 * (t * omega0 - 1.0) + t * x0 * omega0 * omega0);
    State {
        last: now,
        current: if zeta < 1.0 { under_pos } else { crit_pos },
        velocity: if zeta < 1.0 { under_vel } else { crit_vel },
    }
}

fn spring_calculation(frame: f64, fps: f64, c: &Spring) -> f64 {
    let f = frame.max(0.0);
    let mut s = State { last: 0.0, current: 0.0, velocity: 0.0 };
    let whole = f.floor() as i64;
    for k in 0..=whole {
        s = advance(s, (k as f64 / fps) * 1000.0, c);
    }
    if f % 1.0 > 0.0 {
        s = advance(s, (f / fps) * 1000.0, c);
    }
    s.current
}

/// Frames a spring takes to settle within `threshold` (Remotion's `measureSpring`).
pub fn measure_spring(fps: f64, c: &Spring, threshold: f64) -> f64 {
    thread_local! {
        static CACHE: RefCell<HashMap<[u64; 5], f64>> = RefCell::new(HashMap::new());
    }
    let key = [fps.to_bits(), c.damping.to_bits(), c.mass.to_bits(), c.stiffness.to_bits(), threshold.to_bits()];
    if let Some(v) = CACHE.with(|m| m.borrow().get(&key).copied()) {
        return v;
    }
    let mut frame = 0.0;
    let diff = |f: f64| (spring_calculation(f, fps, c) - 1.0).abs();
    while diff(frame) >= threshold {
        frame += 1.0;
    }
    let mut finished = frame;
    let mut i = 0;
    while i < 20 {
        frame += 1.0;
        if diff(frame) >= threshold {
            i = 0;
            finished = frame + 1.0;
        }
        i += 1;
    }
    CACHE.with(|m| m.borrow_mut().insert(key, finished));
    finished
}

/// `spring({ frame, fps, config })` from 0 to 1.
pub fn spring(frame: f64, fps: f64, c: Spring) -> f64 {
    spring_full(frame, fps, c, None)
}

/// `spring({ frame, fps, config, durationInFrames })`: the spring squeezed to settle in `duration` frames.
pub fn spring_full(frame: f64, fps: f64, c: Spring, duration: Option<f64>) -> f64 {
    let processed = match duration {
        None => frame,
        Some(d) => {
            if frame > d {
                return 1.0;
            }
            frame / (d / measure_spring(fps, &c, 0.005))
        }
    };
    let v = spring_calculation(processed, fps, &c);
    if c.overshoot_clamping { v.min(1.0) } else { v }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_like_remotion() {
        assert_eq!(interpolate(5.0, &[0.0, 10.0], &[0.0, 1.0], CLAMP), 0.5);
        assert_eq!(interpolate(-5.0, &[0.0, 10.0], &[0.0, 1.0], CLAMP), 0.0);
        assert_eq!(interpolate(15.0, &[0.0, 10.0], &[0.0, 1.0], EXTEND), 1.5);
        assert_eq!(interpolate(25.0, &[0.0, 10.0, 20.0, 30.0], &[0.0, 1.0, 1.0, 0.0], CLAMP), 0.5);
    }

    #[test]
    fn springs_like_remotion() {
        // Values from remotion 4.0.543: spring({ frame, fps: 30, config: { damping: 18 } }).
        assert!((spring(0.0, 30.0, Spring::damping(18.0)) - 0.0).abs() < 1e-12);
        assert!(spring(60.0, 30.0, Spring::damping(18.0)) > 0.99);
    }
}
