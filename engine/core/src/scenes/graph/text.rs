//! A card's title and caption fitted to its card (src/utils/nodeText.ts), for the large cards of a graph.

use crate::textfit::{Fit, Slot, fit_text, fit_text_at};
use std::collections::HashMap;

pub const ICON: f64 = 56.0;
pub const ICON_RADIUS: f32 = 14.0;
pub const PAD: f64 = 22.0;
pub const GAP: f64 = 18.0;
pub const RADIUS: f32 = 20.0;
pub const BADGE: f32 = 16.0;
pub const BADGE_AT: (f32, f32) = (-16.0, 18.0);
pub const RING: (f32, f32) = (6.0, 48.0);
const CARD_V_PAD: f64 = 8.0;
const CAPTION_GAP: f64 = 4.0;

/// What a card needs fitted: its id, label, caption and whether it draws an icon.
pub struct CardIn<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub caption: Option<&'a str>,
    pub icon: bool,
}

#[derive(Clone)]
pub struct CardText {
    pub title: Fit,
    pub caption: Option<Fit>,
}

fn text_width(n: &CardIn, width: f64) -> f64 {
    width - 2.0 * PAD - if n.icon { ICON + GAP } else { 0.0 } - 4.0
}

fn caption_of(n: &CardIn, width: f64) -> Option<Fit> {
    n.caption.filter(|c| !c.is_empty()).map(|c| fit_text(c, &Slot::named("cardCaption", text_width(n, width))))
}

fn own_title(n: &CardIn, width: f64, height: f64, caption: Option<&Fit>) -> Fit {
    let slot = Slot::named("cardTitle", text_width(n, width));
    let room = height - 2.0 * CARD_V_PAD - caption.map_or(0.0, |c| c.height + CAPTION_GAP);
    let mut s = slot.size;
    loop {
        let mut at = slot.clone();
        at.size = s;
        at.one_line_min = Some(slot.one_line_min.unwrap_or(s).min(s));
        let fit = fit_text(n.label, &at);
        if fit.height <= room || s <= slot.min || !fit.fits {
            return fit;
        }
        s -= 1.0;
    }
}

/// One title size for every card of a diagram: the largest at which each title fits its card.
pub fn shared_title_size(nodes: &[CardIn], width: f64, height: f64) -> f64 {
    nodes.iter().fold(Slot::named("cardTitle", 0.0).size, |m, n| {
        m.min(own_title(n, width, height, caption_of(n, width).as_ref()).size)
    })
}

/// Each card's title, at one size shared by every card or at its own, and its caption, keyed by node id.
pub fn card_texts(nodes: &[CardIn], width: f64, height: f64) -> HashMap<String, CardText> {
    let one = shared_title_size(nodes, width, height);
    nodes
        .iter()
        .map(|n| {
            let caption = caption_of(n, width);
            let own = own_title(n, width, height, caption.as_ref());
            let title = if one < own.size {
                fit_text_at(n.label, &Slot::named("cardTitle", text_width(n, width)), one)
            } else {
                own.clone()
            };
            (n.id.to_string(), CardText { title: if title.fits { title } else { own }, caption })
        })
        .collect()
}
