//! The svg scene: a drawing in SVG markup that steps light, colour, show, hide, move, morph and trace by element
//! id. A port of src/components/SvgDiagram.tsx with shared/svg.mjs, shared/svg-motion.mjs and
//! shared/state-steps.mjs. Each frame writes the drawing as the component would render it and rasterizes it with
//! resvg.

#![allow(clippy::type_complexity)]

pub mod motion;
pub mod tree;

use super::media::{self, drop_shadow_filter_in, hash64, raster_svg, xml_escape};
use super::{Frame, SceneInput, SceneView};
use crate::anim::{Spring, spring};
use crate::camera::View;
use crate::chrome::callout::HeaderCallout;
use crate::chrome::callout::header_box;
use crate::chrome::shell::{Aside, Shell};
use crate::marks::geometry::Bx;
use crate::marks::{MarkTargets, NoRefs, Pen, Refs};
use crate::states::{ClosureModel, SceneState, StateFrame, TintMix, walk_states};
use crate::steps::FocusSpotlight;
use crate::steps::{Emphasis, current_step};
use crate::text::Face;
use crate::timing::{FPS, STEP_SETTLE_FRAMES, Segment};
use motion::{PairedShape, pair_shapes, trace_length, tween_shape, tween_transform};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tree::{Drawing, Elem, Node, SVG_COLORS, SVG_TONES, read_svg, stage, text_of};

const START: f64 = 6.0;
const STAGGER: f64 = 3.0;
const STAGGER_END: f64 = 22.0;
const BLEED: f64 = 32.0;
const AREAS: &[&str] = &["rect", "circle", "ellipse", "polygon"];
const LINES: &[&str] = &["line", "polyline", "path"];
const TRACEABLE: &[&str] = &["path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "g"];
const GEOMETRY: &[&str] =
    &["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "d"];
const TRACE_SPEED: f64 = 40.0;
const TRACE_MIN: f64 = 12.0;
const TRACE_MAX: f64 = 75.0;
const FLOW_DASH: [f64; 2] = [10.0, 12.0];
const FLOW_SPEED: f64 = 1.4;
const ACCENT: &str = "#7c8cff";

fn is_leaf(tag: &str) -> bool {
    AREAS.contains(&tag) || LINES.contains(&tag) || tag == "text" || tag == "tspan" || tag == "use"
}

/// Whether a node is a tspan with an id, or holds one.
fn named_tspan(node: &Node) -> bool {
    match node {
        Node::Elem(e) => (e.tag == "tspan" && e.attr("id").is_some()) || e.children.iter().any(named_tspan),
        Node::Text(_) => false,
    }
}

pub(crate) fn tone_color(tone: &str) -> &'static str {
    match tone {
        "accent" => "#7c8cff",
        "good" => "#3ddc97",
        "bad" => "#ff6b7a",
        "warn" => "#fbbf24",
        _ => "#8f98ad",
    }
}

fn palette(name: &str) -> &'static str {
    SVG_COLORS.iter().find(|(k, _)| *k == name).map_or("", |(_, v)| v)
}

fn resolve_vars(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(i) = rest.find("var(") {
        let after = &rest[i + 4..];
        let Some(j) = after.find(')') else { break };
        let inner = after[..j].trim();
        match inner.strip_prefix("--").filter(|n| SVG_COLORS.iter().any(|(k, _)| k == n)) {
            Some(n) => {
                out.push_str(&rest[..i]);
                out.push_str(palette(n));
            }
            None => out.push_str(&rest[..i + 4 + j + 1]),
        }
        rest = &after[j + 1..];
    }
    out.push_str(rest);
    out
}

fn prefix_refs(name: &str, value: &str, prefix: &str) -> String {
    if name == "href" || name == "xlink:href" {
        return format!("#{prefix}{}", value.get(1..).unwrap_or(""));
    }
    let mut out = String::new();
    let mut rest = value;
    while let Some(i) = rest.find("url(") {
        let after = &rest[i + 4..];
        let Some(j) = after.find(')') else { break };
        let inner = after[..j].trim().trim_matches(|c| c == '\'' || c == '"');
        match inner.strip_prefix('#') {
            Some(id) if !id.is_empty() && !id.contains(char::is_whitespace) => {
                out.push_str(&rest[..i]);
                out.push_str(&format!("url(#{prefix}{id})"));
            }
            _ => out.push_str(&rest[..i + 4 + j + 1]),
        }
        rest = &after[j + 1..];
    }
    out.push_str(rest);
    out
}

#[derive(Default)]
struct ClassTones {
    tone: Option<String>,
    fill: Option<String>,
    stroke: Option<String>,
}

fn class_tones(cls: Option<&str>) -> ClassTones {
    let mut out = ClassTones::default();
    for c in cls.unwrap_or("").split_whitespace() {
        let mut parts = c.split('-');
        let (Some(kind), Some(tone), None) = (parts.next(), parts.next(), parts.next()) else { continue };
        if !SVG_TONES.contains(&tone) {
            continue;
        }
        match kind {
            "tone" => out.tone = Some(tone.into()),
            "fill" => out.fill = Some(tone.into()),
            "stroke" => out.stroke = Some(tone.into()),
            _ => {}
        }
    }
    out
}

/// An element's attributes as a list; `set_default` is JS's `??=`.
#[derive(Clone, Default)]
struct Props(Vec<(String, String)>);

impl Props {
    fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
    fn set(&mut self, k: &str, v: impl Into<String>) {
        let v = v.into();
        if let Some(s) = self.0.iter_mut().find(|(n, _)| n == k) {
            s.1 = v;
        } else {
            self.0.push((k.to_string(), v));
        }
    }
    fn set_default(&mut self, k: &str, v: impl Into<String>) {
        if self.get(k).is_none() {
            self.set(k, v);
        }
    }
    fn remove(&mut self, k: &str) {
        self.0.retain(|(n, _)| n != k);
    }
}

/// The face text in `font-family` `font` is drawn in: JetBrains Mono for a mono family, else the board's handwriting
/// on the board and Inter off it.
fn face_of(font: &str) -> Face {
    if font.to_lowercase().contains("mono") {
        Face::Mono
    } else if crate::look::board() {
        Face::Hand
    } else {
        Face::Sans
    }
}

/// Text as markup, each run of characters `face` lacks in a `tspan` naming the bundled font that has them, as Chrome
/// and the engine's own text fall back per character. Left to itself resvg falls back for the whole line.
fn text_runs(text: &str, face: Face) -> String {
    crate::text::font_runs(face, text)
        .into_iter()
        .map(|(font, from, to)| {
            let run = xml_escape(&text[from..to]);
            if font == face as u8 {
                run
            } else {
                format!("<tspan font-family=\"{}\">{run}</tspan>", media::svg_family(font))
            }
        })
        .collect()
}

fn el(tag: &str, props: &Props, children: &str) -> String {
    let mut s = format!("<{tag}");
    for (k, v) in &props.0 {
        s.push_str(&format!(" {k}=\"{}\"", xml_escape(v)));
    }
    if children.is_empty() {
        s.push_str("/>");
    } else {
        s.push_str(&format!(">{children}</{tag}>"));
    }
    s
}

fn fnum(n: f64) -> String {
    motion::js_num(n)
}

#[derive(Clone)]
struct Inherited {
    fill: bool,
    stroke: bool,
    emphasis: Emphasis,
    tint: Option<Arc<TintMixed>>,
    font: String,
    trace: Option<f64>,
    flow: bool,
    /// Inside a text drawn run by run: each run, a tspan or the text's own words, carries its light and tint as
    /// its fill's opacity, so one word can be lit or dimmed apart from the rest of its sentence.
    runs: bool,
}

struct TintMixed(TintMix);

use crate::steps::brighter;

struct Svg {
    drawing: Drawing,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    prefix: String,
    shell: Shell,
    callout: Option<HeaderCallout>,
    box_w: f64,
    box_h: f64,
    pairs: Mutex<HashMap<(String, String), Option<Arc<PairedShape>>>>,
    pen: Pen,
    /// The words each element goes by, by key: its label, its own text, and its id read as words.
    names: HashMap<String, Vec<String>>,
}

struct Draw<'a> {
    s: &'a StateFrame<'a>,
    focus: &'a FocusSpotlight<'a>,
    frame: f64,
    scale: f64,
    traces: HashMap<String, f64>,
    spans: HashMap<String, f64>,
    /// How far each element a step shows or tints by name has come, from the word that names it.
    named: HashMap<String, f64>,
    /// How far each element a step shows has drawn on, from its start or the word that names it.
    drawn: HashMap<String, f64>,
    defs: RefCell<Vec<String>>,
    me: &'a Svg,
}

fn hash_of(text: &str) -> String {
    let mut h: i32 = 5381;
    for u in text.encode_utf16() {
        h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(u as i32);
    }
    format!("d{}-", radix36(h as u32))
}

fn radix36(mut n: u32) -> String {
    if n == 0 {
        return "0".into();
    }
    let mut s = Vec::new();
    while n > 0 {
        s.push(std::char::from_digit(n % 36, 36).unwrap());
        n /= 36;
    }
    s.iter().rev().collect()
}

fn value_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

impl Draw<'_> {
    fn d_of(&self, state: &SceneState, key: &str, own: Option<&str>) -> Option<String> {
        match state.shapes.get(key) {
            Some(target) => self.me.drawing.find(target).and_then(|e| e.attr("d")).map(String::from),
            None => own.map(String::from),
        }
    }

    fn shape(&self, key: &str, own: Option<&str>) -> Option<String> {
        let (was, is) = (self.d_of(self.s.before, key, own), self.d_of(self.s.now, key, own));
        match (was, is) {
            (Some(w), Some(i)) if !w.is_empty() && !i.is_empty() && w != i && self.s.t < 1.0 => {
                match self.me.paired(&w, &i) {
                    Some(p) => Some(tween_shape(&p, self.s.t)),
                    None => Some(i),
                }
            }
            (_, is) => is,
        }
    }

    /// The state frame an element changes by: the step's, or, for one the step's words name, one that changes from
    /// the word that names it.
    fn at(&self, key: &str) -> StateFrame<'_> {
        match self.named.get(key) {
            Some(&t) => StateFrame { t, ..*self.s },
            None => StateFrame { ..*self.s },
        }
    }

    fn moved(&self, key: &str) -> f64 {
        self.spans.get(key).copied().unwrap_or(self.s.t)
    }

    fn def_filter(&self, shadows: &[(f64, &str, f64)]) -> String {
        let id = format!("{}glow{}", self.me.prefix, self.defs.borrow().len());
        // The glow's region is the drawing and the reach of its widest blur. Without one, resvg sizes its buffers for
        // an effectively endless region and a frame with a lit shape takes seconds.
        let [vx, vy, vw, vh] = self.me.drawing.view_box;
        let reach = shadows.iter().map(|s| s.0).fold(0.0, f64::max) * 1.5;
        let region = (vx - reach, vy - reach, vw + 2.0 * reach, vh + 2.0 * reach);
        self.defs.borrow_mut().push(drop_shadow_filter_in(&id, region, shadows));
        format!("url(#{id})")
    }

    fn draw(&self, node: &Node, key: &str, up: &Inherited) -> String {
        let n = match node {
            Node::Text(t) => return xml_escape(t),
            Node::Elem(e) => e,
        };
        let a = |name: &str| n.attr(name);
        let id = a("id");
        let cls = class_tones(a("class"));
        let own = id.map(|i| format!("s:{i}"));
        let emphasis = match &own {
            Some(o) => brighter(up.emphasis, self.focus.emphasis(o)),
            None => up.emphasis,
        };
        let own_tint = own.as_ref().map(|o| self.at(o).tint(o));
        let own_tint = own_tint.filter(|t| !t.tones.is_empty() || t.dim > 0.0);
        let tinted = own_tint.is_some();
        let tint: Option<Arc<TintMixed>> = match own_tint {
            Some(t) => Some(Arc::new(TintMixed(t))),
            None => up.tint.clone(),
        };
        let mut props = Props::default();
        for (name, value) in &n.attrs {
            if name == "class" || name.starts_with("xmlns") || name == "version" {
                continue;
            }
            let v = if name == "id" {
                format!("{}{}", self.me.prefix, value)
            } else {
                prefix_refs(name, &resolve_vars(value), &self.me.prefix)
            };
            props.set(name, v);
        }
        let has_fill = up.fill || a("fill").is_some() || cls.tone.is_some() || cls.fill.is_some();
        let has_stroke = up.stroke || a("stroke").is_some() || cls.tone.is_some() || cls.stroke.is_some();
        let tag = n.tag.as_str();
        let texty = tag == "text" || tag == "tspan";
        if let Some(tone) = &cls.tone {
            if texty {
                props.set_default("fill", tone_color(tone));
            } else {
                let fill = if LINES.contains(&tag) && tag != "path" {
                    "none".to_string()
                } else {
                    format!("{}40", tone_color(tone))
                };
                props.set_default("fill", fill);
                props.set_default("stroke", tone_color(tone));
            }
        }
        if let Some(t) = &cls.fill {
            props.set_default("fill", tone_color(t));
        }
        if let Some(t) = &cls.stroke {
            props.set_default("stroke", tone_color(t));
        }
        if tag == "tspan"
            && let Some(f) = a("font-family")
        {
            props.set("font-family", media::svg_family(face_of(f) as u8));
        }
        if tag == "text" {
            if !has_fill {
                props.set("fill", palette("text"));
            }
            props.set("font-family", media::svg_family(face_of(a("font-family").unwrap_or(&up.font)) as u8));
        } else if AREAS.contains(&tag) {
            if !has_fill {
                props.set("fill", palette("surface"));
            }
            if !has_stroke {
                props.set("stroke", if crate::look::board() { palette("good") } else { palette("border") });
            }
        } else if LINES.contains(&tag) {
            if !has_fill {
                props.set("fill", "none");
            }
            if !has_stroke {
                props.set("stroke", if crate::look::board() { palette("good") } else { palette("muted") });
            }
        }
        let value = if tag == "text" { own.as_ref().and_then(|o| self.s.now.values.get(o)) } else { None };
        let changed = tag == "text" && own.as_ref().is_some_and(|o| self.s.before.values.get(o) != value);
        // A tspan takes its text's tint from the text, keeping a colour of its own.
        if is_leaf(tag)
            && (tag != "tspan" || tinted)
            && let Some(t) = &tint
            && let Some(tone) = t.0.main_tone()
        {
            if texty {
                props.set("fill", tone_color(tone));
            } else {
                if !LINES.contains(&tag) || tag == "path" {
                    let f = if props.get("fill") == Some("none") {
                        "none".to_string()
                    } else {
                        format!("{}40", tone_color(tone))
                    };
                    props.set("fill", f);
                }
                props.set("stroke", tone_color(tone));
            }
        }
        if crate::look::board() && AREAS.contains(&tag) {
            self.by_hand_fill(&mut props);
        }
        let shown = own.as_ref().map_or(1.0, |o| match self.drawn.get(o) {
            Some(&t) => {
                if t > 0.0 {
                    1.0
                } else {
                    0.0
                }
            }
            None => self.at(o).shown(o),
        });
        // Text a step or a continued picture rewrote, rather than the drawing's own.
        let rewritten = value.is_some_and(|v| value_text(v) != text_of(n));
        // A text with a tspan a step can name is lit run by run: an svg renderer takes no opacity on a tspan, and a
        // dimmed text would dim the word lit inside it.
        let runs = if tag == "text" { !rewritten && n.children.iter().any(named_tspan) } else { up.runs };
        let run_opacity = emphasis.opacity * tint.as_ref().map_or(1.0, |t| t.0.dim_opacity());
        let leaf_opacity = if is_leaf(tag) && !runs { run_opacity } else { 1.0 };
        let base_opacity: f64 = a("opacity").and_then(|v| v.trim().parse().ok()).unwrap_or(1.0);
        let opacity = base_opacity * shown * leaf_opacity * if changed { 0.35 + 0.65 * self.s.t } else { 1.0 };
        if tag == "tspan" {
            if runs {
                let fill: f64 = a("fill-opacity").and_then(|v| v.trim().parse().ok()).unwrap_or(1.0);
                let o = opacity * run_opacity;
                props.remove("opacity");
                if o * fill != 1.0 {
                    props.set("fill-opacity", fnum(o * fill));
                }
                if o != 1.0 {
                    props.set("stroke-opacity", fnum(o));
                }
            }
        } else if opacity != 1.0 {
            props.set("opacity", fnum(opacity));
        }
        if let Some(o) = &own {
            let g = self.focus.emphasis(o).glow;
            if g > 0.0 && crate::look::board() {
                // On the board nothing glows: what a step lights is gone over again, a heavier line.
                if !texty {
                    let sw: f64 = props.get("stroke-width").and_then(|v| v.parse().ok()).unwrap_or(2.0);
                    props.set("stroke-width", fnum(sw * (1.0 + 0.9 * g)));
                }
            } else if g > 0.0 {
                let f = self.def_filter(&[(3.0 * g, ACCENT, 1.0), (16.0 * g, ACCENT, 0.45)]);
                props.set("filter", f);
            }
            let (was, is) = (self.s.before.transforms.get(o), self.s.now.transforms.get(o));
            if was.is_some() || is.is_some() {
                let t = tween_transform(was.map_or("", |s| s), is.map_or("", |s| s), self.moved(o));
                props.set("transform", format!("{t} {}", a("transform").unwrap_or("")).trim().to_string());
            }
            if tag == "path"
                && let Some(d) = self.shape(o, a("d"))
            {
                props.set("d", d);
            }
        }
        let trace = own.as_ref().and_then(|o| self.traces.get(o).or(self.drawn.get(o)).copied()).or(up.trace);
        let flow = up.flow || a("class").is_some_and(|c| c.split_whitespace().any(|c| c == "flow"));
        let next = Inherited {
            fill: has_fill,
            stroke: has_stroke,
            emphasis,
            tint,
            font: a("font-family").map_or_else(|| up.font.clone(), String::from),
            trace,
            flow,
            runs,
        };
        let face = face_of(&next.font);
        let children = if rewritten {
            text_runs(&value_text(value.unwrap()), face)
        } else {
            n.children
                .iter()
                .enumerate()
                .map(|(i, c)| match c {
                    // The text's own words, between its tspans, are a run of their own.
                    Node::Text(t) if tag == "text" && runs && run_opacity != 1.0 => {
                        let o = fnum(run_opacity);
                        format!("<tspan fill-opacity=\"{o}\" stroke-opacity=\"{o}\">{}</tspan>", text_runs(t, face))
                    }
                    Node::Text(t) if tag == "text" || tag == "tspan" => text_runs(t, face),
                    _ => self.draw(c, &format!("{key}.{i}"), &next),
                })
                .collect::<String>()
        };
        if tag == "text"
            && let Some(t) = trace
        {
            let o: f64 = props.get("opacity").and_then(|v| v.parse().ok()).unwrap_or(1.0);
            props.set("opacity", fnum(o * t));
        }
        if !AREAS.contains(&tag) && !LINES.contains(&tag) {
            return el(tag, &props, &children);
        }
        self.motion_shape(n, key, props, &children, trace, flow)
    }

    /// On the board an area is not painted in but hatched, as a hand shades it, and a box with the plain surface
    /// colour is left open. The hatching is in the fill's colour at its alpha, a little stronger since it is lines.
    fn by_hand_fill(&self, props: &mut Props) {
        let Some(fill) = props.get("fill").map(str::to_string) else { return };
        if fill == "none" || fill.starts_with("url(") {
            return;
        }
        if fill == palette("surface") || fill == palette("bg") {
            props.set("fill", "none");
            return;
        }
        let Some((hex, alpha)) = hex_alpha(&fill) else { return };
        let defs = &mut self.defs.borrow_mut();
        let id = format!("{}hatch{}", self.me.prefix, hex.trim_start_matches('#'));
        let gap = HATCH_GAP_PX / self.scale;
        if !defs.iter().any(|d| d.contains(&format!("id=\"{id}\""))) {
            defs.push(format!(
                "<pattern id=\"{id}\" patternUnits=\"userSpaceOnUse\" width=\"{g}\" height=\"{g}\" patternTransform=\"rotate(-38)\"><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"{g}\" stroke=\"{hex}\" stroke-width=\"{w}\" stroke-linecap=\"round\"/></pattern>",
                g = fnum(gap),
                w = fnum(HATCH_WIDTH_PX / self.scale),
            ));
        }
        props.set("fill", format!("url(#{id})"));
        let fo: f64 = props.get("fill-opacity").and_then(|v| v.parse().ok()).unwrap_or(1.0);
        props.set("fill-opacity", fnum(fo * (alpha * 1.6).clamp(0.22, 0.4)));
    }

    fn motion_shape(
        &self,
        n: &Elem,
        key: &str,
        mut props: Props,
        children: &str,
        trace: Option<f64>,
        flow: bool,
    ) -> String {
        let mut tag = n.tag.as_str();
        if crate::look::board()
            && let Some(d) = rough_outline(n, &props, key, self.scale)
        {
            for g in ["x", "y", "width", "height", "x1", "y1", "x2", "y2"] {
                props.remove(g);
            }
            props.set("d", d);
            props.set("stroke-linecap", "round");
            props.set("stroke-linejoin", "round");
            tag = "path";
        }
        let tracing = trace.is_some_and(|t| t < 1.0);
        if !tracing && !flow {
            return el(tag, &props, children);
        }
        let t = trace.unwrap_or(1.0);
        if tracing {
            for m in ["marker-start", "marker-mid", "marker-end"] {
                props.remove(m);
            }
        }
        let dashed = flow || n.attr("stroke-dasharray").is_some();
        let len = shape_length(n, props.get("d"));
        if tracing && !dashed {
            props.set("stroke-dasharray", format!("{} {}", fnum(len), fnum(len)));
            props.set("stroke-dashoffset", fnum(len * (1.0 - t)));
            let fo: f64 =
                props.get("fill-opacity").or(n.attr("fill-opacity")).and_then(|v| v.parse().ok()).unwrap_or(1.0);
            props.set("fill-opacity", fnum(fo * t));
            return el(tag, &props, children);
        }
        let mut layers = String::new();
        let mut mask: Option<String> = None;
        if tracing {
            let mask_id = format!("{}trace-{}", self.me.prefix, key.replace('.', "-"));
            let mut shape = Props::default();
            let sw: f64 = n.attr("stroke-width").and_then(|v| v.parse().ok()).unwrap_or(2.0);
            shape.set("fill", "none");
            shape.set("stroke", "#fff");
            shape.set("stroke-width", fnum(sw * 3.0 + 12.0 / self.scale));
            shape.set("stroke-linecap", "round");
            shape.set("stroke-dasharray", format!("{} {}", fnum(len), fnum(len)));
            shape.set("stroke-dashoffset", fnum(len * (1.0 - t)));
            for g in GEOMETRY {
                if let Some(v) = props.get(g) {
                    shape.set(g, v);
                }
            }
            let mut mp = Props::default();
            mp.set("id", &mask_id);
            mp.set("maskUnits", "userSpaceOnUse");
            mp.set("x", "-100000");
            mp.set("y", "-100000");
            mp.set("width", "200000");
            mp.set("height", "200000");
            layers.push_str(&el("mask", &mp, &el(tag, &shape, "")));
            mask = Some(format!("url(#{mask_id})"));
        }
        if !flow {
            if let Some(m) = &mask {
                props.set("mask", m.clone());
            }
            return format!("<g>{layers}{}</g>", el(tag, &props, children));
        }
        let mut plain = props.clone();
        for k in ["id", "marker-start", "marker-mid", "marker-end"] {
            plain.remove(k);
        }
        let opacity: f64 = n.attr("stroke-opacity").and_then(|v| v.parse().ok()).unwrap_or(1.0);
        let sw: f64 = n.attr("stroke-width").and_then(|v| v.parse().ok()).unwrap_or(1.0);
        let grow = (sw * self.scale / 3.0).max(1.0);
        let dashes = n
            .attr("stroke-dasharray")
            .map(String::from)
            .unwrap_or_else(|| FLOW_DASH.iter().map(|d| fnum(d * grow / self.scale)).collect::<Vec<_>>().join(" "));
        if let Some(m) = &mask {
            plain.set("mask", m.clone());
        }
        plain.set("stroke-opacity", fnum(0.25 * opacity));
        layers.push_str(&el(tag, &plain, ""));
        let mut top = props.clone();
        if let Some(m) = &mask {
            top.set("mask", m.clone());
        }
        top.set("fill", "none");
        top.set("stroke-dasharray", dashes);
        top.set("stroke-dashoffset", fnum(-self.frame * FLOW_SPEED * grow / self.scale));
        top.set_default("stroke-linecap", "round");
        layers.push_str(&el(tag, &top, children));
        format!("<g>{layers}</g>")
    }
}

/// The length of the line an element draws, for dashes that reveal it.
/// A rect (without rounded corners) or a line as a hand would draw it on the board: each side slightly bowed, its
/// ends a little off, and the last side running past the first corner, all seeded by the element's key so it holds
/// still between frames. `scale` is screen px per drawing unit, so the wobble is the same size on any drawing.
fn rough_outline(n: &Elem, props: &Props, key: &str, scale: f64) -> Option<String> {
    let num = |k: &str| props.get(k).or_else(|| n.attr(k)).and_then(|v| v.trim().parse::<f64>().ok());
    let mut seed = key.bytes().fold(0x811c9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x01000193));
    let mut jitter = |amp: f64| {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((seed >> 8) as f64 / (1u32 << 24) as f64 * 2.0 - 1.0) * amp
    };
    let unit = 1.0 / scale.max(1e-6);
    let side = |a: (f64, f64), b: (f64, f64), j: &mut dyn FnMut(f64) -> f64| {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = (dx * dx + dy * dy).sqrt().max(1e-6);
        let bow = j(ROUGH_BOW_PX * unit) * (len * scale / 300.0).clamp(0.3, 1.0);
        let (nx, ny) = (-dy / len * bow, dx / len * bow);
        let mid = (a.0 + dx * 0.5 + nx, a.1 + dy * 0.5 + ny);
        format!(" Q {} {} {} {}", fnum(mid.0), fnum(mid.1), fnum(b.0), fnum(b.1))
    };
    match n.tag.as_str() {
        "rect" if n.attr("rx").is_none() && n.attr("ry").is_none() => {
            let (x, y, w, h) = (num("x").unwrap_or(0.0), num("y").unwrap_or(0.0), num("width")?, num("height")?);
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            let e = ROUGH_END_PX * unit;
            let mut c = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
            for p in &mut c {
                p.0 += jitter(e);
                p.1 += jitter(e);
            }
            let mut d = format!("M {} {}", fnum(c[0].0), fnum(c[0].1));
            for i in 0..4 {
                d.push_str(&side(c[i], c[(i + 1) % 4], &mut jitter));
            }
            // The pen runs on a little past the corner it started from, along the first side.
            d.push_str(&format!(" L {} {}", fnum(c[0].0 + ROUGH_OVERSHOOT_PX * unit), fnum(c[0].1)));
            // And goes round once more, lightly off the first line, as a sketch is drawn.
            let mut again = c;
            for p in &mut again {
                p.0 += jitter(e);
                p.1 += jitter(e);
            }
            d.push_str(&format!(" M {} {}", fnum(again[0].0), fnum(again[0].1)));
            for i in 0..4 {
                d.push_str(&side(again[i], again[(i + 1) % 4], &mut jitter));
            }
            Some(d)
        }
        "line" => {
            let e = ROUGH_END_PX * unit;
            let a = (num("x1").unwrap_or(0.0) + jitter(e), num("y1").unwrap_or(0.0) + jitter(e));
            let b = (num("x2").unwrap_or(0.0) + jitter(e), num("y2").unwrap_or(0.0) + jitter(e));
            let (a2, b2) = ((a.0 + jitter(e), a.1 + jitter(e)), (b.0 + jitter(e), b.1 + jitter(e)));
            Some(format!(
                "M {} {}{} M {} {}{}",
                fnum(a.0),
                fnum(a.1),
                side(a, b, &mut jitter),
                fnum(a2.0),
                fnum(a2.1),
                side(a2, b2, &mut jitter)
            ))
        }
        _ => None,
    }
}

fn shape_length(n: &Elem, d: Option<&str>) -> f64 {
    if n.tag == "path"
        && let Some(d) = d.or_else(|| n.attr("d"))
        && let Ok(p) = kurbo::BezPath::from_svg(d)
    {
        use kurbo::ParamCurveArclen;
        let l: f64 = p.segments().map(|s| s.arclen(0.05)).sum();
        if l > 0.0 {
            return l;
        }
    }
    trace_length(n, d).max(1.0)
}

impl Svg {
    fn paired(&self, from: &str, to: &str) -> Option<Arc<PairedShape>> {
        let mut m = self.pairs.lock().unwrap();
        if m.len() > 200 {
            m.clear();
        }
        m.entry((from.to_string(), to.to_string())).or_insert_with(|| pair_shapes(from, to).ok().map(Arc::new)).clone()
    }

    fn element(&self, id: &str) -> Option<&Elem> {
        self.drawing.find(id)
    }

    /// How far each element the current step traces has drawn (`traceProgress`).
    fn trace_progress(
        &self,
        s: &StateFrame,
        segments: &[Segment],
        k: Option<usize>,
        frame: f64,
        scale: f64,
    ) -> HashMap<String, f64> {
        let mut out = HashMap::new();
        let Some(k) = k else { return out };
        let Some(segment) = segments.get(k + 1) else { return out };
        let end = segments.get(k + 2).map_or(f64::INFINITY, |s| s.from);
        for (key, cue) in &s.now.traces {
            let cue_frame = cue.as_deref().and_then(|c| crate::timing::cue_frame(segment, c));
            let start = cue_frame.unwrap_or(segment.from + STEP_SETTLE_FRAMES);
            let node = self.element(&key[2..]);
            let d = s
                .now
                .shapes
                .get(key)
                .and_then(|t| self.element(t))
                .and_then(|e| e.attr("d"))
                .or_else(|| node.and_then(|n| n.attr("d")));
            let len = node.map_or(0.0, |n| trace_length(n, d));
            let frames = (len * scale / TRACE_SPEED).clamp(TRACE_MIN, TRACE_MAX).min((end - start).max(1.0));
            out.insert(key.clone(), ((frame - start) / frames).clamp(0.0, 1.0));
        }
        out
    }

    /// Elements the step shows, each with how far it has drawn on: its lines draw from their start and its fill
    /// comes in with them, as a pen would draw it, from the step's start or the words that name it. A text fades in
    /// over the same time. An element the step also traces keeps its trace.
    fn drawn_progress(
        &self,
        s: &StateFrame,
        segments: &[Segment],
        k: Option<usize>,
        frame: f64,
    ) -> HashMap<String, f64> {
        let mut out = HashMap::new();
        let Some(k) = k else { return out };
        let Some(segment) = segments.get(k + 1) else { return out };
        for key in &s.before.hidden {
            if s.now.hidden.contains(key) || s.now.traces.contains_key(key) {
                continue;
            }
            let named = self
                .names
                .get(key)
                .and_then(|names| names.iter().filter_map(|n| crate::timing::cue_frame(segment, n)).reduce(f64::min));
            let start = named.filter(|&c| c > segment.from).unwrap_or(segment.from);
            out.insert(key.clone(), ((frame - start) / DRAW_ON_FRAMES).clamp(0.0, 1.0));
        }
        out
    }

    /// Elements the step shows, hides or tints and its `say` names, each with how far its change has come: it
    /// starts as the voice reaches the words that name it, as someone drawing at a whiteboard adds a part as they
    /// say it, not all at once as the step starts.
    fn named_progress(
        &self,
        s: &StateFrame,
        segments: &[Segment],
        k: Option<usize>,
        frame: f64,
    ) -> HashMap<String, f64> {
        let mut out = HashMap::new();
        let Some(k) = k else { return out };
        let Some(segment) = segments.get(k + 1) else { return out };
        let settle = segment.from + STEP_SETTLE_FRAMES;
        let changed = |key: &String| {
            s.before.hidden.contains(key) != s.now.hidden.contains(key)
                || s.before.tints.get(key) != s.now.tints.get(key)
        };
        let keys =
            s.now.hidden.iter().chain(s.before.hidden.iter()).chain(s.now.tints.keys()).chain(s.before.tints.keys());
        for key in keys {
            if out.contains_key(key) || !changed(key) {
                continue;
            }
            let Some(names) = self.names.get(key) else { continue };
            let Some(cue) = names.iter().filter_map(|n| crate::timing::cue_frame(segment, n)).reduce(f64::min) else {
                continue;
            };
            if cue <= settle {
                continue;
            }
            out.insert(key.clone(), ((frame - cue) / NAMED_FRAMES).clamp(0.0, 1.0));
        }
        out
    }

    fn span_progress(
        &self,
        s: &StateFrame,
        segments: &[Segment],
        k: Option<usize>,
        frame: f64,
    ) -> HashMap<String, f64> {
        let mut out = HashMap::new();
        let Some(k) = k else { return out };
        let Some(segment) = segments.get(k + 1) else { return out };
        for (key, cue) in &s.now.spans {
            let start = cue.as_deref().and_then(|c| crate::timing::cue_frame(segment, c)).unwrap_or(segment.voice_from);
            let end = (start + STEP_SETTLE_FRAMES).max(segment.voice_from + segment.speaking_frames);
            out.insert(key.clone(), ((frame - start) / (end - start)).clamp(0.0, 1.0));
        }
        out
    }
}

impl SceneView for Svg {
    fn draw(&self, f: &Frame, dl: &mut crate::display::DisplayList) {
        let sf = StateFrame::at(&self.states, f.segments, f.frame);
        let focus = FocusSpotlight::borrowed(&self.targets, f.segments, f.frame);
        let k = current_step(f.segments, f.frame);
        // Under a camera the drawing is drawn again for what the view shows, at the screen's resolution, as Chrome
        // redraws vectors under a transform.
        let view = self.pen.view(f.frame, f.segments);
        let (svg, rect) = self.markup(&sf, &focus, f.frame, f.segments, k, view);
        let callout_draw = |dl: &mut crate::display::DisplayList, right: f32, top: f32| {
            if let Some(c) = &self.callout {
                c.draw(dl, right, top, &sf);
            }
        };
        let aside = self.callout.as_ref().map(|c| Aside { height: c.height, draw: &callout_draw });
        self.shell.draw(dl, f.frame, f.duration, aside, |dl, _bx| {
            let ink = self.shell.ink_alpha(f.frame, f.duration);
            self.pen.draw_faded(dl, view, f.frame, f.segments, &|_| None, ink, |dl| {
                let (px, py) = self.pixels(view);
                if let Some(p) = raster_svg(&svg, px, py) {
                    dl.image(Arc::new(p), hash64(&svg), rect.0 as f32, rect.1 as f32, rect.2 as f32, rect.3 as f32);
                }
            })
        });
    }
}

impl Svg {
    /// The pixel size the drawing is rasterized at: the content box and its bleed, as the screen shows them.
    fn pixels(&self, _view: Option<View>) -> (u32, u32) {
        let (w, h) = (self.box_w + 2.0 * BLEED, self.box_h + 2.0 * BLEED);
        (w.ceil() as u32, h.ceil() as u32)
    }

    /// The drawing at a state frame as SVG markup, and the content-box rect it covers: the content box and its bleed,
    /// or, under a view, the part of it the view shows.
    fn markup(
        &self,
        sf: &StateFrame,
        focus: &FocusSpotlight,
        frame: f64,
        segments: &[crate::timing::Segment],
        k: Option<usize>,
        view: Option<View>,
    ) -> (String, (f64, f64, f64, f64)) {
        let (scale, left, top) = stage(self.drawing.view_box, self.box_w, self.box_h);
        let traces = self.trace_progress(sf, segments, k, frame, scale);
        let spans = self.span_progress(sf, segments, k, frame);
        let named = self.named_progress(sf, segments, k, frame);
        let drawn = self.drawn_progress(sf, segments, k, frame);
        let d =
            Draw { s: sf, focus, frame, scale, traces, spans, named, drawn, defs: RefCell::new(Vec::new()), me: self };
        let root = &self.drawing.root;
        let base = Inherited {
            fill: root.attr("fill").is_some(),
            stroke: root.attr("stroke").is_some(),
            emphasis: focus.emphasis("#drawing"),
            tint: None,
            font: root.attr("font-family").unwrap_or("").to_string(),
            trace: None,
            flow: false,
            runs: false,
        };
        let parts = &root.children;
        let stagger = STAGGER.min((STAGGER_END - START) / (parts.len().saturating_sub(1)).max(1) as f64);
        let mut body = String::new();
        let board_gap = board_build_gap(parts.len());
        for (i, part) in parts.iter().enumerate() {
            if crate::look::board() && !self.shell.hold_in {
                // On the board the parts are drawn on one after another, as a hand would.
                let t = ((frame - START - i as f64 * board_gap) / DRAW_ON_FRAMES).clamp(0.0, 1.0);
                if t <= 0.0 {
                    continue;
                }
                let up = Inherited { trace: (t < 1.0).then_some(t), ..base.clone() };
                body.push_str(&d.draw(part, &i.to_string(), &up));
                continue;
            }
            let appear = if self.shell.hold_in {
                1.0
            } else {
                spring(frame - START - i as f64 * stagger, FPS, Spring::damping(18.0).with_stiffness(140.0)).min(1.0)
            };
            body.push_str(&format!("<g opacity=\"{}\">{}</g>", fnum(appear), d.draw(part, &i.to_string(), &base)));
        }
        let mut root_props = Props::default();
        for (name, value) in &root.attrs {
            if ["viewBox", "width", "height", "preserveAspectRatio", "version", "id", "class"].contains(&name.as_str())
                || name.starts_with("xmlns")
            {
                continue;
            }
            root_props.set(name, prefix_refs(name, &resolve_vars(value), &self.prefix));
        }
        root_props.set("transform", format!("translate({} {}) scale({})", fnum(left), fnum(top), fnum(scale)));
        let (w, h) = (self.box_w + 2.0 * BLEED, self.box_h + 2.0 * BLEED);
        let rect = match view {
            Some(v) if v.zoom != 1.0 => {
                let z = v.zoom;
                (v.x - self.box_w / (2.0 * z) - BLEED / z, v.y - self.box_h / (2.0 * z) - BLEED / z, w / z, h / z)
            }
            _ => (-BLEED, -BLEED, w, h),
        };
        let drawing = el("g", &root_props, &body);
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"{} {} {} {}\"><defs>{}</defs>{}</svg>",
            fnum(rect.0),
            fnum(rect.1),
            fnum(rect.2),
            fnum(rect.3),
            d.defs.borrow().join(""),
            drawing
        );
        let svg = if crate::look::board() { crate::look::swap_markup(&svg) } else { svg };
        (svg, rect)
    }

    /// The box of every element with an id where step k leaves the drawing, by item key ("s:<id>"), in the content
    /// box (`svgTargets`).
    fn targets_at(&self, k: usize, segments: &[crate::timing::Segment]) -> MarkTargets {
        let state = &self.states[k + 1];
        let sf = StateFrame {
            before: state,
            now: state,
            before_index: k + 1,
            now_index: k + 1,
            t: 1.0,
            lit: 0.0,
            step: Some(k),
        };
        // The scene's last frame: everything has landed, and any trace has drawn (springs simulate frame by frame).
        let end = segments.iter().map(|s| s.from + s.duration).fold(0.0, f64::max);
        let none = HashMap::new();
        let focus = FocusSpotlight::borrowed(&none, segments, end);
        let (svg, _) = self.markup(&sf, &focus, end, segments, Some(k), None);
        let mut ids = Vec::new();
        collect_ids(&self.drawing.root, &mut ids);
        let named: Vec<String> = ids.iter().map(|id| format!("{}{id}", self.prefix)).collect();
        let boxes = media::svg_boxes(&svg, &named)
            .into_iter()
            .map(|(id, (x, y, w, h))| (format!("s:{}", &id[self.prefix.len()..]), Bx::new(x - BLEED, y - BLEED, w, h)))
            .collect();
        MarkTargets::new(boxes, Bx::new(0.0, 0.0, self.box_w, self.box_h))
    }
}

/// The ids of a drawing's elements in document order, outside its definitions (as `svgGeometry` visits them).
fn collect_ids(e: &Elem, out: &mut Vec<String>) {
    if ["defs", "marker", "clipPath", "linearGradient", "radialGradient", "title", "desc"].contains(&e.tag.as_str()) {
        return;
    }
    if let Some(id) = e.attr("id") {
        out.push(id.to_string());
    }
    for c in e.elements() {
        collect_ids(c, out);
    }
}

/// A fill colour as `#rrggbb` and its alpha, from `#rgb`, `#rrggbb` or `#rrggbbaa`.
fn hex_alpha(c: &str) -> Option<(String, f64)> {
    let h = c.trim().strip_prefix('#')?;
    if !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match h.len() {
        3 => Some((format!("#{}", h.chars().flat_map(|c| [c, c]).collect::<String>()), 1.0)),
        6 => Some((format!("#{h}"), 1.0)),
        8 => Some((format!("#{}", &h[..6]), u8::from_str_radix(&h[6..], 16).ok()? as f64 / 255.0)),
        _ => None,
    }
}

/// On the board, the hatching's spacing and line width, in screen px.
const HATCH_GAP_PX: f64 = 16.0;
const HATCH_WIDTH_PX: f64 = 2.0;

/// On the board, how far a hand-drawn side bows at most, how far its ends stray, and how far the pen runs past the
/// corner it started from, in screen px.
const ROUGH_BOW_PX: f64 = 11.0;
const ROUGH_END_PX: f64 = 4.0;
const ROUGH_OVERSHOOT_PX: f64 = 12.0;

/// Frames an element a step's words name takes to show or change colour, from those words.
const NAMED_FRAMES: f64 = 9.0;
/// Frames an element a step shows takes to draw on.
const DRAW_ON_FRAMES: f64 = 20.0;
/// On the board, the frames a scene's drawing takes to draw on at most, part by part; the voice starts partway.
const BOARD_BUILD_FRAMES: f64 = 84.0;

/// On the board, frames between one part of a drawing starting to draw on and the next.
fn board_build_gap(parts: usize) -> f64 {
    (DRAW_ON_FRAMES * 0.8).min(BOARD_BUILD_FRAMES / parts.max(1) as f64)
}

/// The words each element with an id goes by: its `labels` entry, its own text, and its id with dashes and
/// underscores read as spaces.
fn element_names(scene: &Value, ids: &HashMap<&str, &Elem>) -> HashMap<String, Vec<String>> {
    let labels = scene.get("labels").and_then(Value::as_object);
    ids.iter()
        .map(|(id, e)| {
            let mut names = Vec::new();
            if let Some(l) = labels.and_then(|l| l.get(*id)).and_then(Value::as_str) {
                names.push(l.to_string());
            }
            if e.tag == "text" {
                let t = text_of(e);
                if !t.trim().is_empty() {
                    names.push(t);
                }
            }
            names.push(id.replace(['-', '_'], " "));
            (format!("s:{id}"), names)
        })
        .collect()
}

/// The indexes of the scenes that draw this scene's picture in a row, this one among them; just this one when it
/// draws no picture or draws it alone.
fn picture_run(input: &SceneInput) -> Vec<usize> {
    let scenes = &input.props.storyboard.scenes;
    let picture = |i: usize| -> Option<&str> {
        let s = scenes.get(i)?;
        (s.get("type").and_then(Value::as_str) == Some("svg")).then(|| s.get("picture").and_then(Value::as_str))?
    };
    let Some(mine) = picture(input.index) else { return vec![input.index] };
    let mut first = input.index;
    while first > 0 && picture(first - 1) == Some(mine) {
        first -= 1;
    }
    let mut last = input.index;
    while picture(last + 1) == Some(mine) {
        last += 1;
    }
    (first..=last).collect()
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let markup = scene.get("svg").and_then(Value::as_str).unwrap_or("");
    let drawing = read_svg(markup).ok_or("the drawing is not an <svg> with a viewBox")?;
    let mut shell = Shell::new(scene);
    let (box_w, mut box_h) = crate::chrome::callout::header_box(scene);
    // A picture that carries across scenes is held still between them, laid out in the same box in each.
    let run = picture_run(input);
    if run.len() > 1 {
        let scenes = &input.props.storyboard.scenes;
        shell.hold_in = run[0] < input.index;
        shell.hold_out = *run.last().unwrap() > input.index;
        for &i in &run {
            let s = &scenes[i];
            let aside = HeaderCallout::new(s).map_or(0.0, |c| c.height);
            shell.header_min = shell.header_min.max(Shell::new(s).header_height(aside));
            box_h = box_h.min(crate::chrome::callout::header_box(s).1);
        }
    }
    let list = |k: &str| scene.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let ids = drawing.id_map();
    // A scene that continues a picture starts with the moves, morphs and set text the scene before it ended on, which
    // shared/pictures.mjs puts in its `carried`.
    let carried = |field: &str| -> Vec<(String, String)> {
        let record = scene.get("carried").and_then(|c| c.get(field)).and_then(Value::as_object);
        record
            .into_iter()
            .flatten()
            .filter(|(id, _)| ids.contains_key(id.as_str()))
            .filter_map(|(id, v)| Some((format!("s:{id}"), v.as_str()?.to_string())))
            .collect()
    };
    let mut initial_values = Vec::new();
    for (id, e) in &ids {
        if e.tag == "text" {
            initial_values.push((format!("s:{id}"), Value::String(text_of(e))));
        }
    }
    initial_values.extend(carried("set").into_iter().map(|(k, v)| (k, Value::String(v))));
    let initial_hidden = list("hidden")
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| ids.contains_key(id))
        .map(|id| format!("s:{id}"))
        .collect();
    let resolve = |r: &Value| -> Vec<String> {
        r.as_str().filter(|id| ids.contains_key(id)).map(|id| vec![format!("s:{id}")]).unwrap_or_default()
    };
    let check_value = |key: &str, v: &Value| {
        ids.get(&key[2..]).is_some_and(|e| e.tag == "text") && (v.is_string() || v.as_f64().is_some_and(f64::is_finite))
    };
    let trace_key = |r: &Value| -> Option<String> {
        let id = r.as_str()?;
        let e = ids.get(id)?;
        TRACEABLE.contains(&e.tag.as_str()).then(|| format!("s:{id}"))
    };
    let root_is = |name: &str| drawing.root.attr("id") == Some(name);
    let move_key = |name: &str| ids.contains_key(name).then(|| format!("s:{name}")).filter(|_| !root_is(name));
    let morph = |next: &SceneState, id: &str, target: &str| -> bool {
        let (Some(a), Some(b)) = (ids.get(id), ids.get(target)) else { return false };
        if a.tag != "path" || b.tag != "path" {
            return false;
        }
        let from =
            next.shapes.get(&format!("s:{id}")).and_then(|t| ids.get(t.as_str())).unwrap_or(a).attr("d").unwrap_or("");
        pair_shapes(from, b.attr("d").unwrap_or("")).is_ok()
    };
    let model = ClosureModel {
        initial_values,
        initial_hidden,
        resolve: &resolve,
        set_prefixes: &["s:"],
        show_prefixes: &["s:"],
        tint_prefixes: &["s:"],
        check_value: &check_value,
        trace_key: &trace_key,
        move_key: Some(&move_key),
        morph: Some(&morph),
        initial_transforms: carried("move").into_iter().collect(),
        initial_shapes: carried("morph").into_iter().collect(),
    };
    let states = walk_states(&model, scene);
    let targets = crate::targets::target_steps_with(scene, |r| Some(resolve(r)).filter(|k| !k.is_empty()));
    let names = element_names(scene, &ids);
    let mut me = Svg {
        prefix: hash_of(markup),
        callout: HeaderCallout::new(scene),
        drawing,
        states,
        targets,
        shell,
        box_w,
        box_h,
        pairs: Mutex::new(HashMap::new()),
        pen: Pen::new(scene, input.segments, &NoRefs, Vec::new(), true, (box_w, box_h)),
        names,
    };
    let marks: Vec<MarkTargets> =
        (0..crate::timing::scene_steps(scene).len()).map(|k| me.targets_at(k, input.segments)).collect();
    me.pen = Pen::new(scene, input.segments, &SvgRefs(&me.drawing), marks, false, header_box(scene));
    Ok(Box::new(me))
}

/// A ref to an element by its id.
struct SvgRefs<'a>(&'a Drawing);

impl Refs for SvgRefs<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        r.as_str().filter(|id| self.0.has(id)).map(|id| vec![format!("s:{id}")])
    }
}

#[cfg(test)]
mod font_tests {
    use super::*;

    /// Every character of svg text is drawn: in the face where it has the glyph, and only the rest in a fallback.
    #[test]
    fn text_falls_back_per_character() {
        for face in [Face::Hand, Face::Mono, Face::Sans] {
            let text = "a → b ∞ π xᵏ H₂O ⋮ 2²⁵⁶";
            let svg = format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 100"><text x="10" y="60" font-size="40" font-family="{}">{}</text></svg>"#,
                media::svg_family(face as u8),
                text_runs(text, face)
            );
            let glyphs = media::svg_glyph_fonts(&svg);
            assert_eq!(glyphs.iter().map(|g| g.0.as_str()).collect::<String>().replace(' ', ""), text.replace(' ', ""));
            for (c, font) in glyphs {
                let font = font.unwrap_or_else(|| panic!("{face:?} draws no glyph for {c}"));
                if c.chars().all(|c| c.is_ascii_alphanumeric()) {
                    assert_eq!(font, face as u8, "{face:?} draws {c} in font {font}");
                }
            }
        }
        // Caveat has ² but not ⁵ or ⁶: the figures of 2²⁵⁶ come from one font, so they line up.
        let fonts: Vec<u8> = crate::text::font_runs(Face::Hand, "2²⁵⁶").iter().map(|r| r.0).collect();
        assert_eq!(fonts, [Face::Hand as u8, 3]);
    }
}
