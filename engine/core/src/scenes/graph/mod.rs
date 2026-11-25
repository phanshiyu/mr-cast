//! The graph scene: nodes as cards, flowchart shapes or groups, routed edges with labels, an optional table beside
//! it, and steps that light, show, tint and change parts of it. A port of src/components/GraphDiagram.tsx,
//! ShapeNode.tsx, NodeCard.tsx, src/utils/graphLayout.ts and src/utils/tableLayout.ts.

mod layout;
pub mod model;
mod node;
mod text;

use super::table::layout::{Layout as TableLayout, layout_table_states, state_rows, table_boxes, table_of};
use super::table::view::{TableDraw, draw_table};
use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::camera::Camera;
use crate::chrome::callout::{HeaderCallout, aside_height, draw_aside, has_callout, header_box};
use crate::chrome::fittext::{Align, TextOpts, draw_fit, drawn_width};
use crate::chrome::marks::badge_words;
use crate::chrome::marks::{BadgeSpec, EMPHASIS, EMPHASIS_GLOW, badges_of, change_tone};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::diagram::{bez, end_dir, marker, skia, start_dir, strike, trim};
use crate::display::{BoxStyle, DisplayList, Shadow, Stroke};
use crate::marks::geometry::{Bx, Pt};
use crate::marks::{Board, LayoutBoxes, MarkTargets, Stage, StepRefs, around};
use crate::scenes::refs::target_steps;
use crate::states::{SceneState, StateFrame, walk_states};
use crate::steps::Emphasis;
use crate::steps::{FocusSpotlight as Focus, as_bright_as, brighter};
use crate::text::{Face, Style, baseline_in};
use crate::textfit::Fit;
use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, ADD, BORDER_STRONG, DEL, MUTED, RAISED, TEXT, content_box, tone};
use crate::timing::{FPS, build_frames};
use layout::{GraphEdge, GraphLayout, GraphNode, Shape, fit_graph, graph_direction};
use node::NodeState;
use serde::Deserialize;
use std::collections::HashMap;

const NODE_START: f64 = 8.0;
const NODES_END: f64 = 20.0;
const EDGE_DRAW: f64 = 12.0;
const EDGE_LABEL_END: f64 = 16.0;
const TABLE_SHARE: f64 = 0.4;
const TABLE_GAP: f64 = 48.0;
const BADGE_LIFT: f64 = 16.0;

fn muted_edge() -> Color {
    Color::rgba8(170, 178, 200, 0.55)
}

#[derive(Deserialize)]
struct GraphScene {
    nodes: Vec<GraphNode>,
    #[serde(default)]
    edges: Vec<GraphEdge>,
    #[serde(default)]
    layout: Option<String>,
}

struct GraphView {
    shell: Shell,
    scene: serde_json::Value,
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    layout: GraphLayout,
    scale: f64,
    graph_box: (f64, f64),
    full: (f64, f64),
    table_w: f64,
    table_columns: usize,
    tables: Vec<TableLayout>,
    callouts: Option<HeaderCallout>,
    legend: Vec<&'static str>,
    flowchart: bool,
    table_top: f64,
    marks: Vec<MarkTargets>,
    board: Board,
    camera: Camera,
}

/// Nodes carry badges; the legend decodes the colours of changed edges, so it shows only when an edge changes.
fn legend_changes(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<&'static str> {
    if !edges.iter().any(|e| e.change.is_some()) {
        return Vec::new();
    }
    let mut used: Vec<&'static str> = Vec::new();
    let all = nodes.iter().map(|n| n.marks.change.as_deref()).chain(edges.iter().map(|e| e.change.as_deref()));
    for c in all.flatten() {
        let c: &'static str = match c {
            "added" => "added",
            "removed" => "removed",
            "modified" => "modified",
            _ => continue,
        };
        if !used.contains(&c) {
            used.push(c);
        }
    }
    used
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: GraphScene = parse(input)?;
    if scene.nodes.is_empty() {
        return Err("a graph scene without nodes".into());
    }
    let json = input.scene;
    let callouts = HeaderCallout::new(json);
    let (fw, fh) = if has_callout(json) { header_box(json) } else { content_box(false) };
    let table = json.get("table").filter(|t| !t.is_null());
    let table_w = if table.is_some() { crate::timing::js_round(fw * TABLE_SHARE) } else { 0.0 };
    let graph_box = (fw - if table.is_some() { table_w + TABLE_GAP } else { 0.0 }, fh);
    let states = walk_states(&model::Model(json), json);
    let dir = graph_direction(scene.layout.as_deref(), &scene.nodes);
    let (layout, layout_scale) = fit_graph(&scene.nodes, &scene.edges, dir, graph_box);
    let (table_columns, table_rows) = table.map(table_of).unwrap_or_default();
    let tables = if table_rows.is_empty() || table_columns.is_empty() {
        Vec::new()
    } else {
        layout_table_states(&table_columns, &state_rows(&table_columns, &table_rows, &states), table_w, fh)
    };
    let table_top = if tables.is_empty() {
        0.0
    } else {
        ((fh - tables.iter().map(|t| t.height * t.scale).fold(0.0, f64::max)) / 2.0).max(0.0)
    };
    let graph = Stage::centred(graph_box, (layout.width, layout.height), layout_scale)
        .targets(&graph_boxes(&layout, &scene.nodes), (fw, fh));
    let marks: Vec<MarkTargets> = (1..states.len())
        .map(|k| match tables.get(k) {
            Some(t) => graph.clone().merged(
                Stage { left: fw - table_w, top: table_top, scale: t.scale }.targets(&table_boxes(t), (fw, fh)),
            ),
            None => graph.clone(),
        })
        .collect();
    let refs = crate::scenes::refs::SceneRefs(json);
    let step_refs = StepRefs::Scene(&refs);
    let board = Board::new(json, input.segments, &step_refs, &|k| marks.get(k).cloned(), &|_| None);
    let camera = Camera::new(json, &step_refs, header_box(json));
    Ok(Box::new(GraphView {
        marks,
        board,
        camera,
        shell: Shell::new(json),
        scene: json.clone(),
        flowchart: scene.nodes.iter().any(|n| n.shape() == Shape::Decision),
        legend: legend_changes(&scene.nodes, &scene.edges),
        targets: target_steps(json),
        nodes: scene.nodes,
        edges: scene.edges,
        states,
        layout,
        scale: layout_scale,
        graph_box,
        full: (fw, fh),
        table_w,
        table_columns: table_columns.len(),
        tables,
        callouts,
        table_top,
    }))
}

struct EdgeTone {
    stroke: Color,
    marker: Color,
}

fn marker_color(name: &str) -> Color {
    match name {
        "muted" => Color::rgba8(170, 178, 200, 0.8),
        "emphasis" => EMPHASIS,
        "accent" => ACCENT,
        "added" | "good" => ADD,
        "removed" | "bad" => DEL,
        other => tone(other).0,
    }
}

impl GraphView {
    fn highlighted(&self, id: &str) -> bool {
        self.nodes.iter().find(|n| n.id == id).is_some_and(|n| n.marks.highlighted() && n.marks.change.is_none())
    }

    /// An edge's colour: its own change, else highlighted, either itself or by joining two highlighted nodes, else plain.
    fn edge_tone(&self, e: &GraphEdge) -> EdgeTone {
        if let Some(t) = e.change.as_deref().and_then(change_tone) {
            let m = if e.change.as_deref() == Some("modified") { "accent" } else { e.change.as_deref().unwrap_or("") };
            return EdgeTone { stroke: t.color, marker: marker_color(m) };
        }
        if e.highlight == Some(true) || (self.highlighted(&e.from) && self.highlighted(&e.to)) {
            return EdgeTone { stroke: EMPHASIS, marker: marker_color("emphasis") };
        }
        EdgeTone { stroke: muted_edge(), marker: marker_color("muted") }
    }

    /// An edge's colour: a tone a step keeps on it, over its own change or highlight.
    fn tinted_tone(&self, base: EdgeTone, s: &StateFrame, key: &str) -> EdgeTone {
        match s.tint(key).main_tone() {
            Some("accent") => EdgeTone { stroke: ACCENT, marker: marker_color("accent") },
            Some(t) => EdgeTone { stroke: tone(t).0, marker: marker_color(t) },
            None => base,
        }
    }

    fn edge_style<'a>(&self, e: &'a GraphEdge) -> &'a str {
        match e.style.as_deref() {
            Some(s) => s,
            None => {
                if matches!(e.direction.as_deref(), None | Some("forward")) && !self.flowchart {
                    "flow"
                } else {
                    "solid"
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_edge(
        &self,
        dl: &mut DisplayList,
        i: usize,
        draw: f64,
        frame: f64,
        tone: EdgeTone,
        em: Emphasis,
        fade: f64,
    ) {
        let routed = &self.layout.edges[i];
        let edge = &self.edges[routed.edge];
        if draw <= 0.0 {
            return;
        }
        let direction = edge.direction.as_deref().unwrap_or("forward");
        let style = self.edge_style(edge);
        let removed = edge.change.as_deref() == Some("removed");
        let path = bez(&routed.d);
        let shown = trim(&path, draw);
        let heads_opacity = interpolate(draw, &[0.85, 1.0], &[0.0, 1.0], CLAMP) as f32;
        dl.group(|dl| {
            dl.fade((em.opacity * fade * if removed { 0.78 } else { 1.0 }) as f32);
            let changed = edge.change.is_some() && !removed;
            let hl = edge.highlight == Some(true);
            if em.glow > 0.0 || changed || hl {
                let lit = em.glow > 0.0 && edge.change.is_none() && !hl;
                let c = if lit { ACCENT } else { tone.stroke };
                let a = (if changed || hl { 0.22 } else { 0.0 }) + 0.45 * em.glow;
                if let Some(p) = skia(&shown) {
                    dl.path(p, None, Some(Stroke::solid(c.fade(a as f32), 10.0).rounded()));
                }
            }
            let heads = |dl: &mut DisplayList| {
                dl.group(|dl| {
                    dl.fade(heads_opacity);
                    if direction != "none"
                        && let Some((p, d)) = end_dir(&path)
                    {
                        marker(dl, (p.x as f32, p.y as f32), (d.0 as f32, d.1 as f32), 3.0, tone.marker);
                    }
                    if direction == "both"
                        && let Some((p, d)) = start_dir(&path)
                    {
                        marker(dl, (p.x as f32, p.y as f32), (-d.0 as f32, -d.1 as f32), 3.0, tone.marker);
                    }
                });
            };
            if style == "flow" && !removed {
                if let Some(p) = skia(&shown) {
                    dl.path(p, None, Some(Stroke::solid(tone.stroke.fade(0.25), 3.0)));
                }
                if let Some(p) = skia(&path) {
                    dl.group(|dl| {
                        dl.fade(heads_opacity);
                        dl.path(
                            p,
                            None,
                            Some(Stroke::dashed(tone.stroke, 3.0, 10.0, 12.0).rounded().offset(-(frame * 1.4) as f32)),
                        );
                    });
                }
                heads(dl);
            } else {
                if let Some(p) = skia(&shown) {
                    let st = if style == "dashed" || removed {
                        Stroke::dashed(tone.stroke, 3.0, 10.0, 9.0).rounded()
                    } else {
                        Stroke::solid(tone.stroke, 3.0).rounded()
                    };
                    dl.path(p, None, Some(st));
                }
                heads(dl);
            }
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_edge_label(&self, dl: &mut DisplayList, i: usize, appear: f64, em: Emphasis, tinted: Option<Color>) {
        let routed = &self.layout.edges[i];
        let Some(label) = &routed.label else { return };
        let edge = &self.edges[routed.edge];
        let change = edge.change.as_deref().and_then(change_tone);
        let highlight = edge.highlight == Some(true) && change.is_none();
        let color = change.map(|c| c.color).or(tinted).unwrap_or(if highlight { EMPHASIS } else { MUTED });
        let fit: &Fit = &label.text;
        let w = (fit.width + 2.0 * layout::LABEL_PAD.0 + 2.0) as f32;
        let h = (fit.lines.len() as f64 * fit.size * fit.line_height + 2.0 * layout::LABEL_PAD.1 + 2.0) as f32;
        let g = em.glow as f32;
        dl.group(|dl| {
            dl.translate(label.x as f32, label.y as f32);
            dl.fade((appear * em.opacity) as f32);
            dl.scale_about(((0.9 + 0.1 * appear) * (1.0 + 0.06 * em.glow)) as f32, 0.0, 0.0);
            dl.translate(-w / 2.0, -h / 2.0);
            let border = if g > 0.0 {
                ACCENT
            } else if change.is_some() || highlight || tinted.is_some() {
                color.alpha(0x99 as f32 / 255.0)
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
            let ink = if g > 0.0 && change.is_none() { TEXT } else { color };
            let (cx, cy) = (1.0 + layout::LABEL_PAD.0 as f32, 1.0 + layout::LABEL_PAD.1 as f32);
            let cw = fit.width as f32;
            draw_fit(dl, fit, cx, cy, TextOpts { align: Align::Center, width: cw, ..TextOpts::new(ink) });
            if change.map(|_| edge.change.as_deref()) == Some(Some("removed")) {
                let lh = fit.size as f32 * fit.line_height as f32;
                let face: Face = fit.font.family.into();
                for (k, line) in fit.lines.iter().enumerate() {
                    let lw = drawn_width(fit, line, None);
                    let base = cy + k as f32 * lh + baseline_in(face, fit.size as f32, lh);
                    strike(
                        dl,
                        Style::new(face, fit.font.weight as f32, fit.size as f32),
                        cx + (cw - lw) / 2.0,
                        base,
                        lw,
                        ink,
                        None,
                    );
                }
            }
        });
    }

    fn draw_group(&self, dl: &mut DisplayList, g: &layout::PlacedGroup, appear: f64, em: Emphasis) {
        let glow = em.glow as f32;
        dl.group(|dl| {
            dl.fade((appear * em.opacity.max(0.7)) as f32);
            let mut style = BoxStyle::fill(if glow > 0.0 {
                Color::rgba8(124, 140, 255, 0.04 + 0.05 * glow)
            } else {
                Color::rgba8(255, 255, 255, 0.025)
            })
            .radius(26.0)
            .border(if glow > 0.0 { ACCENT } else { Color::rgba8(255, 255, 255, 0.1) }, 2.0);
            if glow > 0.0 {
                style = style.shadow(Shadow::new(0.0, 0.0, 40.0 * glow, ACCENT_SOFT));
            }
            dl.rect(g.x as f32, g.y as f32, g.width as f32, g.height as f32, style);
            let lw = drawn_width(&g.label, &g.label.lines[0], None);
            let x = if g.name_left {
                g.x as f32 + 2.0 + layout::GROUP_NAME.0 as f32
            } else {
                (g.x + g.width) as f32 - 2.0 - layout::GROUP_NAME.0 as f32 - lw
            };
            draw_fit(
                dl,
                &g.label,
                x,
                g.y as f32 + 2.0 + layout::GROUP_NAME.1 as f32,
                TextOpts::new(if glow > 0.0 { ACCENT } else { MUTED }).normal(),
            );
        });
    }
}

impl SceneView for GraphView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let s = StateFrame::at(&self.states, f.segments, frame);
        let focus = Focus::borrowed(&self.targets, f.segments, frame);
        let layer_stagger = 6f64.min((NODES_END - NODE_START) / ((self.layout.layer_count as f64) - 1.0).max(1.0));
        let edge_stagger = 4f64.min(
            (build_frames("graph") - NODES_END - EDGE_LABEL_END) / ((self.layout.edges.len() as f64) - 1.0).max(1.0),
        );
        let edge_at = |i: usize| NODES_END + i as f64 * edge_stagger;
        let edge_shown = |e: &GraphEdge, i: usize| {
            s.shown(&format!("e:{i}")).min(s.shown(&format!("n:{}", e.from))).min(s.shown(&format!("n:{}", e.to)))
        };
        let node_emphasis = |n: &GraphNode| -> Emphasis {
            let own = match &n.group {
                Some(g) => brighter(focus.emphasis(&format!("n:{}", n.id)), focus.emphasis(&format!("g:{g}"))),
                None => focus.emphasis(&format!("n:{}", n.id)),
            };
            let adjacent: Vec<Emphasis> = self
                .edges
                .iter()
                .enumerate()
                .filter(|(_, e)| e.from == n.id || e.to == n.id)
                .map(|(i, _)| focus.emphasis(&format!("e:{i}")))
                .collect();
            as_bright_as(own, &adjacent)
        };
        let used: Vec<&str> = self.legend.to_vec();
        let aside_h = aside_height(&used, self.callouts.as_ref());
        let draw_aside_fn = |dl: &mut DisplayList, right: f32, top: f32| {
            draw_aside(dl, &used, self.callouts.as_ref(), Some(&s), right, top);
        };
        let aside = Aside { height: aside_h, draw: &draw_aside_fn };
        let view = self.camera.view(frame, f.segments, &|k| self.marks.get(k).cloned());
        self.shell.draw(dl, frame, f.duration, Some(aside), |dl, _bx| {
            self.camera.draw(dl, view, |dl| {
                let (gw, gh) = self.graph_box;
                let (lw, lh) = (self.layout.width, self.layout.height);
                dl.group(|dl| {
                    dl.translate(((gw - lw) / 2.0) as f32, ((gh - lh) / 2.0) as f32);
                    dl.scale_about(self.scale as f32, (lw / 2.0) as f32, (lh / 2.0) as f32);
                    for g in &self.layout.groups {
                        let appear = interpolate(
                            frame,
                            &[
                                NODE_START - 4.0 + g.layer as f64 * layer_stagger,
                                NODE_START + 6.0 + g.layer as f64 * layer_stagger,
                            ],
                            &[0.0, 1.0],
                            CLAMP,
                        );
                        self.draw_group(dl, g, appear, focus.emphasis(&format!("g:{}", g.name)));
                    }
                    for (i, routed) in self.layout.edges.iter().enumerate() {
                        let key = format!("e:{}", routed.edge);
                        let shown = edge_shown(&self.edges[routed.edge], routed.edge);
                        let built = interpolate(frame, &[edge_at(i), edge_at(i) + EDGE_DRAW], &[0.0, 1.0], CLAMP);
                        let tone = self.tinted_tone(self.edge_tone(&self.edges[routed.edge]), &s, &key);
                        let fade = s.tint(&key).dim_opacity();
                        self.draw_edge(dl, i, built.min(shown), frame, tone, focus.emphasis(&key), fade);
                    }
                    for placed in &self.layout.nodes {
                        let base = &self.nodes[placed.node];
                        let shown_state = if s.t < 0.5 { s.before } else { s.now };
                        let mut node = base.clone();
                        if let Some(model::Val::Text(b)) = model::val(shown_state, &format!("b:{}", base.id))
                            && Some(b.as_str()) != Some(base.marks.badge.as_deref().unwrap_or(""))
                        {
                            node.marks.badge = if b.is_empty() { None } else { Some(b.clone()) };
                        }
                        let key = format!("n:{}", node.id);
                        let appear = spring(
                            frame - NODE_START - placed.layer as f64 * layer_stagger,
                            FPS,
                            Spring::damping(16.0).with_stiffness(110.0),
                        ) * s.shown(&key);
                        let Some(text) = self.layout.texts.get(&node.id) else { continue };
                        let badges: Vec<BadgeSpec> = badges_of(&node.marks, true);
                        let st = NodeState {
                            node: &node,
                            badges,
                            x: placed.x as f32,
                            y: placed.y as f32,
                            w: placed.w as f32,
                            h: placed.h as f32,
                            text,
                            emphasis: node_emphasis(&node),
                            appear,
                            tint: s.tint(&key),
                        };
                        match node.shape() {
                            Shape::Card => node::draw_card(dl, &st),
                            shape => node::draw_shape(dl, &st, shape),
                        }
                    }
                    for (i, routed) in self.layout.edges.iter().enumerate() {
                        if routed.label.is_none() {
                            continue;
                        }
                        let key = format!("e:{}", routed.edge);
                        let mix = s.tint(&key);
                        let tinted = mix.main_tone().map(|t| tone(t).0);
                        let appear = interpolate(
                            frame,
                            &[edge_at(i) + EDGE_DRAW - 4.0, edge_at(i) + EDGE_LABEL_END],
                            &[0.0, 1.0],
                            CLAMP,
                        ) * edge_shown(&self.edges[routed.edge], routed.edge)
                            * mix.dim_opacity();
                        self.draw_edge_label(dl, i, appear, focus.emphasis(&key), tinted);
                    }
                });
                self.draw_table(dl, &s, &focus, frame);
                self.board.draw(dl, frame, f.segments, &|_| None);
            })
        });
        let _ = (&self.scene, RAISED);
    }
}

impl GraphView {
    fn draw_table(&self, dl: &mut DisplayList, s: &StateFrame, focus: &Focus, frame: f64) {
        if self.tables.is_empty() {
            return;
        }
        let cell = |row: usize, col: usize| {
            brighter(focus.emphasis(&format!("c:{col}")), focus.emphasis(&format!("x:{row}/{col}")))
        };
        let row_emphasis = |row: usize| {
            let own = focus.emphasis(&format!("r:{row}"));
            let o = (0..self.table_columns).map(|c| cell(row, c).opacity).fold(own.opacity, f64::max);
            Emphasis { opacity: o, ..own }
        };
        let draw = TableDraw {
            layout: &self.tables[s.now_index],
            before: &self.tables[s.before_index],
            s,
            left: (self.full.0 - self.table_w) as f32,
            top: self.table_top as f32,
            frame,
            header_in: interpolate(frame, &[NODES_END, NODES_END + 10.0], &[0.0, 1.0], CLAMP),
            row_at: &|i| NODES_END + 4.0 + i as f64 * 3.0,
            row_emphasis: &row_emphasis,
            cell_emphasis: &cell,
            header_glow: &|i| focus.emphasis(&format!("c:{i}")).glow,
        };
        draw_table(dl, &draw);
    }
}

/// The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a node's card, an edge's
/// label (or its middle, when it has none), a group's box. A note keeps off the cards, the labels and the group names
/// (`graphBoxes`).
fn graph_boxes(layout: &GraphLayout, nodes: &[GraphNode]) -> LayoutBoxes {
    // Badges sit on a card's top edge, so a mark around the card takes them in.
    let card = |p: &layout::PositionedNode| {
        let lift = if badge_words(&nodes[p.node].marks).is_empty() { 0.0 } else { BADGE_LIFT };
        Bx::new(p.x, p.y - lift, p.w, p.h + lift)
    };
    let edge = |r: &layout::RoutedEdge| match &r.label {
        Some(l) => around(Pt { x: l.x, y: l.y }, l.width, l.height),
        None => around(Pt { x: r.mid.x, y: r.mid.y }, 40.0, 40.0),
    };
    let mut out = LayoutBoxes::default();
    for p in &layout.nodes {
        out.add(format!("n:{}", nodes[p.node].id), card(p));
    }
    for r in &layout.edges {
        out.add(format!("e:{}", r.edge), edge(r));
    }
    for g in &layout.groups {
        out.add(format!("g:{}", g.name), Bx::new(g.x, g.y, g.width, g.height));
    }
    let mut obstacles: Vec<Bx> = layout.nodes.iter().map(card).collect();
    obstacles.extend(layout.edges.iter().filter(|r| r.label.is_some()).map(edge));
    obstacles.extend(layout.groups.iter().map(|g| Bx::new(g.x, g.y, g.width, layout::GROUP_HEAD)));
    out.obstacles = Some(obstacles);
    out.lines = layout.edges.iter().flat_map(|r| r.points.iter().map(|p| Pt { x: p.x, y: p.y })).collect();
    out
}
