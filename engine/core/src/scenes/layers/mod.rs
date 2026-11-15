//! The layers scene: a stack of bands, each with the components in it, and a request token that travels down
//! the stack and back up. A port of src/components/LayerStack.tsx, src/utils/layersLayout.ts and
//! shared/layers.mjs.

#![allow(clippy::collapsible_if, clippy::too_many_arguments, clippy::needless_range_loop)]

mod layout;
mod route;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Easing, Spring, interpolate, spring};
use crate::chrome::fittext::{TextOpts, draw_fit};
use crate::chrome::marks::{
    EMPHASIS_COLOR, badges_of, change_tone, draw_corner_badges, emphasis_card, emphasis_ring, ring,
};
use crate::chrome::nodecard::{self, CardSize, strike};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::geom::polyline;
use crate::steps::{Emphasis, FocusSpotlight, as_bright_as, brighter};
use crate::targets::target_steps;
use crate::text::{Face, line_metrics};
use crate::textfit::Fit;
use crate::theme::{
    ACCENT, ACCENT_GLOW, ACCENT_SOFT, BG, BORDER, BORDER_STRONG, FAINT, MUTED, SURFACE, TEXT, content_box, tone,
};
use crate::timing::{FPS, Segment};
use layout::{
    BAND_GAP, CAPTION_GAP, DOT_R, Layer, Layout, PAD_X, PILL_GAP, PILL_H, PILL_PAD_X, PlacedLayer, layers_scale,
    layout_layers, token_point,
};
use route::{Route, layer_of, layer_route, token_steps};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

const START: f64 = 6.0;
/// Frames between one band and the next drawing in, top to bottom.
const BAND_STAGGER: f64 = 5.0;
const SKIPPED_OPACITY: f64 = 0.3;

#[derive(Deserialize)]
struct LayersScene {
    title: Option<String>,
    layers: Vec<Layer>,
}

struct View {
    shell: Shell,
    scene: Value,
    layout: Layout,
    route: Route,
    positions: Vec<i64>,
    box_size: (f64, f64),
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: LayersScene = parse(input)?;
    if scene.layers.is_empty() {
        return Err("a layers scene without layers".into());
    }
    let box_size = content_box(scene.title.is_some());
    let layout = layout_layers(input.scene, &scene.layers, box_size);
    Ok(Box::new(View {
        shell: Shell::new(input.scene),
        scene: input.scene.clone(),
        layout,
        route: layer_route(input.scene),
        positions: token_steps(input.scene),
        box_size,
    }))
}

struct TokenKeys {
    times: Vec<f64>,
    pos: Vec<f64>,
    stepped: bool,
}

/// The token's route position over the scene, as keyframes. With steps it waits off screen, then moves to each
/// step's stop as that step starts, taking longer the more stops it passes. Without steps it walks the whole route
/// while the narration is spoken.
fn token_keys(positions: &[i64], segments: &[Segment], count: usize) -> TokenKeys {
    let mut times = vec![0.0];
    let mut pos = vec![-1.0];
    let stepped = segments.len() > 1 && positions.iter().any(|&p| p >= 0);
    if stepped {
        let mut cur = -1i64;
        for (k, &q) in positions.iter().enumerate() {
            if q == cur {
                continue;
            }
            let at = segments.get(k + 1).map_or(0.0, |s| s.from);
            times.push(at);
            times.push(at + 30.0f64.min(12.0 + 4.0 * (q - cur.max(0)) as f64));
            pos.push(cur as f64);
            pos.push(q as f64);
            cur = q;
        }
    } else {
        let n = &segments[0];
        let start = n.voice_from;
        let end = (start + count as f64 * 20.0).max(n.voice_from + n.speaking_frames);
        times.push(start - 12.0);
        times.push(start);
        pos.push(-1.0);
        pos.push(0.0);
        for i in 1..count {
            times.push(start + (i as f64 / (count as f64 - 1.0).max(1.0)) * (end - start));
            pos.push(i as f64);
        }
    }
    TokenKeys { times, pos, stepped }
}

/// A ring and glow a step's light puts on a box.
fn lit(e: Emphasis) -> Vec<Shadow> {
    let g = e.glow as f32;
    if g > 0.0 { vec![ring(4.0 * g, ACCENT), Shadow::new(0.0, 0.0, 44.0 * g, ACCENT_GLOW)] } else { vec![] }
}

fn draw_band(dl: &mut DisplayList, p: &PlacedLayer, layout: &Layout, appear: f64, e: Emphasis) {
    let layer = &p.layer;
    let marks = &layer.marks;
    let change = marks.change.as_deref().map(change_tone);
    let removed = marks.change.as_deref() == Some("removed");
    let tone_c = marks.tone.as_deref().map(tone);
    let highlight = marks.highlighted();
    let edge =
        change.map(|c| c.0).unwrap_or(if highlight { EMPHASIS_COLOR } else { tone_c.map_or(BORDER_STRONG, |t| t.0) });
    let (y, h, w) = (p.y as f32, p.h as f32, layout.band_w as f32);
    let fill: Paint = match marks.change.as_deref() {
        Some("added") => Paint::vertical(y, y + h, Color::css("#13201d"), Color::css("#10171a")),
        Some("modified") => Paint::vertical(y, y + h, Color::css("#191d30"), Color::css("#131624")),
        _ if highlight => emphasis_card(y, h),
        _ => SURFACE.into(),
    };
    let mut shadows: Vec<Shadow> = match change {
        Some((_, bg)) => vec![ring(4.0, bg)],
        None if highlight => emphasis_ring(4.0, 36.0).to_vec(),
        None => vec![Shadow::new(0.0, 10.0, 28.0, Color::rgba8(0, 0, 0, 0.35))],
    };
    shadows.extend(lit(e));
    let border_color = if change.is_some() || highlight { edge } else { BORDER };
    let opacity = (appear * e.opacity * if removed { 0.7 } else { 1.0 }).clamp(0.0, 1.0) as f32;
    dl.group(|dl| {
        let layered = opacity < 1.0;
        if layered {
            dl.push_layer(opacity);
        }
        dl.translate(0.0, (1.0 - appear as f32) * 22.0);
        let mut style = BoxStyle::fill(fill).radius(18.0);
        // Chrome draws a 1.5px border as 1px.
        style.border =
            Some(if removed { Stroke::dashed(border_color, 1.0, 3.0, 3.0) } else { Stroke::solid(border_color, 1.0) });
        style.shadows = shadows;
        dl.rect(0.0, y, w, h, style);
        let bar_alpha = if change.is_some() || tone_c.is_some() || highlight { 1.0 } else { 0.5 };
        dl.rect(1.0, y + 1.0 + 14.0, 5.0, h - 2.0 - 28.0, BoxStyle::fill(edge.fade(bar_alpha)).radius(3.0));
        let tx = 1.0 + PAD_X as f32;
        let ty = p.text_y as f32 + 1.0;
        draw_fit(dl, &p.label, tx, ty, TextOpts::new(if removed { MUTED } else { TEXT }));
        if removed {
            strike(dl, &p.label, tx, ty);
        }
        if let Some(c) = &p.caption {
            draw_fit(dl, c, tx, ty + p.label.height as f32 + CAPTION_GAP as f32, TextOpts::new(MUTED));
        }
        draw_corner_badges(dl, &badges_of(marks), 14.0, w - 1.0 - 22.0, y + 1.0 - 13.0);
        if layered {
            dl.pop_layer();
        }
    });
}

/// A pill beside the token: its text on a tinted fill over the backdrop colour.
#[allow(clippy::too_many_arguments)]
fn draw_pill(dl: &mut DisplayList, fit: &Fit, x: f64, y: f64, color: Color, bg: Color, opacity: f64) {
    let w = (fit.width + 2.0 * PILL_PAD_X) as f32;
    let (x, top, h) = (x as f32, (y - PILL_H / 2.0) as f32, PILL_H as f32);
    dl.group(|dl| {
        dl.fade(opacity as f32);
        dl.rect(
            x,
            top,
            w,
            h,
            BoxStyle::fill(BG).radius(h / 2.0).border(color, 1.0).shadow(Shadow::new(
                0.0,
                0.0,
                22.0,
                color.fade(0x55 as f32 / 255.0),
            )),
        );
        dl.rect(x + 1.0, top + 1.0, w - 2.0, h - 2.0, BoxStyle::fill(bg).radius(h / 2.0 - 1.0));
        let lh = line_metrics(Face::Mono, fit.size as f32).normal;
        draw_fit(dl, fit, x + 1.0 + PILL_PAD_X as f32, top + h / 2.0 - lh / 2.0, TextOpts::new(color).normal());
    });
}

impl View {
    fn draw_rail(
        &self,
        dl: &mut DisplayList,
        p: f64,
        token: (f64, f64),
        guide_in: f64,
        back: f64,
        skip_fade: f64,
        reply_color: Color,
        token_in: f64,
    ) {
        let rail = self.layout.rail.as_ref().unwrap();
        let visits = &self.route.visits;
        let turn = self.route.turn as f64;
        let skipped: HashSet<&String> = self.route.skipped.iter().collect();
        let y_of = |i: i64| {
            let v = &visits[i.clamp(0, visits.len() as i64 - 1) as usize];
            self.layout.y_of.get(&v.key).copied().unwrap_or(0.0)
        };
        let stop_keys: Vec<&String> =
            visits.iter().filter(|v| v.down).map(|v| &v.key).chain(self.route.skipped.iter()).collect();
        let last_y = stop_keys.last().and_then(|k| self.layout.y_of.get(*k)).copied().unwrap_or(0.0);
        let down_to = if p >= turn { y_of(self.route.turn) } else { token.1 };
        for (i, key) in stop_keys.iter().enumerate() {
            let Some(wire) = self.layout.wires.get(*key) else { continue };
            let end = wire[wire.len() - 1];
            let reached = (i as f64) <= turn && p >= i as f64 - 0.05;
            let fade = if skipped.contains(*key) { skip_fade } else { 1.0 };
            dl.group(|dl| {
                dl.fade((guide_in * fade) as f32);
                let stroke_c = if reached { ACCENT.fade(0.8) } else { FAINT.fade(0.5) };
                if let Some(path) = polyline(wire) {
                    let s =
                        if reached { Stroke::solid(stroke_c, 3.0) } else { Stroke::dashed(stroke_c, 2.0, 2.0, 8.0) };
                    dl.path(path, None, Some(s.rounded()));
                }
                if let Some(c) = PathBuilder::from_circle(end.0 as f32, end.1 as f32, 6.0) {
                    let fill = if reached { ACCENT } else { BG };
                    dl.path(c, Some(fill.into()), Some(Stroke::solid(if reached { ACCENT } else { FAINT }, 2.0)));
                }
            });
        }
        dl.group(|dl| {
            dl.fade(guide_in as f32);
            if let Some(path) = polyline(&[(rail.down_x, y_of(0) - 40.0), (rail.down_x, last_y)]) {
                dl.path(path, None, Some(Stroke::dashed(FAINT, 2.5, 2.0, 9.0).rounded()));
            }
        });
        if p > -0.2 {
            if let Some(path) = polyline(&[(rail.down_x, y_of(0)), (rail.down_x, down_to)]) {
                dl.path(path, None, Some(Stroke::solid(ACCENT, 4.0).rounded()));
            }
        }
        if p > turn {
            if let Some(path) =
                polyline(&[(rail.down_x, y_of(self.route.turn)), (token.0.min(rail.up_x), y_of(self.route.turn))])
            {
                dl.path(path, None, Some(Stroke::solid(reply_color, 4.0).rounded()));
            }
            dl.group(|dl| {
                dl.fade(back as f32);
                if let Some(path) = polyline(&[(rail.up_x, y_of(self.route.turn)), (rail.up_x, token.1)]) {
                    dl.path(path, None, Some(Stroke::solid(reply_color, 4.0).rounded()));
                }
            });
        }
        if self.scene.pointer("/path/skip").is_some_and(|s| s.is_object()) && !visits.is_empty() {
            let turn_key = &visits[self.route.turn.max(0) as usize].key;
            if let Some(band) = layer_of(&self.scene, turn_key).and_then(|i| self.layout.layers.get(i)) {
                let y = band.y + band.h + BAND_GAP / 2.0;
                dl.group(|dl| {
                    dl.fade(back as f32);
                    if let Some(path) = polyline(&[(rail.down_x - 16.0, y), (rail.down_x + 16.0, y)]) {
                        dl.path(path, None, Some(Stroke::solid(reply_color, 6.0).rounded()));
                    }
                });
            }
        }
        let core = if p > turn { reply_color } else { ACCENT };
        if let Some(c) = PathBuilder::from_circle(token.0 as f32, token.1 as f32, (DOT_R + 8.0) as f32) {
            dl.group(|dl| {
                dl.fade((0.25 * token_in) as f32);
                dl.path(c, Some(core.into()), None);
            });
        }
        if let Some(c) = PathBuilder::from_circle(token.0 as f32, token.1 as f32, DOT_R as f32) {
            dl.group(|dl| {
                dl.fade(token_in as f32);
                dl.path(c, Some(core.into()), Some(Stroke::solid(BG, 3.0)));
            });
        }
    }
}

impl SceneView for View {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let layout = &self.layout;
        let (bw, bh) = self.box_size;
        let scale = layers_scale(layout, bh);
        let (left, top) = ((bw - layout.width * scale) / 2.0, (bh - layout.height * scale) / 2.0);
        let spot = FocusSpotlight::new(target_steps(&self.scene), f.segments, frame);
        let visits = &self.route.visits;
        let keys = token_keys(&self.positions, f.segments, visits.len());
        let p = if visits.is_empty() {
            -1.0
        } else {
            interpolate(frame, &keys.times, &keys.pos, CLAMP.eased(Easing::InOutCubic))
        };
        let turn = self.route.turn as f64;
        let skip = self.scene.pointer("/path/skip").filter(|s| s.is_object());
        let back = interpolate(p, &[turn, turn + 1.0], &[0.0, 1.0], CLAMP);
        let skipped: HashSet<&String> = self.route.skipped.iter().collect();
        let skip_fade = if skip.is_some() { 1.0 - (1.0 - SKIPPED_OPACITY) * back } else { 1.0 };

        // How strongly the token is at a key's stop right now. Steps light the stops they move it to, so only a
        // walk without them lights its own.
        let here = |key: &str| -> f64 {
            if keys.stepped {
                return 0.0;
            }
            visits
                .iter()
                .enumerate()
                .filter(|(_, v)| v.key == key)
                .map(|(i, _)| 1.0 - 1.0f64.min((p - i as f64).abs() * 1.6))
                .fold(0.0, f64::max)
        };
        let emphasis = |key: &str| -> Emphasis {
            let own = spot.emphasis(key);
            let at = here(key);
            let e = if at > 0.0 { brighter(own, Emphasis { opacity: 1.0, bar: at, glow: at }) } else { own };
            if skipped.iter().any(|k| k.as_str() == key) { Emphasis { opacity: e.opacity * skip_fade, ..e } } else { e }
        };
        // An item is at least as bright as its own band, so focusing a layer lights what is in it, unless the
        // request never reached it.
        let item_emphasis = |id: &str, layer: &str| -> Emphasis {
            let own = emphasis(&format!("i:{id}"));
            if skipped.iter().any(|k| k.as_str() == format!("i:{id}")) {
                own
            } else {
                as_bright_as(own, &[emphasis(&format!("l:{layer}"))])
            }
        };
        let appear_at = |i: usize, delay: f64| {
            spring(frame - START - i as f64 * BAND_STAGGER - delay, FPS, Spring::damping(18.0).with_stiffness(140.0))
        };
        let reply_tone = tone(skip.and_then(|s| s.get("tone")).and_then(Value::as_str).unwrap_or(if skip.is_some() {
            "warn"
        } else {
            "good"
        }));
        let rail = layout.rail.as_ref();
        let token = (rail.is_some() && !visits.is_empty()).then(|| token_point(&self.scene, layout, p));
        let token_in = interpolate(p, &[-1.0, -0.2], &[0.0, 1.0], CLAMP);
        let guide_in = interpolate(frame, &[START + 30.0, START + 45.0], &[0.0, 1.0], CLAMP);

        self.shell.draw(dl, frame, f.duration, None, |dl, _| {
            dl.translate(left as f32, top as f32);
            dl.scale_about(scale as f32, 0.0, 0.0);
            for placed in &layout.layers {
                let items: Vec<Emphasis> =
                    placed.items.iter().map(|it| item_emphasis(&it.node.id, &placed.layer.id)).collect();
                let e = as_bright_as(emphasis(&format!("l:{}", placed.layer.id)), &items);
                draw_band(dl, placed, layout, appear_at(placed.index, 0.0), e);
            }
            if let (Some(_), Some(token)) = (rail, token) {
                self.draw_rail(dl, p, token, guide_in, back, skip_fade, reply_tone.0, token_in);
            }
            for placed in &layout.layers {
                for (j, it) in placed.items.iter().enumerate() {
                    nodecard::draw(
                        dl,
                        &it.node,
                        (it.x as f32, it.y as f32, it.w as f32, it.h as f32),
                        CardSize::Compact,
                        appear_at(placed.index, 6.0 + 2.0 * j as f64),
                        item_emphasis(&it.node.id, &placed.layer.id),
                        &it.text,
                    );
                }
            }
            if let (Some(rail), Some(token)) = (rail, token) {
                if let Some(label) = &rail.label {
                    draw_pill(
                        dl,
                        label,
                        token.0 + PILL_GAP,
                        token.1,
                        ACCENT,
                        ACCENT_SOFT,
                        token_in * (1.0 - 2.0 * back).max(0.0),
                    );
                }
                if let (Some(reply), true) = (&rail.reply, p > turn) {
                    draw_pill(
                        dl,
                        reply,
                        token.0 + PILL_GAP,
                        token.1,
                        reply_tone.0,
                        reply_tone.1,
                        (2.0 * back - 1.0).max(0.0),
                    );
                }
            }
            // TODO(marks): pen marks over the stack.
            // TODO(camera): the generic `camera` field.
        });
    }
}
