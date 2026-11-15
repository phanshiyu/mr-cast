//! Lucide icons the scenes draw (lucide-react 1.x, ISC licence), as their SVG paths on a 24 by 24 grid.
//! To add one, render it with lucide-react and copy its elements as path data.

use crate::color::Color;
use crate::display::{DisplayList, Path, Stroke, svg_path};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

fn source(name: &str) -> &'static [&'static str] {
    match name {
        "AlertTriangle" => {
            &["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"]
        }
        "ShieldCheck" => &[
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "m9 12 2 2 4-4",
        ],
        "ShieldAlert" => &[
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "M12 8v4",
            "M12 16h.01",
        ],
        "FileCode2" => &[
            "M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35",
            "M14 2v5a1 1 0 0 0 1 1h5",
            "m5 16-3 3 3 3",
            "m9 22 3-3-3-3",
        ],
        "Check" => &["M20 6 9 17l-5-5"],
        "ArrowRight" => &["M5 12h14", "m12 5 7 7-7 7"],
        "CornerDownRight" => &["m15 10 5 5-5 5", "M4 4v7a4 4 0 0 0 4 4h12"],
        "Trash2" => &[
            "M10 11v6",
            "M14 11v6",
            "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
            "M3 6h18",
            "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
        ],
        "FileWarning" => &[
            "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
            "M12 9v4",
            "M12 17h.01",
        ],
        _ => &[],
    }
}

fn paths(name: &str) -> Arc<Vec<Path>> {
    static CACHE: OnceLock<std::sync::Mutex<HashMap<String, Arc<Vec<Path>>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let mut c = cache.lock().unwrap();
    c.entry(name.to_string())
        .or_insert_with(|| Arc::new(source(name).iter().filter_map(|d| svg_path(d)).collect()))
        .clone()
}

/// Draws icon `name` with its 24-unit box at (x, y) scaled to `size` px, stroked `stroke_width` units wide, as a
/// lucide-react `<Icon size strokeWidth color>`.
pub fn draw(dl: &mut DisplayList, name: &str, x: f32, y: f32, size: f32, color: Color, stroke_width: f32) {
    dl.save();
    dl.translate(x, y);
    dl.scale_about(size / 24.0, 0.0, 0.0);
    for p in paths(name).iter() {
        dl.path(p.clone(), None, Some(Stroke::solid(color, stroke_width).rounded()));
    }
    dl.restore();
}

/// Draws a storyboard's icon by its kebab-case Lucide name, from `props.icons`; false when the props lack it.
#[allow(clippy::too_many_arguments)]
pub fn draw_named(
    dl: &mut DisplayList,
    icons: &HashMap<String, Vec<String>>,
    name: &str,
    x: f32,
    y: f32,
    size: f32,
    color: Color,
    stroke_width: f32,
) -> bool {
    let Some(ds) = icons.get(name) else { return false };
    dl.save();
    dl.translate(x, y);
    dl.scale_about(size / 24.0, 0.0, 0.0);
    for d in ds {
        if let Some(p) = svg_path(d) {
            dl.path(p, None, Some(Stroke::solid(color, stroke_width).rounded()));
        }
    }
    dl.restore();
    true
}
