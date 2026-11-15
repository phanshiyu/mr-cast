//! The generic camera: a step's `camera` frames refs, and the view eases there as the step starts (shared/camera.mjs,
//! and `Camera`/`useCameraView` of src/components/SceneShell.tsx). A scene builds a [`Camera`] once and wraps its
//! content in [`Camera::draw`] every frame, with the same targets it gives the pen.

use crate::display::DisplayList;
use crate::marks::geometry::Bx;
use crate::marks::{MarkTargets, RefKeys, StepRefs};
use crate::steps::{current_step, step_move};
use crate::timing::{Segment, scene_steps};
use serde_json::Value;

const ZOOM_MAX: f64 = 40.0;
const FIT_ZOOM_MAX: f64 = 6.0;
const MARGIN_SHARE: f64 = 0.15;
const MARGIN_PX: f64 = 48.0;
/// How far past the content box a camera's view still paints, fading out there.
pub const CAMERA_BLEED: f32 = 32.0;

/// What a shot frames: item keys, and a zoom when the step gives one.
#[derive(Clone, Debug)]
pub struct Shot {
    pub keys: Vec<String>,
    pub zoom: Option<f64>,
}

/// Where a view looks: the content-box point at the screen's centre, and its enlargement (1 is the whole scene).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// The whole scene.
pub fn whole_view(area: (f64, f64)) -> View {
    View { x: area.0 / 2.0, y: area.1 / 2.0, zoom: 1.0 }
}

/// The view at rest on a shot (`frameShot`).
pub fn frame_shot(shot: Option<&Shot>, box_of: &dyn Fn(&str) -> Option<Bx>, area: (f64, f64)) -> View {
    let Some(shot) = shot else { return whole_view(area) };
    let boxes: Vec<Bx> = shot
        .keys
        .iter()
        .filter_map(|k| box_of(k))
        .filter(|b| b.x.is_finite() && b.width >= 0.0 && b.height >= 0.0)
        .collect();
    if boxes.is_empty() {
        return whole_view(area);
    }
    let x0 = boxes.iter().map(|b| b.x).fold(f64::INFINITY, f64::min);
    let y0 = boxes.iter().map(|b| b.y).fold(f64::INFINITY, f64::min);
    let x1 = boxes.iter().map(|b| b.right()).fold(f64::NEG_INFINITY, f64::max);
    let y1 = boxes.iter().map(|b| b.bottom()).fold(f64::NEG_INFINITY, f64::max);
    let margin = MARGIN_PX.max(MARGIN_SHARE * (x1 - x0).max(y1 - y0));
    let fit = (area.0 / (x1 - x0 + 2.0 * margin)).min(area.1 / (y1 - y0 + 2.0 * margin));
    let zoom = ZOOM_MAX.min(1f64.max(shot.zoom.unwrap_or(fit.min(FIT_ZOOM_MAX))));
    let keep = |c: f64, size: f64| (size - size / (2.0 * zoom)).min((size / (2.0 * zoom)).max(c));
    View { x: keep((x0 + x1) / 2.0, area.0), y: keep((y0 + y1) / 2.0, area.1), zoom }
}

/// A view partway from one to another, zooming about one fixed point (`tweenView`).
pub fn tween_view(a: View, b: View, t: f64) -> View {
    if t <= 0.0 {
        return a;
    }
    if t >= 1.0 {
        return b;
    }
    let zoom = a.zoom * (b.zoom / a.zoom).powf(t);
    let share =
        if (b.zoom - a.zoom).abs() < 1e-6 { t } else { (1.0 / a.zoom - 1.0 / zoom) / (1.0 / a.zoom - 1.0 / b.zoom) };
    View { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share, zoom }
}

/// A scene's camera: each state's shot (`cameraShots`, without its problem reports).
pub struct Camera {
    shots: Vec<Option<Shot>>,
    moves: bool,
    area: (f64, f64),
}

impl Camera {
    /// The camera of `scene`, framing within `area`, the scene's `headerBox` (see `chrome::callout::header_box`).
    pub fn new(scene: &Value, refs: &StepRefs, area: (f64, f64)) -> Camera {
        let steps = scene_steps(scene);
        let mut shots = vec![None];
        let moves = steps.iter().any(|s| s.get("camera").is_some());
        let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
        let mut shot: Option<Shot> = None;
        for step in steps {
            if moves
                && ty != "map"
                && !(ty == "image" && scene.get("kenBurns").is_some_and(|v| v.as_bool() != Some(false) && !v.is_null()))
                && let Some(value) = step.get("camera")
                && let Some(next) = read_shot(refs, step, value)
            {
                shot = next;
            }
            shots.push(shot.clone());
        }
        Camera { shots, moves, area }
    }

    /// Whether any step moves the camera; without, the scene draws exactly as it would with none.
    pub fn moves(&self) -> bool {
        self.moves
    }

    /// Where the camera looks at `frame`, or None when no step moves it (`useCameraView`). `targets(k)` are the boxes
    /// the scene gives its pen for step k.
    pub fn view(
        &self,
        frame: f64,
        segments: &[Segment],
        targets: &dyn Fn(usize) -> Option<MarkTargets>,
    ) -> Option<View> {
        if !self.moves {
            return None;
        }
        let view_at = |state: usize| {
            let t = if state > 0 { targets(state - 1) } else { None };
            let box_of = |key: &str| t.as_ref().and_then(|t| t.get(key));
            frame_shot(self.shots.get(state).and_then(Option::as_ref), &box_of, self.area)
        };
        Some(match current_step(segments, frame) {
            Some(k) if segments.get(k + 2).is_some() => {
                tween_view(view_at(k + 1), view_at(k + 2), step_move(frame, segments[k + 2].from))
            }
            None if segments.get(1).is_some() => tween_view(view_at(0), view_at(1), step_move(frame, segments[1].from)),
            Some(k) => view_at(k + 1),
            None => view_at(0),
        })
    }

    /// Draws `content` (in content-box coordinates) as `view` shows it: zoomed and panned, fading out over
    /// CAMERA_BLEED px past the content box. Without a view, draws it as it is.
    pub fn draw(&self, dl: &mut DisplayList, view: Option<View>, content: impl FnOnce(&mut DisplayList)) {
        let Some(v) = view else {
            content(dl);
            return;
        };
        let (w, h) = (self.area.0 as f32, self.area.1 as f32);
        dl.push_fade_layer(-CAMERA_BLEED, -CAMERA_BLEED, w + 2.0 * CAMERA_BLEED, h + 2.0 * CAMERA_BLEED, CAMERA_BLEED);
        dl.save();
        dl.translate((self.area.0 / 2.0 - v.x * v.zoom) as f32, (self.area.1 / 2.0 - v.y * v.zoom) as f32);
        dl.scale_about(v.zoom as f32, 0.0, 0.0);
        content(dl);
        dl.restore();
        dl.pop_layer();
    }
}

/// A step's `camera` as a shot: Some(None) for "all", None when it is not a shot (`readShot`).
fn read_shot(refs: &StepRefs, step: &Value, value: &Value) -> Option<Option<Shot>> {
    if value.as_str() == Some("all") {
        return Some(None);
    }
    let (on, zoom) = match value {
        Value::Object(o) => {
            if o.keys().any(|k| k != "on" && k != "zoom") {
                return None;
            }
            let zoom = match o.get("zoom") {
                None => None,
                Some(z) => Some(z.as_f64().filter(|z| z.is_finite() && (1.0..=ZOOM_MAX).contains(z))?),
            };
            (o.get("on")?.clone(), zoom)
        }
        v => (v.clone(), None),
    };
    let list = match on {
        Value::Array(a) => a,
        v => vec![v],
    };
    if list.is_empty() || list.iter().any(|r| r.as_str() == Some("all")) {
        return None;
    }
    let mut keys: Vec<String> = Vec::new();
    for r in &list {
        if !(r.is_string() || r.as_f64().is_some_and(f64::is_finite)) {
            return None;
        }
        match refs.keys(step, r) {
            RefKeys::Keys(k) => {
                for key in k {
                    if !keys.contains(&key) {
                        keys.push(key);
                    }
                }
            }
            _ => return None,
        }
    }
    Some(Some(Shot { keys, zoom }))
}
