//! The svg scene's drawing: SVG markup parsed and cut down to drawing elements, a port of readSvg in shared/svg.mjs
//! (without the problem reports `validate` makes).

use fancy_regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Debug)]
pub enum Node {
    Elem(Elem),
    Text(String),
}

#[derive(Clone, Debug)]
pub struct Elem {
    pub tag: String,
    /// In the order the markup writes them.
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

impl Elem {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    pub fn elements(&self) -> impl Iterator<Item = &Elem> {
        self.children.iter().filter_map(|c| match c {
            Node::Elem(e) => Some(e),
            Node::Text(_) => None,
        })
    }
}

const ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "path",
    "text",
    "tspan",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "use",
];

const ATTRIBUTES: &[&str] = &[
    "id",
    "class",
    "transform",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "opacity",
    "clip-path",
    "clip-rule",
    "marker-start",
    "marker-mid",
    "marker-end",
    "font-size",
    "font-weight",
    "font-family",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "alignment-baseline",
    "letter-spacing",
    "vector-effect",
    "paint-order",
    "display",
    "visibility",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "fx",
    "fy",
    "width",
    "height",
    "points",
    "d",
    "dx",
    "dy",
    "rotate",
    "pathLength",
    "textLength",
    "lengthAdjust",
    "viewBox",
    "preserveAspectRatio",
    "xmlns",
    "xmlns:xlink",
    "version",
    "refX",
    "refY",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "orient",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "clipPathUnits",
    "href",
    "xlink:href",
];

/// The colours `var(--name)` names, the player's palette (shared/svg.mjs SVG_COLORS).
pub const SVG_COLORS: &[(&str, &str)] = &[
    ("text", "#f2f4f8"),
    ("muted", "#9097a8"),
    ("faint", "#5b6172"),
    ("bg", "#07080c"),
    ("surface", "#1a1d28"),
    ("border", "rgba(255, 255, 255, 0.16)"),
    ("accent", "#7c8cff"),
    ("good", "#3ddc97"),
    ("bad", "#ff6b7a"),
    ("warn", "#fbbf24"),
    ("neutral", "#8f98ad"),
];
pub const SVG_TONES: &[&str] = &["accent", "good", "bad", "warn", "neutral"];

fn decode(s: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)&(#x[0-9a-f]+|#\d+|\w+);").unwrap());
    let mut out = String::new();
    let mut last = 0;
    for m in re.captures_iter(s).flatten() {
        let all = m.get(0).unwrap();
        out.push_str(&s[last..all.start()]);
        last = all.end();
        let e = m.get(1).unwrap().as_str();
        let rep = if let Some(h) = e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")) {
            u32::from_str_radix(h, 16).ok().and_then(char::from_u32).map(String::from)
        } else if let Some(d) = e.strip_prefix('#') {
            d.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
        } else {
            match e {
                "amp" => Some("&".into()),
                "lt" => Some("<".into()),
                "gt" => Some(">".into()),
                "quot" => Some("\"".into()),
                "apos" => Some("'".into()),
                "nbsp" => Some(" ".into()),
                _ => None,
            }
        };
        out.push_str(&rep.unwrap_or_else(|| all.as_str().to_string()));
    }
    out.push_str(&s[last..]);
    out
}

struct Raw {
    tag: String,
    attrs: Vec<(String, String)>,
    children: Vec<RawNode>,
}
enum RawNode {
    Elem(Raw),
    Text(String),
}

fn parse(markup: &str) -> Result<Raw, String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r#"<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)"#,
        )
        .unwrap()
    });
    let attr_re = ATTR.get_or_init(|| Regex::new(r#"([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
    // A stack of open elements; each finished one is pushed into its parent.
    let mut stack: Vec<Raw> = vec![Raw { tag: "#root".into(), attrs: vec![], children: vec![] }];
    for m in re.captures_iter(markup) {
        let m = m.map_err(|e| e.to_string())?;
        let all = m.get(0).unwrap().as_str();
        if m.get(6).is_some() {
            return Err("a tag does not parse".into());
        }
        if let Some(text) = m.get(5) {
            let top = stack.last_mut().unwrap();
            if !text.as_str().trim().is_empty() || top.tag == "text" || top.tag == "tspan" {
                top.children.push(RawNode::Text(decode(text.as_str())));
            }
            continue;
        }
        if let Some(close) = m.get(1) {
            let top = stack.last().unwrap();
            if top.tag != close.as_str() {
                return Err(format!("</{}> closes the wrong tag", close.as_str()));
            }
            let done = stack.pop().unwrap();
            stack.last_mut().unwrap().children.push(RawNode::Elem(done));
            continue;
        }
        let Some(open) = m.get(2) else {
            let _ = all;
            continue;
        };
        let mut node = Raw { tag: open.as_str().to_string(), attrs: vec![], children: vec![] };
        if let Some(attrs) = m.get(3) {
            for a in attr_re.captures_iter(attrs.as_str()).flatten() {
                let name = a.get(1).unwrap().as_str().to_string();
                let value = decode(a.get(2).or_else(|| a.get(3)).map_or("", |v| v.as_str()));
                if let Some(slot) = node.attrs.iter_mut().find(|(k, _)| *k == name) {
                    slot.1 = value;
                } else {
                    node.attrs.push((name, value));
                }
            }
        }
        if m.get(4).is_some_and(|s| s.as_str() == "/") {
            stack.last_mut().unwrap().children.push(RawNode::Elem(node));
        } else {
            stack.push(node);
        }
    }
    if stack.len() > 1 {
        return Err("a tag is never closed".into());
    }
    Ok(stack.pop().unwrap())
}

fn is_tone_class(c: &str) -> bool {
    c == "flow"
        || ["tone-", "fill-", "stroke-"].iter().any(|p| c.strip_prefix(p).is_some_and(|t| SVG_TONES.contains(&t)))
}

fn colour_ok(v: &str) -> bool {
    let v = v.trim();
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r"(?i)^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|(?:rgba?|hsla?)\(\s*[-+\d.%\s,/]*\)|var\(\s*--[\w-]+\s*\))$",
        )
        .unwrap()
    });
    re.is_match(v).unwrap_or(false)
}

fn local_ref(v: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?i)^url\(\s*(['"]?)#([\w.:-]+)\1\s*\)$"#).unwrap());
    re.captures(v.trim()).ok().flatten().map(|c| c.get(2).unwrap().as_str().to_string())
}

/// A kept attribute's value, or None when it is cut (`attribute`).
fn attribute(name: &str, value: &str) -> Option<String> {
    if value.contains('\\') {
        return None;
    }
    let lower = value.to_lowercase();
    if lower.contains("javascript:") || lower.contains("@import") || lower.contains("expression") && lower.contains('(')
    {
        return None;
    }
    let paint = name == "fill" || name == "stroke";
    let reference = ["clip-path", "marker-start", "marker-mid", "marker-end"].contains(&name);
    if let Some(id) = local_ref(value)
        && (paint || reference)
    {
        return Some(format!("url(#{id})"));
    }
    if paint || name == "stop-color" {
        return colour_ok(value).then(|| value.to_string());
    }
    if reference {
        return (value.trim() == "none").then(|| value.to_string());
    }
    if lower.contains("url") && lower.contains('(') {
        return None;
    }
    Some(value.to_string())
}

/// A parsed drawing: its root `<svg>`, its viewBox, and where each id's element sits.
pub struct Drawing {
    pub root: Elem,
    pub view_box: [f64; 4],
    /// Element ids in document order, with a path to the element (child indexes from the root).
    pub ids: Vec<(String, Vec<usize>)>,
}

impl Drawing {
    pub fn find(&self, id: &str) -> Option<&Elem> {
        let path = &self.ids.iter().find(|(k, _)| k == id)?.1;
        let mut e = &self.root;
        for &i in path {
            e = e.elements().nth(i)?;
        }
        Some(e)
    }
    pub fn has(&self, id: &str) -> bool {
        self.ids.iter().any(|(k, _)| k == id)
    }
    pub fn id_map(&self) -> HashMap<&str, &Elem> {
        self.ids.iter().filter_map(|(k, _)| self.find(k).map(|e| (k.as_str(), e))).collect()
    }
}

fn keep(node: &Raw, top: bool, path: &mut Vec<usize>, ids: &mut Vec<(String, Vec<usize>)>) -> Option<Elem> {
    if !ELEMENTS.contains(&node.tag.as_str()) || (node.tag == "svg" && !top) {
        return None;
    }
    let mut attrs: Vec<(String, String)> = Vec::new();
    for (name, value) in &node.attrs {
        let lname = name.to_lowercase();
        if lname.starts_with("on") || name == "style" || !ATTRIBUTES.contains(&name.as_str()) {
            continue;
        }
        if top && ["transform", "x", "y"].contains(&name.as_str()) {
            continue;
        }
        let kept = if name == "class" {
            let kept: Vec<&str> = value.split_whitespace().filter(|c| is_tone_class(c)).collect();
            if kept.is_empty() {
                continue;
            }
            kept.join(" ")
        } else if name == "href" || name == "xlink:href" {
            let ok = value.len() > 1
                && value.starts_with('#')
                && value[1..].chars().all(|c| c.is_alphanumeric() || "_.:-".contains(c));
            if !ok {
                continue;
            }
            attrs.retain(|(k, _)| k != "href");
            attrs.push(("href".into(), value.clone()));
            continue;
        } else {
            match attribute(name, value) {
                Some(v) => v,
                None => continue,
            }
        };
        attrs.push((name.clone(), kept));
    }
    let id = attrs.iter().find(|(k, _)| k == "id").map(|(_, v)| v.clone());
    if let Some(i) = id.as_ref().filter(|i| !ids.iter().any(|(k, _)| k == *i)) {
        ids.push((i.clone(), path.clone()));
    }
    let mut children = Vec::new();
    let mut count = 0;
    for child in &node.children {
        match child {
            RawNode::Text(t) => {
                if ["text", "tspan", "title", "desc"].contains(&node.tag.as_str()) {
                    children.push(Node::Text(t.clone()));
                }
            }
            RawNode::Elem(r) => {
                path.push(count);
                if let Some(e) = keep(r, false, path, ids) {
                    children.push(Node::Elem(e));
                    count += 1;
                }
                path.pop();
            }
        }
    }
    Some(Elem { tag: node.tag.clone(), attrs, children })
}

/// Parses and cuts a drawing (`readSvg`); None for markup that does not parse, has no viewBox or no root `<svg>`.
pub fn read_svg(markup: &str) -> Option<Drawing> {
    if markup.trim().is_empty() {
        return None;
    }
    let parsed = parse(markup).ok()?;
    let tops: Vec<&RawNode> = parsed.children.iter().collect();
    let root = tops.iter().find_map(|n| if let RawNode::Elem(e) = n { Some(e) } else { None })?;
    if root.tag != "svg" || tops.len() != 1 {
        return None;
    }
    let vb = root.attrs.iter().find(|(k, _)| k == "viewBox").map_or("", |(_, v)| v.as_str()).trim().to_string();
    let nums: Vec<f64> = vb
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(f64::NAN))
        .collect();
    if nums.len() != 4 || !nums.iter().all(|n| n.is_finite()) || nums[2] <= 0.0 || nums[3] <= 0.0 {
        return None;
    }
    let mut ids = Vec::new();
    let elem = keep(root, true, &mut Vec::new(), &mut ids)?;
    Some(Drawing { root: elem, view_box: [nums[0], nums[1], nums[2], nums[3]], ids })
}

/// The text an element holds, its own and its tspans', as one line (`textOf`).
pub fn text_of(node: &Elem) -> String {
    fn raw(e: &Elem, out: &mut String) {
        for c in &e.children {
            match c {
                Node::Text(t) => out.push_str(t),
                Node::Elem(e) => raw(e, out),
            }
        }
    }
    let mut s = String::new();
    raw(node, &mut s);
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where a viewBox lands in a box: scaled to fit whole and centred (`svgStage`).
pub fn stage(view_box: [f64; 4], w: f64, h: f64) -> (f64, f64, f64) {
    let [vx, vy, vw, vh] = view_box;
    let scale = (w / vw).min(h / vh);
    (scale, (w - vw * scale) / 2.0 - vx * scale, (h - vh * scale) / 2.0 - vy * scale)
}
