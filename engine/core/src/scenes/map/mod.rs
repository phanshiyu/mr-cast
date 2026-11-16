//! The map scene: the world from Natural Earth's outline, with places, routes, lines and regions that steps show,
//! light, tint, trace and frame. A port of src/components/MapDiagram.tsx and shared/map.mjs, drawing with the d3-geo
//! pieces in `geo` and rasterizing each frame's SVG with resvg.

mod geo;

use super::media::{drop_shadow_filter, hash64, raster_svg, xml_escape};
use super::svg::tone_color;
use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Easing, Spring, interpolate, spring};
use crate::chrome::callout::HeaderCallout;
use crate::chrome::shell::{Aside, Shell};
use crate::display::DisplayList;
use crate::marks::geometry::Bx;
use crate::marks::{MarkTargets, NoRefs, Pen, Refs};
use crate::markup::plain_text;
use crate::states::{ClosureModel, SceneState, StateFrame, walk_states};
use crate::steps::FocusSpotlight;
use crate::steps::{Emphasis, current_step};
use crate::textfit::{Family, Font, measure};
use crate::timing::{FPS, STEP_SETTLE_FRAMES, cue_frame};
use geo::{Geom, Kind, P, Projection};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

const START: f64 = 6.0;
const OCEAN: &str = "#0b0e15";
const LAND: &str = "#1d2230";
const BORDER: &str = "#3a4254";
const BG: &str = "#07080c";
const ACCENT: &str = "#7c8cff";
const TEXT: &str = "#f2f4f8";
const TRACE_MIN: f64 = 20.0;
const MIN_SPAN: f64 = 0.5;
const POINT_SPAN: f64 = 8.0;
const FINE_ZOOM: f64 = 4.0;
const PAD: f64 = 0.08;
const ROUTE_STEP: f64 = 1.0;
const LINE_STEP: f64 = 0.5;
const EDGE_STEP: f64 = 1.0;
const LABEL_SIZE: f64 = 26.0;
const LABEL_WEIGHT: f64 = 600.0;
const DOT_RADIUS: f64 = 9.0;
const LABEL_GAP: f64 = 10.0;
const SIDES: &[&str] = &["right", "left", "above", "below"];

// ─── The world ───

struct Country {
    code: String,
    names: Vec<String>,
    label: P,
    polygons: Vec<Vec<Vec<P>>>,
}

type Countries = Vec<Country>;

fn decode(json: &str) -> Countries {
    let v: Value = serde_json::from_str(json).expect("world data");
    let q = v["quantum"].as_f64().unwrap_or(100.0);
    let ring = |r: &Value| -> Vec<P> {
        let nums: Vec<f64> = r.as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
        let mut out = Vec::new();
        let (mut x, mut y) = (0.0, 0.0);
        let mut i = 0;
        while i + 1 < nums.len() {
            let (px, py) = (x, y);
            x += nums[i];
            y += nums[i + 1];
            let n = if i > 0 { ((x - px).abs().max((y - py).abs()) / q / EDGE_STEP).ceil() as usize } else { 1 };
            for j in 1..n {
                out.push(((px + (x - px) * j as f64 / n as f64) / q, (py + (y - py) * j as f64 / n as f64) / q));
            }
            out.push((x / q, y / q));
            i += 2;
        }
        out
    };
    v["countries"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| Country {
                    code: c[0].as_str().unwrap_or("").to_string(),
                    names: c[1]
                        .as_array()
                        .map(|n| n.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                        .unwrap_or_default(),
                    label: (c[2][0].as_f64().unwrap_or(0.0), c[2][1].as_f64().unwrap_or(0.0)),
                    polygons: c[3]
                        .as_array()
                        .map(|ps| {
                            ps.iter()
                                .map(|p| p.as_array().map(|rs| rs.iter().map(&ring).collect()).unwrap_or_default())
                                .collect()
                        })
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn countries_at(detail: &str) -> &'static Countries {
    static COARSE: OnceLock<Countries> = OnceLock::new();
    static FINE: OnceLock<Countries> = OnceLock::new();
    if detail == "110m" {
        COARSE.get_or_init(|| decode(include_str!("../../../data/world-110m.json")))
    } else {
        FINE.get_or_init(|| decode(include_str!("../../../data/world-50m.json")))
    }
}

fn country_code(r: &Value) -> Option<String> {
    let s = r.as_str()?;
    let all = countries_at("50m");
    if all.iter().any(|c| c.code == s) {
        return Some(s.to_string());
    }
    let want = s.trim().to_lowercase();
    all.iter().find(|c| c.names.iter().any(|n| n.to_lowercase() == want)).map(|c| c.code.clone())
}

fn country<'a>(detail: &str, code: &str) -> Option<&'a Country> {
    countries_at(detail).iter().find(|c| c.code == code)
}

// ─── Items ───

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind4 {
    Place,
    Route,
    Line,
    Region,
}

#[derive(Clone)]
struct Item {
    kind: Kind4,
    point: P,
    /// A route's or line's points in drawing order.
    path: Vec<P>,
    /// A region's polygons: from its outline, or its countries' names.
    polygons: Vec<Vec<Vec<P>>>,
    countries: Option<Vec<String>>,
    center: P,
    label: String,
    dot: bool,
    side: Option<String>,
    tone: Option<String>,
}

fn is_latlng(v: &Value) -> Option<P> {
    let a = v.as_array()?;
    if a.len() != 2 {
        return None;
    }
    let (la, ln) = (a[0].as_f64()?, a[1].as_f64()?);
    (la.abs() <= 90.0 && ln.abs() <= 180.0).then_some((ln, la))
}

fn great_circle(a: P, b: P, step: f64) -> Vec<P> {
    let n = ((geo::distance(a, b) * 180.0 / std::f64::consts::PI / step).ceil() as usize).max(1);
    (0..=n).map(|i| geo::interpolate_at(a, b, i as f64 / n as f64)).collect()
}

fn lists(scene: &Value, k: &str) -> Vec<Value> {
    scene.get(k).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

/// A polygon ring wound as d3-geo reads an area smaller than half the globe (clockwise from outside).
fn polygon_of(points: Vec<P>) -> Vec<Vec<P>> {
    let mut ring = points.clone();
    ring.push(points[0]);
    let mut area = 0.0;
    let base = ring[0].0;
    let wrap = |l: f64| ((l - base + 540.0) % 360.0) - 180.0;
    for w in ring.windows(2) {
        let (a, b) = ((wrap(w[0].0), w[0].1), (wrap(w[1].0), w[1].1));
        area += a.0 * b.1 - b.0 * a.1;
    }
    if area > 0.0 {
        ring.reverse();
    }
    vec![ring]
}

/// The spherical centroid of polygons, by a fan of triangles.
fn centroid(polygons: &[Vec<Vec<P>>]) -> P {
    let cart = |p: P| {
        let (l, f) = (p.0.to_radians(), p.1.to_radians());
        [f.cos() * l.cos(), f.cos() * l.sin(), f.sin()]
    };
    let mut sum = [0.0f64; 3];
    let mut mean = [0.0f64; 3];
    for poly in polygons {
        for (ri, ring) in poly.iter().enumerate() {
            if ring.len() < 3 {
                continue;
            }
            let v: Vec<[f64; 3]> = ring.iter().map(|p| cart(*p)).collect();
            let hole = if ri > 0 { -1.0 } else { 1.0 };
            let mut ring_sum = [0.0f64; 3];
            for i in 1..v.len() - 1 {
                let (a, b, c) = (v[0], v[i], v[i + 1]);
                let w = a[0] * (b[1] * c[2] - b[2] * c[1])
                    + a[1] * (b[2] * c[0] - b[0] * c[2])
                    + a[2] * (b[0] * c[1] - b[1] * c[0]);
                for k in 0..3 {
                    ring_sum[k] += w * (a[k] + b[k] + c[k]);
                }
            }
            let dot: f64 = (0..3).map(|k| ring_sum[k] * v[0][k]).sum();
            let sign = if dot < 0.0 { -1.0 } else { 1.0 };
            for k in 0..3 {
                sum[k] += hole * sign * ring_sum[k];
                mean[k] += v[0][k];
            }
        }
    }
    let m = (sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2]).sqrt().max(1e-12);
    let _ = mean;
    ((sum[1] / m).atan2(sum[0] / m).to_degrees(), (sum[2] / m).asin().to_degrees())
}

fn map_items(scene: &Value) -> Vec<(String, Item)> {
    let mut items: Vec<(String, Item)> = Vec::new();
    let mut places: HashMap<String, P> = HashMap::new();
    let blank = || Item {
        kind: Kind4::Place,
        point: (0.0, 0.0),
        path: vec![],
        polygons: vec![],
        countries: None,
        center: (0.0, 0.0),
        label: String::new(),
        dot: false,
        side: None,
        tone: None,
    };
    for p in lists(scene, "places") {
        let at = p.get("at").cloned().unwrap_or(Value::Null);
        let point = is_latlng(&at).or_else(|| country_code(&at).and_then(|c| country("50m", &c).map(|c| c.label)));
        let (Some(point), Some(id)) = (point, s(&p, "id")) else { continue };
        places.insert(id.to_string(), point);
        let dot = p.get("dot").and_then(Value::as_bool).unwrap_or_else(|| is_latlng(&at).is_some());
        let side =
            s(&p, "side").filter(|x| SIDES.contains(x)).map(String::from).or_else(|| dot.then(|| "right".to_string()));
        items.push((
            format!("mp:{id}"),
            Item {
                kind: Kind4::Place,
                point,
                label: s(&p, "label").unwrap_or("").into(),
                dot,
                side,
                tone: s(&p, "tone").map(String::from),
                ..blank()
            },
        ));
    }
    let stop = |v: &Value| is_latlng(v).or_else(|| v.as_str().and_then(|n| places.get(n).copied()));
    for r in lists(scene, "routes") {
        let stops: Vec<Option<P>> =
            r.get("stops").and_then(Value::as_array).map(|a| a.iter().map(&stop).collect()).unwrap_or_default();
        let Some(id) = s(&r, "id") else { continue };
        if stops.len() < 2 || stops.iter().any(Option::is_none) {
            continue;
        }
        let stops: Vec<P> = stops.into_iter().flatten().collect();
        let mut path = Vec::new();
        for (i, b) in stops.iter().enumerate().skip(1) {
            let seg = great_circle(stops[i - 1], *b, ROUTE_STEP);
            path.extend(seg.into_iter().skip(if i > 1 { 1 } else { 0 }));
        }
        items.push((
            format!("mr:{id}"),
            Item {
                kind: Kind4::Route,
                path,
                label: s(&r, "label").unwrap_or("").into(),
                tone: s(&r, "tone").map(String::from),
                ..blank()
            },
        ));
    }
    for l in lists(scene, "lines") {
        let Some(id) = s(&l, "id") else { continue };
        let (lat, lng) = (l.get("lat").and_then(Value::as_f64), l.get("lng").and_then(Value::as_f64));
        if lat.is_some() == lng.is_some() {
            continue;
        }
        let parallel = lat.is_some();
        let (lo, hi) = if parallel { (-180.0, 180.0) } else { (-90.0, 90.0) };
        let from = l.get("from").and_then(Value::as_f64).unwrap_or(lo);
        let to = l.get("to").and_then(Value::as_f64).unwrap_or(hi);
        let n = (((to - from).abs() / LINE_STEP).ceil() as usize).max(1);
        let path = (0..=n)
            .map(|i| {
                let v = from + (to - from) * i as f64 / n as f64;
                if parallel { (v, lat.unwrap()) } else { (lng.unwrap(), v) }
            })
            .collect();
        items.push((
            format!("ml:{id}"),
            Item {
                kind: Kind4::Line,
                path,
                label: s(&l, "label").unwrap_or("").into(),
                tone: s(&l, "tone").map(String::from),
                ..blank()
            },
        ));
    }
    for g in lists(scene, "regions") {
        let Some(id) = s(&g, "id") else { continue };
        let mut polygons: Option<Vec<Vec<Vec<P>>>> = None;
        let mut names: Option<Vec<String>> = None;
        if let Some(o) = g.get("outline").and_then(Value::as_array)
            && o.len() >= 3
            && o.iter().all(|p| is_latlng(p).is_some())
        {
            polygons = Some(vec![polygon_of(o.iter().filter_map(is_latlng).collect())]);
        } else if let Some(cs) = g.get("countries").and_then(Value::as_array)
            && !cs.is_empty()
        {
            let codes: Vec<Option<String>> = cs.iter().map(country_code).collect();
            if codes.iter().all(Option::is_some) {
                let codes: Vec<String> = codes.into_iter().flatten().collect();
                polygons = Some(
                    codes
                        .iter()
                        .flat_map(|c| country("50m", c).map(|c| c.polygons.clone()).unwrap_or_default())
                        .collect(),
                );
                names = Some(codes);
            }
        }
        if let Some(polygons) = polygons {
            let center = centroid(&polygons);
            items.push((
                format!("mg:{id}"),
                Item {
                    kind: Kind4::Region,
                    polygons,
                    countries: names,
                    center,
                    label: s(&g, "label").unwrap_or("").into(),
                    tone: s(&g, "tone").map(String::from),
                    ..blank()
                },
            ));
        }
    }
    items
}

impl Item {
    fn points(&self) -> Vec<P> {
        match self.kind {
            Kind4::Place => vec![self.point],
            Kind4::Route | Kind4::Line => self.path.clone(),
            Kind4::Region => self.polygons.iter().flatten().flatten().copied().collect(),
        }
    }
}

// ─── Views and cameras ───

#[derive(Clone, Copy, Debug)]
struct Camera {
    k: f64,
    x: f64,
    y: f64,
}

fn map_ref(scene: &Value, r: &Value) -> Vec<String> {
    let Some(name) = r.as_str() else { return vec![] };
    if name == "map" {
        return vec!["m:map".into()];
    }
    for (field, prefix) in [("places", "mp:"), ("routes", "mr:"), ("lines", "ml:"), ("regions", "mg:")] {
        if lists(scene, field).iter().any(|i| s(i, "id") == Some(name)) {
            return vec![format!("{prefix}{name}")];
        }
    }
    country_code(r).map(|c| vec![format!("mc:{c}")]).unwrap_or_default()
}

struct World<'a> {
    scene: &'a Value,
    items: &'a [(String, Item)],
}

impl World<'_> {
    fn key_points(&self, key: &str) -> Vec<P> {
        if let Some(c) = key.strip_prefix("mc:") {
            return country("50m", c)
                .map(|c| c.polygons.iter().flatten().flatten().copied().collect())
                .unwrap_or_default();
        }
        self.items.iter().find(|(k, _)| k == key).map(|(_, i)| i.points()).unwrap_or_default()
    }

    /// What a view frames, as [[west, south], [east, north]]; None for the whole world (`viewBounds`).
    fn view_bounds(&self, view: &Value) -> Option<[P; 2]> {
        let bounds = if let Some(refs) = view.as_array() {
            let pts: Vec<P> = refs
                .iter()
                .flat_map(|r| map_ref(self.scene, r))
                .filter(|k| k != "m:map")
                .flat_map(|k| self.key_points(&k))
                .collect();
            geo::bounds_of(&pts)?
        } else if let Some(b) = view.get("box").and_then(Value::as_array)
            && b.len() == 2
            && let (Some(sw), Some(ne)) = (is_latlng(&b[0]), is_latlng(&b[1]))
        {
            [(sw.0, sw.1), (ne.0, ne.1)]
        } else {
            return None;
        };
        let [(w, s), (e, n)] = bounds;
        let width = if e >= w { e - w } else { e + 360.0 - w };
        let least = if width == 0.0 && n == s { POINT_SPAN } else { MIN_SPAN };
        let grow = |lo: f64, hi: f64, span: f64| {
            if span >= least { (lo, hi) } else { (lo - (least - span) / 2.0, hi + (least - span) / 2.0) }
        };
        let (w2, e2) = grow(w, if e >= w { e } else { e + 360.0 }, width);
        let (s2, n2) = grow(s, n, n - s);
        Some([(w2, s2.max(-89.0)), (if e2 > 180.0 { e2 - 360.0 } else { e2 }, n2.min(89.0))])
    }

    fn views(&self) -> Vec<Value> {
        let mut views = vec![self.scene.get("view").cloned().unwrap_or(Value::String("world".into()))];
        for step in lists(self.scene, "steps") {
            let last = views.last().unwrap().clone();
            views.push(step.get("view").cloned().unwrap_or(last));
        }
        views
    }

    fn meridian(&self) -> f64 {
        if let Some(m) = self.scene.get("meridian").and_then(Value::as_f64) {
            return m;
        }
        let views = self.views();
        let all: Vec<Option<[P; 2]>> = views.iter().map(|v| self.view_bounds(v)).collect();
        if all.iter().any(Option::is_none) {
            return 0.0;
        }
        let pts: Vec<P> = all.into_iter().flatten().flatten().collect();
        let Some([(w, _), (e, _)]) = geo::bounds_of(&pts) else { return 0.0 };
        let mid = if e >= w { (w + e) / 2.0 } else { (w + e + 360.0) / 2.0 };
        (if mid > 180.0 { mid - 360.0 } else { mid } + 0.5).floor()
    }
}

struct Layout {
    proj: Projection,
    world_box: [f64; 4],
    cameras: Vec<Camera>,
    detail: &'static str,
}

fn camera_of(w: &World, view: &Value, stage: (f64, f64), proj: &Projection, world_box: [f64; 4]) -> Camera {
    let none = Camera { k: 1.0, x: 0.0, y: 0.0 };
    let Some([(wl, s), (e0, n)]) = w.view_bounds(view) else { return none };
    let e = if e0 >= wl { e0 } else { e0 + 360.0 };
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for i in 0..=10 {
        for j in 0..=10 {
            let Some(p) = proj.point(wl + (e - wl) * i as f64 / 10.0, s + (n - s) * j as f64 / 10.0) else { continue };
            (x0, y0, x1, y1) = (x0.min(p.0), y0.min(p.1), x1.max(p.0), y1.max(p.1));
        }
    }
    if x1 <= x0 && y1 <= y0 {
        return none;
    }
    let k = ((stage.0 * (1.0 - 2.0 * PAD)) / (x1 - x0).max(1e-6))
        .min((stage.1 * (1.0 - 2.0 * PAD)) / (y1 - y0).max(1e-6))
        .max(1.0);
    let keep = |c: f64, half: f64, lo: f64, hi: f64| {
        if hi - lo <= 2.0 * half { (lo + hi) / 2.0 } else { (c).max(lo + half).min(hi - half) }
    };
    let cx = keep((x0 + x1) / 2.0, stage.0 / 2.0 / k, world_box[0], world_box[2]);
    let cy = keep((y0 + y1) / 2.0, stage.1 / 2.0 / k, world_box[1], world_box[3]);
    Camera { k, x: stage.0 / 2.0 - cx * k, y: stage.1 / 2.0 - cy * k }
}

/// A camera partway along the smooth zoom of van Wijk and Nuij (`zoomBetween`).
fn zoom_between(a: Camera, b: Camera, t: f64, stage: (f64, f64)) -> Camera {
    let window = |c: Camera| ((stage.0 / 2.0 - c.x) / c.k, (stage.1 / 2.0 - c.y) / c.k, stage.0 / c.k);
    let ((ux0, uy0, w0), (ux1, uy1, w1)) = (window(a), window(b));
    let rho = std::f64::consts::SQRT_2;
    let (dx, dy) = (ux1 - ux0, uy1 - uy0);
    let d2 = dx * dx + dy * dy;
    let (cx, cy, w);
    if d2 < 1e-12 {
        let s = (w1 / w0).ln() / rho;
        (cx, cy, w) = (ux0 + t * dx, uy0 + t * dy, w0 * (rho * t * s).exp());
    } else {
        let d1 = d2.sqrt();
        let b0 = (w1 * w1 - w0 * w0 + rho.powi(4) * d2) / (2.0 * w0 * rho * rho * d1);
        let b1 = (w1 * w1 - w0 * w0 - rho.powi(4) * d2) / (2.0 * w1 * rho * rho * d1);
        let r0 = ((b0 * b0 + 1.0).sqrt() - b0).ln();
        let r1 = ((b1 * b1 + 1.0).sqrt() - b1).ln();
        let sv = t * (r1 - r0) / rho;
        let u = w0 / (rho * rho * d1) * (r0.cosh() * (rho * sv + r0).tanh() - r0.sinh());
        (cx, cy, w) = (ux0 + u * dx, uy0 + u * dy, w0 * r0.cosh() / (rho * sv + r0).cosh());
    }
    let k = stage.0 / w;
    Camera { k, x: stage.0 / 2.0 - cx * k, y: stage.1 / 2.0 - cy * k }
}

/// The first `t` of a path by its length on the globe (`partialPath`).
fn partial_path(path: &[P], t: f64) -> Vec<P> {
    if t >= 1.0 {
        return path.to_vec();
    }
    if t <= 0.0 || path.len() < 2 {
        return path.iter().take(1).copied().collect();
    }
    let lengths: Vec<f64> = path.windows(2).map(|w| geo::distance(w[0], w[1])).collect();
    let mut left = lengths.iter().sum::<f64>() * t;
    let mut out = vec![path[0]];
    for (i, len) in lengths.iter().enumerate() {
        if left >= *len {
            out.push(path[i + 1]);
            left -= len;
            continue;
        }
        out.push(geo::interpolate_at(path[i], path[i + 1], if *len != 0.0 { left / len } else { 0.0 }));
        break;
    }
    out
}

// ─── The scene ───

struct MapView {
    shell: Shell,
    callout: Option<HeaderCallout>,
    scene: Value,
    items: Vec<(String, Item)>,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    stage: (f64, f64),
    layout: Layout,
    land: Vec<(String, geo::Path)>,
    sphere: geo::Path,
    regions: Vec<(String, geo::Path)>,
    stops_of: HashMap<String, Vec<String>>,
    pen: Pen,
}

/// A ref to a map's items.
struct MapRefs<'a>(&'a Value);

impl Refs for MapRefs<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        Some(map_ref(self.0, r)).filter(|k| !k.is_empty())
    }
}

fn default_tone(kind: Kind4) -> &'static str {
    match kind {
        Kind4::Line => "neutral",
        _ => "accent",
    }
}

fn polygons_geom(p: &[Vec<Vec<P>>]) -> Geom<'_> {
    Geom::Polygons(p)
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let shell = Shell::new(scene);
    let stage = crate::chrome::callout::header_box(scene);
    let items = map_items(scene);
    let w = World { scene, items: &items };
    // Item keys a step traces start undrawn.
    let traced: HashSet<String> = lists(scene, "steps")
        .iter()
        .flat_map(|st| lists(st, "trace"))
        .filter_map(|t| t.as_str().map(String::from).or_else(|| s(&t, "ref").map(String::from)))
        .collect();
    let mut initial_values = Vec::new();
    let mut initial_hidden = HashSet::new();
    for field_prefix in [("places", "mp"), ("routes", "mr"), ("lines", "ml"), ("regions", "mg")] {
        for item in lists(scene, field_prefix.0) {
            let Some(id) = s(&item, "id") else { continue };
            let key = format!("{}:{id}", field_prefix.1);
            if let Some(l) = s(&item, "label") {
                initial_values.push((key.clone(), Value::String(l.to_string())));
            }
            if item.get("hidden").and_then(Value::as_bool) == Some(true) {
                initial_hidden.insert(key.clone());
            }
            if (field_prefix.1 == "mr" || field_prefix.1 == "ml") && traced.contains(id) {
                initial_hidden.insert(key);
            }
        }
    }
    let resolve = |r: &Value| map_ref(scene, r);
    let check_value = |_: &str, v: &Value| v.is_string();
    let trace_key = |r: &Value| -> Option<String> {
        let keys = map_ref(scene, r);
        (keys.len() == 1 && (keys[0].starts_with("mr:") || keys[0].starts_with("ml:"))).then(|| keys[0].clone())
    };
    let model = ClosureModel {
        initial_values,
        initial_hidden,
        resolve: &resolve,
        set_prefixes: &["mp:", "mr:", "ml:", "mg:"],
        show_prefixes: &["mp:", "mr:", "ml:", "mg:"],
        tint_prefixes: &["mc:", "mp:", "mr:", "ml:", "mg:"],
        check_value: &check_value,
        trace_key: &trace_key,
        move_key: None,
        morph: None,
    };
    let states = walk_states(&model, scene);
    let targets = crate::targets::target_steps_with(scene, |r| Some(resolve(r)).filter(|k| !k.is_empty()));
    // Projection fitted so the world fills the stage.
    let kind = match s(scene, "projection") {
        Some("natural-earth") => Kind::NaturalEarth,
        Some("mercator") => Kind::Mercator,
        _ => Kind::EqualEarth,
    };
    let meridian = w.meridian();
    let mut proj = Projection::new(kind, meridian);
    let corners = [(meridian - 179.9, -58.0), (meridian + 179.9, 84.0)];
    let world = if kind == Kind::Mercator { Geom::Points(&corners) } else { Geom::Sphere };
    proj.fit_size(stage.0, stage.1, &world);
    let wb = proj.path(&world).bounds().unwrap_or([0.0, 0.0, stage.0, stage.1]);
    let views = w.views();
    let cameras: Vec<Camera> = views.iter().map(|v| camera_of(&w, v, stage, &proj, wb)).collect();
    // The detail: 1:50m when a view zooms in far or the scene names a country only that outline has.
    let named = named_countries(scene);
    let detail: &'static str = if named.iter().any(|c| !countries_at("110m").iter().any(|x| &x.code == c))
        || cameras.iter().any(|c| c.k > FINE_ZOOM)
    {
        "50m"
    } else {
        "110m"
    };
    let land: Vec<(String, geo::Path)> = countries_at(detail)
        .iter()
        .map(|c| (c.code.clone(), proj.path(&polygons_geom(&c.polygons))))
        .filter(|(_, p)| !p.parts.is_empty())
        .collect();
    let sphere = proj.path(&Geom::Sphere);
    let regions: Vec<(String, geo::Path)> = items
        .iter()
        .filter(|(_, i)| i.kind == Kind4::Region)
        .map(|(k, i)| {
            let polys: Vec<Vec<Vec<P>>> = match &i.countries {
                Some(cs) => {
                    cs.iter().flat_map(|c| country(detail, c).map(|c| c.polygons.clone()).unwrap_or_default()).collect()
                }
                None => i.polygons.clone(),
            };
            (k.clone(), proj.path(&polygons_geom(&polys)))
        })
        .collect();
    let mut stops_of: HashMap<String, Vec<String>> = HashMap::new();
    for r in lists(scene, "routes") {
        let Some(rid) = s(&r, "id") else { continue };
        for stop in r.get("stops").and_then(Value::as_array).into_iter().flatten() {
            if let Some(n) = stop.as_str() {
                stops_of.entry(format!("mp:{n}")).or_default().push(format!("mr:{rid}"));
            }
        }
    }
    let mut me = MapView {
        pen: Pen::new(scene, input.segments, &NoRefs, Vec::new(), true, stage),
        callout: HeaderCallout::new(scene),
        shell,
        scene: scene.clone(),
        items,
        states,
        targets,
        stage,
        layout: Layout { proj, world_box: wb, cameras, detail },
        land,
        sphere,
        regions,
        stops_of,
    };
    let refs = MapRefs(scene);
    let mut countries: Vec<String> = Vec::new();
    for key in crate::targets::step_targets_with(scene, |r| refs.resolve(r)).into_iter().flatten() {
        if key.starts_with("mc:") && !countries.contains(&key) {
            countries.push(key);
        }
    }
    let marks: Vec<MarkTargets> =
        (0..crate::timing::scene_steps(scene).len()).map(|k| me.targets_at(k, &countries)).collect();
    me.pen = Pen::new(scene, input.segments, &refs, marks, false, stage);
    Ok(Box::new(me))
}

fn named_countries(scene: &Value) -> Vec<String> {
    let mut refs: Vec<Value> = Vec::new();
    let tint_keys = |t: Option<&Value>| -> Vec<Value> {
        match t {
            Some(Value::Object(o)) => o.keys().map(|k| Value::String(k.clone())).collect(),
            _ => vec![],
        }
    };
    let view_refs = |v: Option<&Value>| -> Vec<Value> { v.and_then(Value::as_array).cloned().unwrap_or_default() };
    refs.extend(tint_keys(scene.get("tint")));
    refs.extend(view_refs(scene.get("view")));
    refs.extend(lists(scene, "places").iter().filter_map(|p| p.get("at").cloned()));
    refs.extend(lists(scene, "regions").iter().flat_map(|r| lists(r, "countries")));
    for st in lists(scene, "steps") {
        match st.get("focus") {
            Some(Value::Array(a)) => refs.extend(a.iter().cloned()),
            Some(v) => refs.push(v.clone()),
            None => {}
        }
        refs.extend(tint_keys(st.get("tint")));
        refs.extend(view_refs(st.get("view")));
    }
    refs.iter().filter_map(country_code).collect()
}

struct LabelSpot {
    anchor: P,
    text: String,
    /// x, y, width and height of its text.
    text_box: Option<(f64, f64, f64, f64)>,
}

struct DrawCtx<'a> {
    sf: &'a StateFrame<'a>,
    focus: &'a FocusSpotlight<'a>,
    camera: Camera,
    me: &'a MapView,
    defs: std::cell::RefCell<Vec<String>>,
}

use crate::steps::brighter;

fn n(v: f64) -> String {
    super::svg::motion::js_num(v)
}

impl DrawCtx<'_> {
    fn light(&self, key: &str) -> Emphasis {
        let mut e = self.focus.emphasis(key);
        for l in std::iter::once(self.focus.emphasis("m:map"))
            .chain(self.me.stops_of.get(key).into_iter().flatten().map(|k| self.focus.emphasis(k)))
        {
            e = brighter(e, l);
        }
        e
    }

    fn glow(&self, e: Emphasis, scale: f64) -> String {
        if e.glow <= 0.0 {
            return String::new();
        }
        let id = format!("glow{}", self.defs.borrow().len());
        self.defs.borrow_mut().push(drop_shadow_filter(
            &id,
            &[(3.0 * e.glow * scale, ACCENT, 1.0), (14.0 * e.glow * scale, ACCENT, 0.45)],
        ));
        format!(" filter=\"url(#{id})\"")
    }

    fn colour(&self, key: &str, own: &str) -> (String, f64) {
        let mix = self.sf.tint(key);
        (mix.main_tone().unwrap_or(own).to_string(), mix.dim_opacity())
    }
}

impl MapView {
    fn trace_progress(&self, segments: &[crate::timing::Segment], frame: f64, key: &str) -> f64 {
        let Some(k) = current_step(segments, frame) else { return 1.0 };
        for j in (0..=k).rev() {
            let Some(when) = self.states.get(j + 1).and_then(|s| s.traces.get(key)) else { continue };
            let Some(segment) = segments.get(j + 1) else { continue };
            let start = segment.from + STEP_SETTLE_FRAMES;
            let cue = when.as_deref().and_then(|w| cue_frame(segment, w));
            let end = (start + TRACE_MIN).max(cue.unwrap_or(segment.voice_from + segment.speaking_frames));
            return interpolate(frame, &[start, end], &[0.0, 1.0], CLAMP.eased(Easing::InOutCubic));
        }
        1.0
    }

    fn on_screen(&self, cam: Camera, p: P) -> Option<P> {
        self.layout.proj.point(p.0, p.1).map(|q| (q.0 * cam.k + cam.x, q.1 * cam.k + cam.y))
    }
}

impl SceneView for MapView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let sf = StateFrame::at(&self.states, f.segments, f.frame);
        let focus = FocusSpotlight::borrowed(&self.targets, f.segments, f.frame);
        let k = current_step(f.segments, f.frame);
        let cam = match k {
            None => self.layout.cameras[0],
            Some(k) => zoom_between(
                self.layout.cameras[k],
                self.layout.cameras[(k + 1).min(self.layout.cameras.len() - 1)],
                sf.t,
                self.stage,
            ),
        };
        let appear = spring(f.frame - START, FPS, Spring::damping(18.0).with_stiffness(140.0)).min(1.0);
        let cx = DrawCtx { sf: &sf, focus: &focus, camera: cam, me: self, defs: Default::default() };
        let (w, h) = self.stage;
        let mut body = format!("<rect width=\"{}\" height=\"{}\" fill=\"{BG}\"/>", n(w), n(h));
        body.push_str(&format!(
            "<path d=\"{}\" fill=\"{OCEAN}\" stroke=\"{BORDER}\" stroke-width=\"1.5\"/>",
            self.sphere.svg(cam.k, cam.x, cam.y)
        ));
        for (code, path) in &self.land {
            let key = format!("mc:{code}");
            let e = cx.light(&key);
            let mix = sf.tint(&key);
            let tone = mix.main_tone();
            let fill = tone.map_or(LAND.to_string(), |t| format!("{}40", tone_color(t)));
            let stroke = match tone {
                Some(t) => tone_color(t),
                None if e.glow > 0.0 => ACCENT,
                None => BORDER,
            };
            let width = if tone.is_some() || e.glow > 0.0 { 2 } else { 1 };
            body.push_str(&format!(
                "<path d=\"{}\" fill=\"{fill}\" stroke=\"{stroke}\" stroke-width=\"{width}\" stroke-linejoin=\"round\" opacity=\"{}\"{}/>",
                path.svg(cam.k, cam.x, cam.y),
                n(e.opacity * mix.dim_opacity()),
                cx.glow(e, cam.k)
            ));
        }
        for (key, path) in &self.regions {
            let shown = sf.shown(key);
            if shown <= 0.0 || path.parts.is_empty() {
                continue;
            }
            let item = &self.items.iter().find(|(k, _)| k == key).unwrap().1;
            let e = cx.light(key);
            let (tone, dim) = cx.colour(key, item.tone.as_deref().unwrap_or("accent"));
            body.push_str(&format!(
                "<path d=\"{}\" fill=\"{}40\" stroke=\"{}\" stroke-width=\"2.5\" stroke-linejoin=\"round\" opacity=\"{}\"{}/>",
                path.svg(cam.k, cam.x, cam.y),
                tone_color(&tone),
                tone_color(&tone),
                n(shown * e.opacity * dim),
                cx.glow(e, cam.k)
            ));
        }
        // Routes and lines drawn on, with the head of one still arriving.
        let mut traces: HashMap<String, f64> = HashMap::new();
        let mut heads: Vec<(f64, f64, &'static str)> = Vec::new();
        for (key, item) in &self.items {
            if item.kind != Kind4::Route && item.kind != Kind4::Line {
                continue;
            }
            let shown = sf.shown(key);
            let traced = self.trace_progress(f.segments, f.frame, key);
            let drawing = traced < 1.0 && !sf.now.hidden.contains(key);
            if (shown <= 0.0 && !drawing) || traced <= 0.0 {
                continue;
            }
            let path = partial_path(&item.path, traced);
            let e = cx.light(key);
            let (tone, dim) = cx.colour(key, item.tone.as_deref().unwrap_or(default_tone(item.kind)));
            let color = tone_color(&tone);
            let d = self.layout.proj.path(&Geom::Line(&path)).svg(cam.k, cam.x, cam.y);
            if drawing && let Some(last) = path.last().and_then(|p| self.on_screen(cam, *p)) {
                heads.push((last.0, last.1, color));
            }
            traces.insert(key.clone(), traced);
            body.push_str(&format!(
                "<path d=\"{d}\" fill=\"none\" stroke=\"{color}\" stroke-width=\"{}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"{}\"{}/>",
                if item.kind == Kind4::Route { 4 } else { 3 },
                n((if drawing { 1.0 } else { shown }) * e.opacity * dim),
                cx.glow(e, cam.k)
            ));
        }
        for (x, y, color) in heads {
            body.push_str(&format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"7\" fill=\"{color}\" stroke=\"{BG}\" stroke-width=\"3\"/>",
                n(x),
                n(y)
            ));
        }
        body.push_str(&self.labels(&cx, &traces));
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><defs>{}</defs>{body}</svg>",
            n(w),
            n(h),
            n(w),
            n(h),
            cx.defs.borrow().join("")
        );
        let callout_draw = |dl: &mut DisplayList, right: f32, top: f32| {
            if let Some(c) = &self.callout {
                c.draw(dl, right, top, &sf);
            }
        };
        let aside = self.callout.as_ref().map(|c| Aside { height: c.height, draw: &callout_draw });
        self.shell.draw(dl, f.frame, f.duration, aside, |dl, _bx| {
            self.pen.draw(dl, f.frame, f.segments, |dl| {
                if let Some(p) = raster_svg(&svg, w.ceil() as u32, h.ceil() as u32) {
                    dl.save();
                    dl.fade(appear as f32);
                    dl.push_clip(0.0, 0.0, w as f32, h as f32, 18.0);
                    dl.image(Arc::new(p), hash64(&svg), 0.0, 0.0, w.ceil() as f32, h.ceil() as f32);
                    dl.pop_clip();
                    dl.restore();
                }
            })
        });
        let _ = (&self.scene, self.layout.detail, self.layout.world_box, TEXT, Family::Sans);
    }
}

impl MapView {
    /// The labels of the shown items (`mapLabels` and the label layer of MapDiagram).
    /// Where an item's label goes under a camera: its anchor, and its text's box when it has text (`mapLabels`).
    fn label_spot(&self, item: &Item, value: &str, cam: Camera) -> Option<LabelSpot> {
        let text = plain_text(value);
        let mut gap = LABEL_GAP;
        let (anchor, side): (Option<P>, Option<&str>) = match item.kind {
            Kind4::Place => {
                if item.dot {
                    gap += DOT_RADIUS;
                }
                (self.on_screen(cam, item.point), item.side.as_deref())
            }
            Kind4::Region => (self.on_screen(cam, item.center), None),
            _ => {
                let shown: Vec<P> = item
                    .path
                    .iter()
                    .filter_map(|p| self.on_screen(cam, *p))
                    .filter(|p| p.0 >= 0.0 && p.1 >= 0.0 && p.0 <= self.stage.0 && p.1 <= self.stage.1)
                    .collect();
                (shown.get(shown.len() / 2).copied().filter(|_| !shown.is_empty()), Some("above"))
            }
        };
        let anchor = anchor?;
        let text_box = (!text.is_empty()).then(|| {
            let width = measure(&text, &Font::new(Family::Sans, LABEL_WEIGHT, LABEL_SIZE));
            let h = LABEL_SIZE * 1.2;
            let (x, y) = match side {
                None => (anchor.0 - width / 2.0, anchor.1 - h / 2.0),
                Some("left") => (anchor.0 - gap - width, anchor.1 - h / 2.0),
                Some("above") => (anchor.0 - width / 2.0, anchor.1 - gap - h),
                Some("below") => (anchor.0 - width / 2.0, anchor.1 + gap),
                _ => (anchor.0 + gap, anchor.1 - h / 2.0),
            };
            (x, y, width, h)
        });
        Some(LabelSpot { anchor, text, text_box })
    }

    /// A map's items where step k's view settles: places by their dot and label, routes, lines and regions by the part
    /// of them on the stage, and the countries the steps light. Notes keep off the labels and dots (`mapTargets`).
    fn targets_at(&self, k: usize, countries: &[String]) -> MarkTargets {
        let state = &self.states[k + 1];
        let cam = self.layout.cameras[(k + 1).min(self.layout.cameras.len() - 1)];
        let stage = Bx::new(0.0, 0.0, self.stage.0, self.stage.1);
        let clip = |b: Bx| -> Option<Bx> {
            let (x0, y0) = (b.x.max(0.0), b.y.max(0.0));
            let (x1, y1) = (b.right().min(stage.width), b.bottom().min(stage.height));
            (x1 > x0 && y1 > y0).then(|| Bx::new(x0, y0, x1 - x0, y1 - y0))
        };
        let screen_box = |points: &[P]| -> Option<Bx> {
            let pts: Vec<P> = points.iter().filter_map(|p| self.layout.proj.point(p.0, p.1)).collect();
            if pts.is_empty() {
                return None;
            }
            let x0 = pts.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
            let x1 = pts.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
            let y0 = pts.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
            let y1 = pts.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
            // A parallel draws flat, so its box gets the thickness of its stroke.
            let (w, h) = ((x1 - x0) * cam.k, (y1 - y0) * cam.k);
            let (px, py) = (((6.0 - w) / 2.0).max(0.0), ((6.0 - h) / 2.0).max(0.0));
            clip(Bx::new(x0 * cam.k + cam.x - px, y0 * cam.k + cam.y - py, w + 2.0 * px, h + 2.0 * py))
        };
        let mut boxes = Vec::new();
        let mut obstacles = Vec::new();
        for (key, item) in &self.items {
            if state.hidden.contains(key) {
                continue;
            }
            let value = state.values.get(key).and_then(Value::as_str).unwrap_or(&item.label);
            let spot = self.label_spot(item, value, cam);
            let dot = spot
                .as_ref()
                .filter(|_| item.kind == Kind4::Place && item.dot)
                .map(|s| Bx::new(s.anchor.0 - DOT_RADIUS, s.anchor.1 - DOT_RADIUS, 2.0 * DOT_RADIUS, 2.0 * DOT_RADIUS));
            let label = spot.as_ref().and_then(|s| s.text_box).map(|(x, y, w, h)| Bx::new(x, y, w, h));
            obstacles.extend(dot.iter().chain(label.iter()).copied());
            let b = if item.kind == Kind4::Place {
                crate::marks::geometry::union([dot.as_ref(), label.as_ref()]).and_then(clip)
            } else {
                screen_box(&item.points())
            };
            if let Some(b) = b {
                boxes.push((key.clone(), b));
            }
        }
        for key in countries {
            let Some(c) = country("50m", &key[3..]) else { continue };
            let points: Vec<P> = c.polygons.iter().flatten().flatten().copied().collect();
            if let Some(b) = screen_box(&points) {
                boxes.push((key.clone(), b));
            }
        }
        MarkTargets { obstacles: Some(obstacles), ..MarkTargets::new(boxes, stage) }
    }

    fn labels(&self, cx: &DrawCtx, traces: &HashMap<String, f64>) -> String {
        let (sf, cam) = (cx.sf, cx.camera);
        let mut out = String::new();
        for (key, item) in &self.items {
            if sf.now.hidden.contains(key) {
                continue;
            }
            let value = sf.now.values.get(key).and_then(Value::as_str).unwrap_or(&item.label);
            let Some(spot) = self.label_spot(item, value, cam) else { continue };
            let (anchor, text) = (spot.anchor, spot.text.clone());
            let shown = sf.shown(key);
            let e = cx.light(key);
            let (tone, dim) = cx.colour(key, item.tone.as_deref().unwrap_or(default_tone(item.kind)));
            let traced = traces.get(key).copied().unwrap_or(1.0);
            let fade = shown * e.opacity * dim * interpolate(traced, &[0.85, 1.0], &[0.0, 1.0], CLAMP);
            if fade <= 0.0 {
                continue;
            }
            let changed = sf.before.values.get(key) != sf.now.values.get(key);
            let color = tone_color(&tone);
            out.push_str(&format!("<g opacity=\"{}\"{}>", n(fade), cx.glow(e, 1.0)));
            if item.kind == Kind4::Place && item.dot {
                out.push_str(&format!("<circle cx=\"{}\" cy=\"{}\" r=\"{DOT_RADIUS}\" fill=\"{color}\" stroke=\"{BG}\" stroke-width=\"3\"/>", n(anchor.0), n(anchor.1)));
            }
            if let Some((x, y, _, h)) = spot.text_box {
                let fill = if item.kind == Kind4::Place { TEXT } else { color };
                let opacity = if changed { 0.35 + 0.65 * sf.t } else { 1.0 };
                out.push_str(&format!(
                    "<text x=\"{}\" y=\"{}\" dominant-baseline=\"central\" font-family=\"Inter Variable\" font-weight=\"{LABEL_WEIGHT}\" font-size=\"{LABEL_SIZE}\" fill=\"{fill}\" stroke=\"{BG}\" stroke-width=\"6\" stroke-linejoin=\"round\" paint-order=\"stroke\" opacity=\"{}\">{}</text>",
                    n(x),
                    n(y + h / 2.0),
                    n(opacity),
                    xml_escape(&text)
                ));
            }
            out.push_str("</g>");
        }
        out
    }
}
