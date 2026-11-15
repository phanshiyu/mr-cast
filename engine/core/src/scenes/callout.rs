//! The header callout: a formula or a comparison that steps replace, in a box at the right end of the header
//! (src/components/HeaderCallout.tsx and src/fit/callout.ts).

use super::step_state::StateFrame;
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, BORDER_STRONG, RAISED, TEXT};
use serde_json::Value;
use std::collections::HashMap;

const CALLOUT_W: f64 = 560.0;
const PAD_X: f64 = 22.0;
const PAD_Y: f32 = 12.0;

pub struct HeaderCallout {
    fits: HashMap<String, Fit>,
    pub width: f32,
    pub height: f32,
}

impl HeaderCallout {
    /// The scene's callouts, fitted; None when it shows none.
    pub fn new(scene: &Value) -> Option<HeaderCallout> {
        let mut texts: Vec<String> = Vec::new();
        let mut add = |v: Option<&Value>| {
            if let Some(s) = v.and_then(Value::as_str).filter(|s| !s.is_empty())
                && !texts.iter().any(|t| t == s)
            {
                texts.push(s.to_string());
            }
        };
        add(scene.get("callout"));
        for step in super::step_state::list(scene.get("steps")) {
            add(step.get("callout"));
        }
        if texts.is_empty() {
            return None;
        }
        let fits: HashMap<String, Fit> = texts
            .into_iter()
            .map(|t| {
                let fit = fit_text(&t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * PAD_X));
                (t, fit)
            })
            .collect();
        let width = fits.values().map(|f| f.width).fold(0.0, f64::max) as f32 + 2.0 * PAD_X as f32;
        let height = fits.values().map(|f| f.height).fold(0.0, f64::max) as f32 + 2.0 * PAD_Y;
        Some(HeaderCallout { fits, width, height })
    }

    /// Draws the box with its top left at (x, y).
    pub fn draw(&self, dl: &mut DisplayList, x: f32, y: f32, s: &StateFrame) {
        let (was, now) = (s.before.callout.as_str(), s.now.callout.as_str());
        let t = s.t as f32;
        let (w, h) = (if was.is_empty() { 0.0 } else { 1.0 }, if now.is_empty() { 0.0 } else { 1.0 });
        let shown = w + (h - w) * t;
        let changed = was != now;
        let glow = if changed { s.lit as f32 } else { 0.0 };
        dl.group(|dl| {
            dl.fade(shown);
            let mut style =
                BoxStyle::fill(RAISED).radius(14.0).border(if glow > 0.0 { ACCENT } else { BORDER_STRONG }, 1.5);
            if glow > 0.0 {
                let r = 3.0 * glow;
                dl.rect(
                    x - r,
                    y - r,
                    self.width + 2.0 * r,
                    self.height + 2.0 * r,
                    BoxStyle::fill(ACCENT_SOFT).radius(14.0 + r).shadow(Shadow::new(
                        0.0,
                        0.0,
                        30.0 * glow,
                        ACCENT_GLOW,
                    )),
                );
            } else {
                style = style.shadow(Shadow::new(0.0, 10.0, 26.0, crate::color::Color::rgba8(0, 0, 0, 0.35)));
            }
            dl.rect(x, y, self.width, self.height, style);
            let text = |dl: &mut DisplayList, value: &str, opacity: f32| {
                let Some(fit) = self.fits.get(value).filter(|_| !value.is_empty() && opacity > 0.0) else { return };
                dl.group(|dl| {
                    dl.fade(opacity);
                    let (iw, ih) = (self.width - 3.0, self.height - 3.0);
                    let fh = fit_height(fit, LineHeight::Fit);
                    draw_fit(dl, fit, x + 1.5, y + 1.5 + (ih - fh) / 2.0, TextOpts::new(TEXT).centered(iw));
                });
            };
            if changed {
                text(dl, was, 1.0 - t);
                text(dl, now, t);
            } else {
                text(dl, now, 1.0);
            }
        });
    }
}
