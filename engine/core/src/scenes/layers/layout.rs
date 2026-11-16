//! The layers scene's layout: a port of src/utils/layersLayout.ts.

use super::route::layer_route;
use crate::chrome::marks::Marks;
use crate::chrome::nodecard::{CardSize, CardText, Node, card_texts};
use crate::textfit::{Fit, Slot, fit_text};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

pub const BAND_GAP: f64 = 16.0;
const BAND_MAX_H: f64 = 180.0;
const BAND_MIN_H: f64 = 72.0;
pub const PAD_X: f64 = 28.0;
const PAD_Y: f64 = 14.0;
const LABEL_MIN_W: f64 = 260.0;
const LABEL_MAX_W: f64 = 440.0;
/// A band with no items in the scene keeps its label to this width, so it reads as a label and not prose.
const LABEL_ALONE_W: f64 = 900.0;
const LABEL_ALONE_MIN_W: f64 = 760.0;
pub const CAPTION_GAP: f64 = 4.0;
const ITEM_GAP: f64 = 20.0;
const ITEM_MAX_W: f64 = 300.0;
const ITEM_MAX_H: f64 = 84.0;
/// From the bands' right edge to the lane the token goes down, then to the lane it comes back up.
const RAIL_GAP: f64 = 34.0;
const LANE_GAP: f64 = 28.0;
pub const DOT_R: f64 = 11.0;
/// From a lane to the token's pill.
pub const PILL_GAP: f64 = DOT_R + 10.0;
pub const PILL_PAD_X: f64 = 14.0;
pub const PILL_H: f64 = 40.0;
const PILL_MAX_W: f64 = 340.0;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub label: String,
    pub caption: Option<String>,
    pub items: Option<Vec<Node>>,
    #[serde(flatten)]
    pub marks: Marks,
}

pub struct PlacedItem {
    pub node: Node,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: CardText,
}

pub struct PlacedLayer {
    pub layer: Layer,
    pub index: usize,
    pub y: f64,
    pub h: f64,
    pub label: Fit,
    pub caption: Option<Fit>,
    /// Top of the label, so the label and caption sit centred in the band.
    pub text_y: f64,
    pub items: Vec<PlacedItem>,
}

/// The column right of the bands where the request token travels, and the texts it carries.
pub struct Rail {
    pub down_x: f64,
    pub up_x: f64,
    pub label: Option<Fit>,
    pub reply: Option<Fit>,
    pill_w: f64,
}

pub struct Layout {
    pub width: f64,
    pub height: f64,
    pub band_w: f64,
    pub layers: Vec<PlacedLayer>,
    pub rail: Option<Rail>,
    /// Where the token stops for each layer and item key ("l:id" or "i:id"), level with its wire's end on the down
    /// lane: an item's wire leaves the bottom of its card and runs under the cards beside it; a layer's wire
    /// leaves the band's right edge.
    pub wires: HashMap<String, Vec<(f64, f64)>>,
    pub y_of: HashMap<String, f64>,
}

fn natural(text: &str, slot: &Slot) -> f64 {
    let mut s = slot.clone();
    s.width = f64::INFINITY;
    fit_text(text, &s).width
}

fn path_text(path: &Value, key: &str) -> Option<String> {
    path.get(key).and_then(Value::as_str).map(str::to_string)
}

fn fit_rail(scene: &Value, bands_right: f64) -> Option<Rail> {
    let path = scene.get("path").filter(|p| p.is_object())?;
    let skip = path.get("skip").filter(|s| s.is_object());
    let reply = skip.and_then(|s| path_text(s, "reply")).or_else(|| {
        if path.get("return").and_then(Value::as_bool) == Some(true) { path_text(path, "reply") } else { None }
    });
    let label = path_text(path, "label");
    let token = Slot::named("tokenLabel", 0.0);
    let wanted = [&label, &reply].iter().filter_map(|t| t.as_deref()).map(|t| natural(t, &token)).fold(0.0, f64::max);
    let pill_w = PILL_MAX_W.min(wanted.ceil() + 2.0 * PILL_PAD_X);
    let fit = |text: &Option<String>| {
        text.as_deref()
            .filter(|t| !t.is_empty())
            .map(|t| fit_text(t, &Slot::named("tokenLabel", pill_w - 2.0 * PILL_PAD_X)))
    };
    let down_x = bands_right + RAIL_GAP;
    Some(Rail { down_x, up_x: down_x + LANE_GAP, pill_w, label: fit(&label), reply: fit(&reply) })
}

/// Width the rail takes right of the bands.
fn rail_width(rail: &Rail) -> f64 {
    RAIL_GAP + LANE_GAP + PILL_GAP + rail.pill_w + 6.0
}

pub fn layout_layers(scene: &Value, layers_in: &[Layer], (box_w, box_h): (f64, f64)) -> Layout {
    let n = layers_in.len() as f64;
    let h = BAND_MIN_H.max(BAND_MAX_H.min((box_h - (n - 1.0) * BAND_GAP) / n));
    let probe = fit_rail(scene, 0.0);
    let rail_w = probe.as_ref().map_or(0.0, rail_width);
    let most = layers_in.iter().map(|l| l.items.as_ref().map_or(0, Vec::len)).max().unwrap_or(0);
    // Tall bands, as with three layers, take larger text, so the stack reads from across the room.
    let big = h >= 140.0;
    let mut label_slot = Slot::named("layerLabel", 0.0);
    if big {
        label_slot.size = 36.0;
    }
    label_slot.lines = if h >= 124.0 { 2 } else { 1 };
    let mut caption_slot = Slot::named("layerCaption", 0.0);
    if big {
        caption_slot.size = 23.0;
    }
    caption_slot.lines = if big { 2 } else { 1 };
    let wanted = layers_in
        .iter()
        .map(|l| {
            natural(&l.label, &label_slot)
                .max(l.caption.as_deref().filter(|c| !c.is_empty()).map_or(0.0, |c| natural(c, &caption_slot)))
        })
        .fold(f64::NEG_INFINITY, f64::max)
        .ceil()
        + 2.0 * PAD_X;
    let label_w = if most > 0 {
        LABEL_MAX_W.min(LABEL_MIN_W.max(wanted + 8.0))
    } else {
        (box_w - rail_w).min(LABEL_ALONE_MIN_W.max(wanted + 40.0)).min(LABEL_ALONE_W)
    };
    // Bands are as wide as their content, so a stack of few items or none sits centred.
    let band_w = (box_w - rail_w).min(if most > 0 {
        label_w + most as f64 * ITEM_MAX_W + (most as f64 - 1.0) * ITEM_GAP + PAD_X
    } else {
        label_w
    });
    let rail = fit_rail(scene, band_w);
    let item_w = if most > 0 {
        ITEM_MAX_W.min((band_w - label_w - PAD_X - (most as f64 - 1.0) * ITEM_GAP) / most as f64)
    } else {
        0.0
    };
    let item_h = ITEM_MAX_H.min(h - 2.0 * PAD_Y);
    let all: Vec<Node> = layers_in.iter().flat_map(|l| l.items.clone().unwrap_or_default()).collect();
    let texts = card_texts(&all, item_w, item_h, CardSize::Compact, true);

    let mut wires: HashMap<String, Vec<(f64, f64)>> = HashMap::new();
    let down_x = rail.as_ref().map_or(band_w, |r| r.down_x);
    let mut text_at = 0usize;
    let layers: Vec<PlacedLayer> = layers_in
        .iter()
        .enumerate()
        .map(|(index, layer)| {
            let y = index as f64 * (h + BAND_GAP);
            let text_w = label_w - 2.0 * PAD_X;
            let mut ls = label_slot.clone();
            ls.width = text_w;
            let label = fit_text(&layer.label, &ls);
            let caption = layer.caption.as_deref().filter(|c| !c.is_empty()).map(|c| {
                let mut cs = caption_slot.clone();
                cs.width = text_w;
                fit_text(c, &cs)
            });
            let text_h = label.height + caption.as_ref().map_or(0.0, |c| CAPTION_GAP + c.height);
            let items: Vec<PlacedItem> = layer
                .items
                .iter()
                .flatten()
                .enumerate()
                .map(|(j, node)| {
                    let text = texts[text_at].clone();
                    text_at += 1;
                    PlacedItem {
                        node: node.clone(),
                        x: label_w + j as f64 * (item_w + ITEM_GAP),
                        y: y + (h - item_h) / 2.0,
                        w: item_w,
                        h: item_h,
                        text,
                    }
                })
                .collect();
            wires.insert(format!("l:{}", layer.id), vec![(band_w, y + h / 2.0), (down_x, y + h / 2.0)]);
            for it in &items {
                let below = it.y + it.h;
                let floor = below + (y + h - below) / 2.0;
                wires.insert(
                    format!("i:{}", it.node.id),
                    vec![(it.x + it.w / 2.0, below), (it.x + it.w / 2.0, floor), (down_x, floor)],
                );
            }
            PlacedLayer { layer: layer.clone(), index, y, h, label, caption, text_y: y + (h - text_h) / 2.0, items }
        })
        .collect();
    let y_of = wires.iter().map(|(k, p)| (k.clone(), p[p.len() - 1].1)).collect();
    let height = n * h + (n - 1.0) * BAND_GAP;
    Layout { width: band_w + rail_w, height, band_w, layers, rail, wires, y_of }
}

/// Where the token is at a route position: on the down or up lane, level with its stop's band (`tokenPoint`).
pub fn token_point(scene: &Value, layout: &Layout, p: f64) -> (f64, f64) {
    let route = layer_route(scene);
    let rail = layout.rail.as_ref().unwrap();
    let at = |i: i64| {
        let v = &route.visits[i.clamp(0, route.visits.len() as i64 - 1) as usize];
        (if v.down { rail.down_x } else { rail.up_x }, layout.y_of.get(&v.key).copied().unwrap_or(0.0))
    };
    if p <= 0.0 {
        let first = at(0);
        return (first.0, first.1 + 60.0 * p);
    }
    let i = p.floor() as i64;
    let (a, b) = (at(i), at(i + 1));
    let t = p - i as f64;
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

/// The scale a layer stack draws at in a box: shrunk only to fit its height.
pub fn layers_scale(layout: &Layout, box_h: f64) -> f64 {
    1.0f64.min(box_h / layout.height)
}
