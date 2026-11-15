//! The er scene: table cards with field rows, relations in crow's-foot notation, and steps that light parts of it.
//! A port of src/components/ErDiagram.tsx and src/utils/erLayout.ts.

mod layout;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::callout::{aside_height, draw_aside};
use crate::chrome::fittext::{Align, LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::diagram::{bez, skia, strike, trim};
use crate::display::{BoxStyle, DisplayList, PathBuilder, Shadow, Stroke};
use crate::graph_targets::{Focus, as_bright_as, brighter, target_steps};
use crate::icons;
use crate::item_marks::{
    EMPHASIS, EMPHASIS_GLOW, EMPHASIS_SOFT, badges_of, change_tone, corner_badges, draw_pill, emphasis_card, pill,
};
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics};
use crate::theme::{
    ACCENT, ACCENT_GLOW, ACCENT_SOFT, ADD, ADD_BG, BORDER, BORDER_STRONG, DEL, FAINT, MUTED, RAISED, TEXT, content_box,
};
use crate::timing::{FPS, build_frames};
use layout::{ErEntity, ErField, ErLayout, ErRelation, HEADER_H, ROW_H, Side, er_scale, layout_er};
use serde::Deserialize;
use std::collections::HashMap;

const AMBER: Color = Color::rgba8(0xfb, 0xbf, 0x24, 1.0);
const AMBER_BG: Color = Color::rgba8(251, 191, 36, 0.13);
const CARD_START: f64 = 8.0;
const CARDS_END: f64 = 18.0;
const RELATION_FRAMES: f64 = 12.0;
const FIELDS_AFTER: f64 = 10.0;

fn edge_color() -> Color {
    Color::rgba8(170, 178, 200, 0.7)
}

/// Field rows mark a change in amber, so a changed field stands apart from its changed (blue) table.
fn field_tone(change: &str) -> Option<(Color, Color, &'static str)> {
    match change {
        "added" => Some((ADD, ADD_BG, "+")),
        "removed" => Some((DEL, Color::rgba8(255, 107, 122, 0.13), "\u{2212}")),
        "modified" => Some((AMBER, AMBER_BG, "~")),
        _ => None,
    }
}

#[derive(Deserialize)]
struct ErScene {
    #[serde(default)]
    title: Option<String>,
    entities: Vec<ErEntity>,
    #[serde(default)]
    relations: Vec<ErRelation>,
}

struct ErView {
    shell: Shell,
    scene: ErScene,
    layout: ErLayout,
    targets: HashMap<String, Vec<usize>>,
    scale: f64,
    legend: Vec<&'static str>,
    card_at: Vec<f64>,
    relation_at: Vec<f64>,
    field_at: HashMap<(usize, usize), f64>,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: ErScene = parse(input)?;
    if scene.entities.is_empty() {
        return Err("an er scene without entities".into());
    }
    let layout = layout_er(&scene.entities, &scene.relations);
    let n = layout.entities.len();
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| (layout.entities[i].row, layout.entities[i].col));
    let stagger = 6f64.min((CARDS_END - CARD_START) / ((n as f64) - 1.0).max(1.0));
    let mut card_at = vec![0.0; n];
    for (rank, &i) in order.iter().enumerate() {
        card_at[i] = CARD_START + rank as f64 * stagger;
    }
    let m = layout.relations.len();
    let start = CARDS_END + 6.0;
    let mut rorder: Vec<usize> = (0..m).collect();
    rorder.sort_by_key(|&i| scene.relations[layout.relations[i].relation].marks.change.is_some());
    let mut relation_at = vec![0.0; m];
    let rstagger = 5f64.min((build_frames("er") - start - RELATION_FRAMES - 4.0) / ((m as f64) - 1.0).max(1.0));
    for (rank, &i) in rorder.iter().enumerate() {
        relation_at[i] = start + rank as f64 * rstagger;
    }
    let mut field_at = HashMap::new();
    for (i, e) in scene.entities.iter().enumerate() {
        for (k, f) in e.fields.iter().enumerate() {
            if f.marks.change.is_some() {
                field_at.insert((i, k), card_at[i] + FIELDS_AFTER);
            }
        }
    }
    let mut legend: Vec<&'static str> = Vec::new();
    for c in ["added", "removed", "modified"] {
        let has = scene.entities.iter().any(|e| {
            e.marks.change.as_deref() == Some(c) || e.fields.iter().any(|f| f.marks.change.as_deref() == Some(c))
        }) || scene.relations.iter().any(|r| r.marks.change.as_deref() == Some(c));
        if has {
            legend.push(c);
        }
    }
    let scale = er_scale(&layout, content_box(scene.title.is_some()));
    Ok(Box::new(ErView {
        shell: Shell::new(input.scene),
        targets: target_steps(input.scene),
        scene,
        layout,
        scale,
        legend,
        card_at,
        relation_at,
        field_at,
    }))
}

fn alpha(c: Color, a: f64) -> Color {
    c.alpha((a / 255.0) as f32)
}

fn relation_color(r: &ErRelation) -> Color {
    match r.marks.change.as_deref() {
        Some("added") => ADD,
        Some("removed") => DEL,
        Some("modified") => ACCENT,
        _ if r.marks.highlighted() => EMPHASIS,
        _ => edge_color(),
    }
}

fn end_mark(dl: &mut DisplayList, end: &layout::RelationEnd, many: bool, color: Color, opacity: f64) {
    let n = end.side.normal();
    let t = (-n.y, n.x);
    let at = |along: f64, across: f64| {
        ((end.point.x + n.x * along + t.0 * across) as f32, (end.point.y + n.y * along + t.1 * across) as f32)
    };
    let mut pb = PathBuilder::new();
    let mut line = |a: (f32, f32), b: (f32, f32)| {
        pb.move_to(a.0, a.1);
        pb.line_to(b.0, b.1);
    };
    if many {
        line(at(22.0, 0.0), at(0.0, -12.0));
        line(at(22.0, 0.0), at(0.0, 0.0));
        line(at(22.0, 0.0), at(0.0, 12.0));
    } else {
        line(at(16.0, -11.0), at(16.0, 11.0));
    }
    if let Some(p) = pb.finish() {
        dl.group(|dl| {
            dl.fade(opacity as f32);
            dl.path(p, None, Some(Stroke::solid(color, 3.0).rounded()));
        });
    }
}

impl ErView {
    fn entity_emphasis(&self, focus: &Focus, id: &str) -> Emphasis {
        let own = focus.of(&format!("e:{id}"));
        let mut others: Vec<Emphasis> = Vec::new();
        if let Some(e) = self.scene.entities.iter().find(|e| e.id == id) {
            others.extend((0..e.fields.len()).map(|k| focus.of(&format!("f:{id}/{k}"))));
        }
        for (i, r) in self.scene.relations.iter().enumerate() {
            if r.from == id || r.to == id {
                others.push(focus.of(&format!("r:{i}")));
            }
        }
        as_bright_as(own, &others)
    }

    fn relation_emphasis(&self, focus: &Focus, i: usize) -> Emphasis {
        let rel = &self.scene.relations[self.layout.relations[i].relation];
        let ends = brighter(self.entity_emphasis(focus, &rel.from), self.entity_emphasis(focus, &rel.to));
        brighter(focus.of(&format!("r:{i}")), Emphasis { glow: 0.0, bar: 0.0, ..ends })
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_field(
        &self,
        dl: &mut DisplayList,
        field: &ErField,
        text: &layout::FieldText,
        index: usize,
        at: Option<f64>,
        frame: f64,
        dimmed: bool,
        lit: f64,
        w: f32,
    ) {
        let tone = field.marks.change.as_deref().and_then(field_tone);
        let on = at.map_or(0.0, |a| interpolate(frame, &[a, a + 10.0], &[0.0, 1.0], CLAMP));
        let pulse = at.map_or(0.0, |a| interpolate(frame, &[a, a + 6.0, a + 30.0], &[0.0, 1.0, 0.0], CLAMP));
        let slide = if field.marks.change.as_deref() == Some("added") { on } else { 1.0 };
        let removed = field.marks.change.as_deref() == Some("removed");
        let struck = if removed {
            interpolate(frame, &[at.unwrap_or(0.0) + 2.0, at.unwrap_or(0.0) + 14.0], &[0.0, 1.0], CLAMP)
        } else {
            0.0
        };
        let pw = w - 4.0;
        let top = 2.0 + HEADER_H as f32 + index as f32 * ROW_H as f32;
        let bt = if index == 0 { 0.0 } else { 1.0 };
        dl.group(|dl| {
            dl.translate(2.0, top);
            dl.fade(if dimmed { 0.7 } else { 1.0 });
            if index > 0 {
                dl.fill_rect(0.0, 0.0, pw, 1.0, BORDER);
            }
            dl.translate(0.0, bt);
            let ov = |dl: &mut DisplayList, style: BoxStyle| dl.rect(6.0, 2.0, pw - 12.0, ROW_H as f32 - 4.0, style);
            if field.marks.highlighted() && field.marks.change.is_none() {
                ov(dl, BoxStyle::fill(EMPHASIS_SOFT).radius(8.0).shadow(Shadow::new(0.0, 0.0, 18.0, EMPHASIS_GLOW)));
                ov(dl, BoxStyle::empty().radius(8.0).border(EMPHASIS.alpha(0xaa as f32 / 255.0), 2.0));
            }
            if lit > 0.0 {
                let l = lit as f32;
                ov(
                    dl,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, 0.14 * l)).radius(8.0).shadow(Shadow::new(
                        0.0,
                        0.0,
                        26.0 * l,
                        ACCENT_GLOW,
                    )),
                );
                ov(dl, BoxStyle::empty().radius(8.0).border(alpha(ACCENT, (lit * 200.0).round()), 2.0));
            }
            if let Some((color, bg, _)) = tone {
                dl.group(|dl| {
                    dl.fade(on as f32);
                    ov(
                        dl,
                        BoxStyle::fill(bg).radius(8.0).shadow(Shadow::new(
                            0.0,
                            0.0,
                            (24.0 * pulse) as f32,
                            alpha(color, 0x66 as f64),
                        )),
                    );
                    ov(dl, BoxStyle::empty().radius(8.0).border(alpha(color, (pulse * 200.0).round()), 2.0));
                });
            }
            dl.group(|dl| {
                dl.fade(slide as f32);
                dl.translate(((1.0 - slide) * -36.0) as f32, 0.0);
                let h = ROW_H as f32;
                // The marker, icon, name, badges and type, centred on the row.
                let marker = tone.map_or("", |t| t.2);
                if let Some((color, _, _)) = tone {
                    let st = Style::mono(800.0, 22.0);
                    let lh = line_metrics(Face::Mono, 22.0).normal;
                    let mw = crate::text::width(marker, st);
                    dl.group(|dl| {
                        dl.fade(on as f32);
                        dl.text(
                            marker,
                            st,
                            12.0 + (18.0 - mw) / 2.0,
                            (h - lh) / 2.0 + baseline_in(Face::Mono, 22.0, lh),
                            color,
                        );
                    });
                }
                let icon = if field.pk == Some(true) {
                    Some(("KeyRound", Color::css("#e8c46a")))
                } else if field.fk == Some(true) {
                    Some(("Link2", Color::css("#8fb4ff")))
                } else {
                    None
                };
                if let Some((name, c)) = icon {
                    icons::draw_lucide(
                        dl,
                        name,
                        12.0 + 18.0 + 10.0 + (22.0 - 19.0) / 2.0,
                        (h - 19.0) / 2.0,
                        19.0,
                        c,
                        2.2,
                    );
                }
                let name_x = 12.0 + 18.0 + 10.0 + 22.0 + 10.0;
                let name_color = if removed { Color::rgba8(242, 244, 248, (1.0 - 0.45 * struck) as f32) } else { TEXT };
                let weight = if field.pk == Some(true) { 650.0 } else { 500.0 };
                let nlh = fit_height(&text.name, LineHeight::Normal);
                draw_fit(dl, &text.name, name_x, (h - nlh) / 2.0, TextOpts::new(name_color).normal().weight(weight));
                let mut bx = name_x + text.name.width as f32;
                for b in badges_of(&field.marks, false) {
                    let p = pill(&b.text, 12.0, None);
                    bx += 10.0;
                    draw_pill(dl, &p, b.color, bx, (h - p.h) / 2.0, 1.0);
                    bx += p.w;
                }
                if struck > 0.0 {
                    dl.fill_rect(name_x - 2.0, h / 2.0 - 1.0, (struck * (text.name.width + 4.0)) as f32, 2.5, DEL);
                }
                if let Some(ty) = &text.ty {
                    let tw = drawn_width(ty, &ty.lines[0], None);
                    let th = fit_height(ty, LineHeight::Normal);
                    let color = if removed { FAINT } else { MUTED };
                    draw_fit(dl, ty, pw - 18.0 - tw, (h - th) / 2.0, TextOpts::new(color).normal());
                }
            });
        });
    }

    fn draw_card(&self, dl: &mut DisplayList, i: usize, f: &Frame, focus: &Focus) {
        let placed = &self.layout.entities[i];
        let entity = &self.scene.entities[placed.entity];
        let frame = f.frame;
        let start = self.card_at[i];
        let emphasis = self.entity_emphasis(focus, &entity.id);
        let appear = spring(frame - start, FPS, Spring::damping(16.0).with_stiffness(110.0));
        let pill_scale = spring(frame - start - 12.0, FPS, Spring::damping(12.0).with_stiffness(160.0));
        let change = entity.marks.change.as_deref();
        let removed = change == Some("removed");
        let highlight = entity.marks.highlighted() && change.is_none();
        let border = match change {
            Some("added") => ADD,
            Some("removed") => alpha(DEL, 0xaa as f64),
            Some("modified") => ACCENT,
            _ if highlight => EMPHASIS,
            _ => BORDER_STRONG,
        };
        let (w, h) = (placed.w as f32, placed.h as f32);
        let g = emphasis.glow as f32;
        let mut style = BoxStyle::fill(match change {
            Some("modified") => crate::display::Paint::vertical(0.0, h, Color::css("#1c2033"), Color::css("#151826")),
            _ if highlight => emphasis_card(h),
            _ => RAISED.into(),
        })
        .radius(18.0);
        if g > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, 44.0 * g, ACCENT_GLOW));
            let mut r = Shadow::new(0.0, 0.0, 0.0, ACCENT);
            r.spread = 4.0 * g;
            style = style.shadow(r);
        }
        let ring = |c: Color, blur: f32, glow: Color, style: BoxStyle| {
            let mut r = Shadow::new(0.0, 0.0, 0.0, c);
            r.spread = 6.0;
            style.shadow(Shadow::new(0.0, 0.0, blur, glow)).shadow(r)
        };
        style = match change {
            Some("added") => ring(ADD_BG, 44.0, Color::rgba8(61, 220, 151, 0.3), style),
            Some("modified") => ring(ACCENT_SOFT, 48.0, ACCENT_GLOW, style),
            _ if highlight => ring(EMPHASIS_SOFT, 48.0, EMPHASIS_GLOW, style),
            _ => style.shadow(Shadow::new(0.0, 14.0, 36.0, Color::rgba8(0, 0, 0, 0.45))),
        };
        style = if removed {
            style.border_stroke(Stroke::dashed(border, 2.0, 6.0, 6.0))
        } else {
            style.border(border, 2.0)
        };
        let icon_color = match change {
            Some("modified") => ACCENT,
            Some(c) => change_tone(c).map_or(MUTED, |t| t.color),
            None if highlight => EMPHASIS,
            None => MUTED,
        };
        let opacity = appear * if removed { 0.6 } else { 1.0 } * emphasis.opacity;
        dl.group(|dl| {
            dl.translate(placed.x as f32, placed.y as f32);
            dl.fade(opacity as f32);
            dl.translate(0.0, ((1.0 - appear) * 24.0) as f32);
            dl.scale_about((0.92 + 0.08 * appear) as f32, w / 2.0, h / 2.0);
            dl.rect(0.0, 0.0, w, h, style);
            // The header: a tinted band with the table's icon and name.
            dl.push_clip(2.0, 2.0, w - 4.0, HEADER_H as f32, 0.0);
            dl.rect(2.0, 2.0, w - 4.0, 80.0, BoxStyle::fill(Color::rgba8(255, 255, 255, 0.035)).radius(16.0));
            dl.pop_clip();
            dl.fill_rect(2.0, 2.0 + HEADER_H as f32 - 1.0, w - 4.0, 1.0, BORDER_STRONG);
            let mid = 2.0 + (HEADER_H as f32 - 1.0) / 2.0;
            icons::draw_lucide(dl, "Table2", 2.0 + 18.0, mid - 12.0, 24.0, icon_color, 2.0);
            let nh = fit_height(&placed.name, LineHeight::Normal);
            let (nx, ny) = (2.0 + 18.0 + 24.0 + 12.0, mid - nh / 2.0);
            draw_fit(dl, &placed.name, nx, ny, TextOpts::new(TEXT).normal());
            if removed {
                let face: Face = placed.name.font.family.into();
                let lw = drawn_width(&placed.name, &placed.name.lines[0], None);
                let base = ny + baseline_in(face, placed.name.size as f32, nh);
                strike(
                    dl,
                    Style::new(face, placed.name.font.weight as f32, placed.name.size as f32),
                    nx,
                    base,
                    lw,
                    DEL,
                    Some(3.0),
                );
            }
            for (k, field) in entity.fields.iter().enumerate() {
                let lit = focus.of(&format!("f:{}/{k}", entity.id)).glow;
                self.draw_field(
                    dl,
                    field,
                    &placed.fields[k],
                    k,
                    self.field_at.get(&(placed.entity, k)).copied(),
                    frame,
                    removed,
                    lit,
                    w,
                );
            }
            let badges = badges_of(&entity.marks, true);
            if !badges.is_empty() && pill_scale.abs() >= 1e-4 {
                let ps: Vec<_> = badges.iter().map(|b| (pill(&b.text, 15.0, Some((12.0, 3.0))), b.color)).collect();
                let total: f32 = ps.iter().map(|(p, _)| p.w).sum::<f32>() + 6.0 * (ps.len() as f32 - 1.0);
                let right = w - 2.0 - 18.0;
                let top = 2.0 - 15.0;
                dl.group(|dl| {
                    dl.scale_about(pill_scale as f32, right - total / 2.0, top + ps[0].0.h / 2.0);
                    let mut x = right - total;
                    for (p, c) in &ps {
                        draw_pill(dl, p, *c, x, top, 1.0);
                        x += p.w + 6.0;
                    }
                });
            }
            let _ = corner_badges;
        });
    }

    fn draw_relation(&self, dl: &mut DisplayList, i: usize, draw: f64, em: Emphasis) {
        let routed = &self.layout.relations[i];
        let rel = &self.scene.relations[routed.relation];
        if draw <= 0.0 {
            return;
        }
        let color = relation_color(rel);
        let from_many = rel.cardinality.as_deref() == Some("many-to-many");
        let to_many = rel.cardinality.as_deref() != Some("one-to-one");
        let removed = rel.marks.change.as_deref() == Some("removed");
        let steady = match rel.marks.change.as_deref() {
            Some(c) => c != "removed",
            None => rel.marks.highlighted(),
        };
        let path = bez(&routed.d);
        let shown = trim(&path, draw);
        dl.group(|dl| {
            dl.fade(((if removed { 0.8 } else { 1.0 }) * em.opacity) as f32);
            if steady || em.glow > 0.0 {
                let c = if rel.marks.change.is_some() || rel.marks.highlighted() { color } else { ACCENT };
                let a = (if steady { 0.22 } else { 0.0 }) + 0.45 * em.glow;
                if let Some(p) = skia(&shown) {
                    dl.path(p, None, Some(Stroke::solid(c.fade(a as f32), 10.0).rounded()));
                }
            }
            if let Some(p) = skia(&shown) {
                let st = if removed {
                    Stroke::dashed(color, 3.0, 10.0, 9.0).rounded()
                } else {
                    Stroke::solid(color, 3.0).rounded()
                };
                dl.path(p, None, Some(st));
            }
            end_mark(dl, &routed.from, from_many, color, interpolate(draw, &[0.0, 0.2], &[0.0, 1.0], CLAMP));
            end_mark(dl, &routed.to, to_many, color, interpolate(draw, &[0.8, 1.0], &[0.0, 1.0], CLAMP));
        });
        let _ = Side::Left;
    }

    fn draw_label(&self, dl: &mut DisplayList, i: usize, appear: f64, em: Emphasis) {
        let routed = &self.layout.relations[i];
        let rel = &self.scene.relations[routed.relation];
        let Some(fit) = &routed.label else { return };
        let change = rel.marks.change.as_deref();
        let color = if change.is_some() || rel.marks.highlighted() { relation_color(rel) } else { MUTED };
        let single = fit.lines.len() <= 1;
        let lh = if single { LineHeight::Normal } else { LineHeight::Fit };
        let th = fit_height(fit, lh);
        let (w, h) = ((fit.width + 24.0 + 2.0) as f32, th + 8.0 + 2.0);
        let g = em.glow as f32;
        let highlight = rel.marks.highlighted() && change.is_none();
        dl.group(|dl| {
            dl.translate(routed.mid.x as f32, routed.mid.y as f32);
            dl.fade((appear * em.opacity) as f32);
            dl.scale_about(((0.9 + 0.1 * appear) * (1.0 + 0.06 * em.glow)) as f32, 0.0, 0.0);
            dl.translate(-w / 2.0, -h / 2.0);
            let border = if g > 0.0 {
                ACCENT
            } else if change.is_some() || rel.marks.highlighted() {
                color.alpha(0x88 as f32 / 255.0)
            } else {
                BORDER_STRONG
            };
            let mut style = BoxStyle::fill(Color::css("#0d0f16")).radius(10.0).border(border, 1.0);
            if g > 0.0 {
                style = style.shadow(Shadow::new(0.0, 0.0, 22.0 * g, ACCENT_GLOW));
            } else if highlight {
                style = style.shadow(Shadow::new(0.0, 0.0, 18.0, EMPHASIS_GLOW));
            }
            dl.rect(0.0, 0.0, w, h, style);
            let (cx, cy) = (1.0 + 12.0, 1.0 + 4.0);
            let cw = fit.width as f32;
            draw_fit(
                dl,
                fit,
                cx,
                cy,
                TextOpts { align: Align::Center, width: cw, line_height: lh, ..TextOpts::new(color) },
            );
            if change == Some("removed") {
                let face: Face = fit.font.family.into();
                let line_h = th / fit.lines.len().max(1) as f32;
                for (k, line) in fit.lines.iter().enumerate() {
                    let lw = drawn_width(fit, line, None);
                    let base = cy + k as f32 * line_h + baseline_in(face, fit.size as f32, line_h);
                    strike(
                        dl,
                        Style::new(face, fit.font.weight as f32, fit.size as f32),
                        cx + (cw - lw) / 2.0,
                        base,
                        lw,
                        color,
                        None,
                    );
                }
            }
            let badges = badges_of(&rel.marks, false);
            corner_badges(dl, &badges, 12.0, w + 4.0, -19.0, 1.0);
        });
    }
}

impl SceneView for ErView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let focus = Focus::new(&self.targets, f.segments, frame);
        let layout = &self.layout;
        let used: Vec<&str> = self.legend.to_vec();
        let aside_fn = |dl: &mut DisplayList, right: f32, top: f32| draw_aside(dl, &used, None, None, right, top);
        let aside = Aside { height: aside_height(&used, None), draw: &aside_fn };
        self.shell.draw(dl, frame, f.duration, Some(aside), |dl, bx| {
            let (lw, lh) = (layout.width, layout.height);
            let draws: Vec<f64> = self
                .relation_at
                .iter()
                .map(|&at| interpolate(frame, &[at, at + RELATION_FRAMES], &[0.0, 1.0], CLAMP))
                .collect();
            dl.group(|dl| {
                dl.translate((bx.w - lw as f32) / 2.0, (bx.h - lh as f32) / 2.0);
                dl.scale_about(self.scale as f32, (lw / 2.0) as f32, (lh / 2.0) as f32);
                for (i, &draw) in draws.iter().enumerate() {
                    self.draw_relation(dl, i, draw, self.relation_emphasis(&focus, i));
                }
                for i in 0..layout.entities.len() {
                    self.draw_card(dl, i, f, &focus);
                }
                for (i, &draw) in draws.iter().enumerate() {
                    if layout.relations[i].label.is_some() {
                        self.draw_label(
                            dl,
                            i,
                            interpolate(draw, &[0.6, 1.0], &[0.0, 1.0], CLAMP),
                            self.relation_emphasis(&focus, i),
                        );
                    }
                }
            });
            // TODO(marks): PenMarks.
            // TODO(camera): the scene's generic `camera` field.
        });
    }
}
