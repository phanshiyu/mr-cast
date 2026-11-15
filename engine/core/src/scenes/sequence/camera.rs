//! The camera over a sequence taller than the frame: a port of src/utils/sequenceCamera.ts.

use super::layout::Layout;
use crate::anim::{CLAMP, Easing, interpolate};
use crate::steps::step_move;
use crate::timing::Segment;
use std::collections::BTreeSet;

/// Room kept between the lit messages and the edges of the view when they are brought into it.
const MARGIN: f64 = 24.0;

pub struct Camera {
    /// Height of the frame in layout units; a sequence taller than this scrolls.
    pub view_h: f64,
    pub scrolls: bool,
    stops: Vec<f64>,
    max_scroll: f64,
    stepped: bool,
}

impl Camera {
    /// How far the messages are scrolled at a frame.
    pub fn scroll_at(&self, frame: f64, segments: &[Segment]) -> f64 {
        if !self.scrolls {
            return 0.0;
        }
        if self.stepped {
            return self
                .stops
                .iter()
                .enumerate()
                .map(|(k, stop)| {
                    let prev = if k > 0 { self.stops[k - 1] } else { 0.0 };
                    (stop - prev) * step_move(frame, segments[k + 1].from)
                })
                .sum();
        }
        let n = &segments[0];
        interpolate(
            frame,
            &[n.voice_from, n.voice_from + 1.0f64.max(n.speaking_frames)],
            &[0.0, self.max_scroll],
            CLAMP.eased(Easing::InOutCubic),
        )
    }
}

/// The camera over `layout`: the participants stay pinned; the messages scroll under them. With steps, each step
/// brings the messages it lights into view, centred when they fit and with the last of them in view when they do
/// not. Without steps, it pans from the first message to the last while the narration speaks.
pub fn sequence_camera(layout: &Layout, lit: &[BTreeSet<usize>], segments: &[Segment], view_h: f64) -> Camera {
    let max_scroll = (layout.height - view_h).max(0.0);
    if max_scroll < 0.5 {
        return Camera { view_h, scrolls: false, stops: vec![], max_scroll, stepped: false };
    }
    let band_top = layout.lifeline_top + MARGIN;
    let band_h = view_h - layout.lifeline_top - 2.0 * MARGIN;
    let clamp = |v: f64| max_scroll.min(0.0f64.max(v));
    let mut stops: Vec<f64> = Vec::new();
    for (k, set) in lit.iter().enumerate() {
        let previous = if k > 0 { stops[k - 1] } else { 0.0 };
        let (Some(&lo), Some(&hi)) = (set.first(), set.last()) else {
            stops.push(previous);
            continue;
        };
        let (Some(first), Some(last)) = (layout.messages.get(lo), layout.messages.get(hi)) else {
            stops.push(previous);
            continue;
        };
        let span = last.bottom - first.top;
        stops.push(clamp(if span <= band_h {
            (first.top + last.bottom) / 2.0 - (band_top + band_h / 2.0)
        } else {
            last.bottom - (band_top + band_h)
        }));
    }
    let stepped = segments.len() > 1 && !stops.is_empty();
    Camera { view_h, scrolls: true, stops, max_scroll, stepped }
}
