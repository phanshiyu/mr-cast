//! The svg scene: a drawing in SVG markup that steps light, colour, show, hide, move, morph and trace by element
//! id. A port of src/components/SvgDiagram.tsx with shared/svg.mjs, shared/svg-motion.mjs and
//! shared/state-steps.mjs. Each frame writes the drawing as the component would render it and rasterizes it with
//! resvg.

#![allow(clippy::type_complexity)]

pub mod motion;
pub mod tree;

use super::media::{Callout, Focus, drop_shadow_filter, hash64, header_box, raster_svg, target_steps, xml_escape};
use super::{Frame, SceneInput, SceneView};
use crate::anim::{Spring, spring};
use crate::chrome::shell::{Aside, Shell};
use crate::state_steps::{SceneState, StateFrame, StateModel, TintMix, state_frame, walk_states};
use crate::steps::{Emphasis, current_step};
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
    AREAS.contains(&tag) || LINES.contains(&tag) || tag == "text" || tag == "use"
}

fn tone_color(tone: &str) -> &'static str {
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
}

struct TintMixed(TintMix);

fn brighter(a: Emphasis, b: Emphasis) -> Emphasis {
    Emphasis { opacity: a.opacity.max(b.opacity), bar: a.bar.max(b.bar), glow: a.glow.max(b.glow) }
}

struct Svg {
    drawing: Drawing,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    prefix: String,
    shell: Shell,
    callout: Option<Callout>,
    box_w: f64,
    box_h: f64,
    pairs: Mutex<HashMap<(String, String), Option<Arc<PairedShape>>>>,
}

struct Draw<'a> {
    s: &'a StateFrame<'a>,
    focus: &'a Focus<'a>,
    initial: &'a HashMap<String, Value>,
    frame: f64,
    scale: f64,
    traces: HashMap<String, f64>,
    spans: HashMap<String, f64>,
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

    fn moved(&self, key: &str) -> f64 {
        self.spans.get(key).copied().unwrap_or(self.s.t)
    }

    fn def_filter(&self, shadows: &[(f64, &str, f64)]) -> String {
        let id = format!("{}glow{}", self.me.prefix, self.defs.borrow().len());
        self.defs.borrow_mut().push(drop_shadow_filter(&id, shadows));
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
            Some(o) => brighter(up.emphasis, self.focus.of(o)),
            None => up.emphasis,
        };
        let own_tint = own.as_ref().map(|o| self.s.tint_mix(o));
        let tint: Option<Arc<TintMixed>> = match own_tint {
            Some(t) if !t.tones.is_empty() || t.dim > 0.0 => Some(Arc::new(TintMixed(t))),
            _ => up.tint.clone(),
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
        if let Some(tone) = &cls.tone {
            if tag == "text" {
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
        if tag == "text" {
            if !has_fill {
                props.set("fill", palette("text"));
            }
            let font = a("font-family").unwrap_or(&up.font);
            props.set(
                "font-family",
                if font.to_lowercase().contains("mono") { "JetBrains Mono" } else { "Inter Variable" },
            );
        } else if AREAS.contains(&tag) {
            if !has_fill {
                props.set("fill", palette("surface"));
            }
            if !has_stroke {
                props.set("stroke", palette("border"));
            }
        } else if LINES.contains(&tag) {
            if !has_fill {
                props.set("fill", "none");
            }
            if !has_stroke {
                props.set("stroke", palette("muted"));
            }
        }
        let value = if tag == "text" { own.as_ref().and_then(|o| self.s.now.values.get(o)) } else { None };
        let changed = tag == "text" && own.as_ref().is_some_and(|o| self.s.before.values.get(o) != value);
        if is_leaf(tag)
            && let Some(t) = &tint
            && let Some(tone) = t.0.main_tone()
        {
            if tag == "text" {
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
        let shown = own.as_ref().map_or(1.0, |o| self.s.shown(o));
        let leaf_opacity =
            if is_leaf(tag) { emphasis.opacity * tint.as_ref().map_or(1.0, |t| t.0.dim_opacity()) } else { 1.0 };
        let base_opacity: f64 = a("opacity").and_then(|v| v.trim().parse().ok()).unwrap_or(1.0);
        let opacity = base_opacity * shown * leaf_opacity * if changed { 0.35 + 0.65 * self.s.t } else { 1.0 };
        if opacity != 1.0 {
            props.set("opacity", fnum(opacity));
        }
        if let Some(o) = &own {
            let g = self.focus.of(o).glow;
            if g > 0.0 {
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
        let trace = own.as_ref().and_then(|o| self.traces.get(o).copied()).or(up.trace);
        let flow = up.flow || a("class").is_some_and(|c| c.split_whitespace().any(|c| c == "flow"));
        let next = Inherited {
            fill: has_fill,
            stroke: has_stroke,
            emphasis,
            tint,
            font: a("font-family").map_or_else(|| up.font.clone(), String::from),
            trace,
            flow,
        };
        let rewritten = own.as_ref().is_some_and(|o| value.is_some_and(|v| self.me.states[0].values.get(o) != Some(v)))
            && value.is_some();
        let _ = self.initial;
        let children = if rewritten {
            xml_escape(&value_text(value.unwrap()))
        } else {
            n.children.iter().enumerate().map(|(i, c)| self.draw(c, &format!("{key}.{i}"), &next)).collect::<String>()
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

    fn motion_shape(
        &self,
        n: &Elem,
        key: &str,
        mut props: Props,
        children: &str,
        trace: Option<f64>,
        flow: bool,
    ) -> String {
        let tag = n.tag.as_str();
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
            let fo: f64 = n.attr("fill-opacity").and_then(|v| v.parse().ok()).unwrap_or(1.0);
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
        let sf = state_frame(&self.states, f.segments, f.frame);
        let focus = Focus::new(f.frame, f.segments, &self.targets);
        let (scale, left, top) = stage(self.drawing.view_box, self.box_w, self.box_h);
        let k = current_step(f.segments, f.frame);
        let traces = self.trace_progress(&sf, f.segments, k, f.frame, scale);
        let spans = self.span_progress(&sf, f.segments, k, f.frame);
        let d = Draw {
            s: &sf,
            focus: &focus,
            initial: &self.states[0].values,
            frame: f.frame,
            scale,
            traces,
            spans,
            defs: RefCell::new(Vec::new()),
            me: self,
        };
        let root = &self.drawing.root;
        let base = Inherited {
            fill: root.attr("fill").is_some(),
            stroke: root.attr("stroke").is_some(),
            emphasis: focus.of("#drawing"),
            tint: None,
            font: root.attr("font-family").unwrap_or("").to_string(),
            trace: None,
            flow: false,
        };
        let parts = &root.children;
        let stagger = STAGGER.min((STAGGER_END - START) / (parts.len().saturating_sub(1)).max(1) as f64);
        let mut body = String::new();
        for (i, part) in parts.iter().enumerate() {
            let appear =
                spring(f.frame - START - i as f64 * stagger, FPS, Spring::damping(18.0).with_stiffness(140.0)).min(1.0);
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
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"{} {} {w} {h}\"><defs>{}</defs>{}</svg>",
            -BLEED,
            -BLEED,
            d.defs.borrow().join(""),
            el("g", &root_props, &body)
        );
        let callout_draw = |dl: &mut crate::display::DisplayList, right: f32, top: f32| {
            if let Some(c) = &self.callout {
                c.draw(dl, right, top, &sf.before.callout, &sf.now.callout, sf.t, sf.lit);
            }
        };
        let aside = self.callout.as_ref().map(|c| Aside { height: c.height(), draw: &callout_draw });
        self.shell.draw(dl, f.frame, f.duration, aside, |dl, _bx| {
            if let Some(p) = raster_svg(&svg, w.ceil() as u32, h.ceil() as u32) {
                dl.image(Arc::new(p), hash64(&svg), -BLEED as f32, -BLEED as f32, w.ceil() as f32, h.ceil() as f32);
            }
            // TODO(marks): PenMarks on the lit elements.
            // TODO(camera): the scene's `camera` field.
        });
    }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let markup = scene.get("svg").and_then(Value::as_str).unwrap_or("");
    let drawing = read_svg(markup).ok_or("the drawing is not an <svg> with a viewBox")?;
    let shell = Shell::new(scene);
    let (box_w, box_h) = header_box(scene, &shell);
    let list = |k: &str| scene.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let ids = drawing.id_map();
    let mut initial_values = HashMap::new();
    for (id, e) in &ids {
        if e.tag == "text" {
            initial_values.insert(format!("s:{id}"), Value::String(text_of(e)));
        }
    }
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
    let model = StateModel {
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
    };
    let states = walk_states(scene, &model);
    let targets = target_steps(scene, resolve);
    Ok(Box::new(Svg {
        prefix: hash_of(markup),
        callout: Callout::new(scene),
        drawing,
        states,
        targets,
        shell,
        box_w,
        box_h,
        pairs: Mutex::new(HashMap::new()),
    }))
}
