//! The header's callout box and change legend, and the content box of a scene that may have a callout
//! (src/components/HeaderCallout.tsx, ChangeLegend.tsx, src/fit/callout.ts, src/fit/shell.ts `headerBox`).

use super::fittext::{Align, LineHeight, TextOpts, draw_fit, fit_height};
use super::shell::shell_fits;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::item_marks::{change_tone, change_word};
use crate::states::StateFrame;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, BORDER_STRONG, MUTED, RAISED, TEXT, content_box};
use crate::timing::js_round;
use serde_json::Value;

const CALLOUT_W: f64 = 560.0;
const PAD_X: f64 = 22.0;
const PAD_Y: f64 = 12.0;

/// Every callout text of a scene: its own, then each step's, once each.
fn texts(scene: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |v: Option<&Value>| {
        if let Some(s) = v.and_then(Value::as_str).filter(|s| !s.is_empty())
            && !out.iter().any(|o| o == s)
        {
            out.push(s.to_string());
        }
    };
    add(scene.get("callout"));
    for step in scene.get("steps").and_then(Value::as_array).into_iter().flatten() {
        add(step.get("callout"));
    }
    out
}

/// Whether any state of the scene shows a callout (`hasCallout`).
pub fn has_callout(scene: &Value) -> bool {
    !texts(scene).is_empty()
}

/// The content box of a scene that may have a callout: its header is as tall as a title's, and a wrapped title's second
/// line more (`headerBox`).
pub fn header_box(scene: &Value) -> (f64, f64) {
    let (_, title) = shell_fits(scene);
    let (w, h) = content_box(title.is_some() || has_callout(scene));
    match title {
        Some(t) => (w, h - (t.lines.len() as f64 - 1.0) * js_round(t.size * t.line_height)),
        None => (w, h),
    }
}

/// The scene's callout in a box at the right end of the header (`HeaderCallout`): a formula or a comparison that steps
/// replace. The old text fades out as the new one fades in, the box glows while a step's new text settles, and it
/// keeps the width of the widest callout, so it never jumps.
pub struct HeaderCallout {
    fits: Vec<(String, Fit)>,
    pub width: f32,
    pub height: f32,
}

impl HeaderCallout {
    /// The scene's callouts, fitted; None when no state shows one.
    pub fn new(scene: &Value) -> Option<HeaderCallout> {
        let fits: Vec<(String, Fit)> = texts(scene)
            .into_iter()
            .map(|t| {
                let f = fit_text(&t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * PAD_X));
                (t, f)
            })
            .collect();
        if fits.is_empty() {
            return None;
        }
        let width = fits.iter().map(|f| f.1.width).fold(0.0, f64::max) + 2.0 * PAD_X;
        let height = fits.iter().map(|f| f.1.height).fold(0.0, f64::max) + 2.0 * PAD_Y;
        Some(HeaderCallout { fits, width: width as f32, height: height as f32 })
    }

    /// Text centred in the box's padding box (inside its 1.5px border).
    fn text(&self, dl: &mut DisplayList, value: &str, opacity: f64, w: f32, h: f32) {
        let Some((_, fit)) = self.fits.iter().find(|f| f.0 == value) else { return };
        if value.is_empty() || opacity <= 0.0 {
            return;
        }
        dl.group(|dl| {
            dl.fade(opacity as f32);
            let fh = fit_height(fit, LineHeight::Fit);
            draw_fit(
                dl,
                fit,
                1.5,
                1.5 + (h - 3.0 - fh) / 2.0,
                TextOpts { align: Align::Center, width: w - 3.0, ..TextOpts::new(TEXT) },
            );
        });
    }

    /// The header's aside for the box: its height, and `draw` (which draws it with its top right at (right, top)).
    pub fn aside<'a>(&'a self, draw: &'a dyn Fn(&mut DisplayList, f32, f32)) -> super::shell::Aside<'a> {
        super::shell::Aside { height: self.height, draw }
    }

    /// Draws the box with its top right at (right, top), at the state frame `s`.
    pub fn draw(&self, dl: &mut DisplayList, right: f32, top: f32, s: &StateFrame) {
        let (w, h) = (self.width, self.height);
        let (was, now) = (s.before.callout.as_str(), s.now.callout.as_str());
        let on = |v: &str| if v.is_empty() { 0.0 } else { 1.0 };
        let shown = (on(was) + (on(now) - on(was)) * s.t).clamp(0.0, 1.0) as f32;
        if shown <= 0.0 {
            return;
        }
        let changed = was != now;
        let glow = if changed { s.lit as f32 } else { 0.0 };
        let mut b = BoxStyle::fill(RAISED).radius(14.0).border(if glow > 0.0 { ACCENT } else { BORDER_STRONG }, 1.5);
        if glow > 0.0 {
            // `0 0 0 3px soft, 0 0 30px glow`: the first shadow is on top, so it draws last.
            b = b.shadow(Shadow::new(0.0, 0.0, 30.0 * glow, ACCENT_GLOW));
            let mut ring = Shadow::new(0.0, 0.0, 0.0, ACCENT_SOFT);
            ring.spread = 3.0 * glow;
            b = b.shadow(ring);
        } else {
            b = b.shadow(Shadow::new(0.0, 10.0, 26.0, Color::rgba8(0, 0, 0, 0.35)));
        }
        let body = |dl: &mut DisplayList| {
            dl.group(|dl| {
                dl.translate(right - w, top);
                dl.rect(0.0, 0.0, w, h, b.clone());
                if changed {
                    self.text(dl, was, 1.0 - s.t, w, h);
                    self.text(dl, now, s.t, w, h);
                } else {
                    self.text(dl, now, 1.0, w, h);
                }
            });
        };
        // The box fades as one, its text and border together (CSS group opacity).
        if shown < 0.999 {
            dl.push_layer(shown);
            body(dl);
            dl.pop_layer();
        } else {
            body(dl);
        }
    }
}

const ORDER: [&str; 3] = ["added", "removed", "modified"];

/// The change legend: only the kinds used, in a row (`ChangeLegend`). Its size, and with none used a 6px strip.
pub fn legend_size(used: &[&str]) -> (f32, f32) {
    let items: Vec<f32> = ORDER
        .iter()
        .filter(|c| used.contains(c))
        .map(|c| 26.0 + 8.0 + width(change_word(c), Style::sans(400.0, 19.0)))
        .collect();
    if items.is_empty() {
        return (0.0, 6.0);
    }
    (items.iter().sum::<f32>() + 22.0 * (items.len() - 1) as f32, 26.0 + 6.0)
}

/// Draws the legend with its top right at (right, top).
pub fn draw_legend(dl: &mut DisplayList, used: &[&str], right: f32, top: f32) {
    let (w, _) = legend_size(used);
    let mut x = right - w;
    for c in ORDER.iter().filter(|c| used.contains(c)) {
        let tone = change_tone(c).expect("change");
        dl.rect(
            x,
            top,
            26.0,
            26.0,
            BoxStyle::fill(tone.bg).radius(7.0).border(tone.color.alpha(0x88 as f32 / 255.0), 1.0),
        );
        let st = Style::mono(800.0, 19.0);
        let mw = width(tone.marker, st);
        let lh = line_metrics(Face::Mono, 19.0).normal;
        dl.text(
            tone.marker,
            st,
            x + (26.0 - mw) / 2.0,
            top + (26.0 - lh) / 2.0 + baseline_in(Face::Mono, 19.0, lh),
            tone.color,
        );
        let ws = Style::sans(400.0, 19.0);
        let lh = line_metrics(Face::Sans, 19.0).normal;
        let tw =
            dl.text(change_word(c), ws, x + 34.0, top + (26.0 - lh) / 2.0 + baseline_in(Face::Sans, 19.0, lh), MUTED);
        x += 34.0 + tw + 22.0;
    }
}

/// A row of change legend and callout as the graph's header holds them, bottom-aligned: the aside's height, and how
/// to draw it with its right edge at `right` and its top at `top`.
pub fn aside_height(legend: &[&str], callouts: Option<&HeaderCallout>) -> f32 {
    legend_size(legend).1.max(callouts.map_or(0.0, |c| c.height))
}

pub fn draw_aside(
    dl: &mut DisplayList,
    legend: &[&str],
    callouts: Option<&HeaderCallout>,
    s: Option<&StateFrame>,
    right: f32,
    top: f32,
) {
    let height = aside_height(legend, callouts);
    let bottom = top + height;
    let mut edge = right;
    if let (Some(c), Some(s)) = (callouts, s) {
        c.draw(dl, edge, bottom - c.height, s);
        edge -= c.width + 32.0;
    }
    let (_, lh) = legend_size(legend);
    draw_legend(dl, legend, edge, bottom - lh);
}
