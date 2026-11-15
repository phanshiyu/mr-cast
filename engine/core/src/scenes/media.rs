//! What the picture and diagram scenes (image, svg, mermaid, map) share: the content box a header leaves,
//! focus refs turned into the steps that light them, and a box-filter downscale for pictures.

use crate::chrome::shell::{Shell, callout_box_width};
use crate::steps::{CALM, Emphasis, Spotlight};
use crate::theme::content_box;
use crate::timing::Segment;
use serde_json::Value;
use std::collections::HashMap;
use tiny_skia::Pixmap;

/// The content box a scene lays out in (`headerBox` in src/fit/shell.ts): the header is as tall as a title's, and
/// a title wrapped onto more lines pushes the box down.
pub fn header_box(scene: &Value, shell: &Shell) -> (f64, f64) {
    let has_callout = callout_box_width(scene) > 0.0;
    let (w, h) = content_box(shell.title.is_some() || has_callout);
    match &shell.title {
        Some(t) => (w, h - (t.lines.len() as f64 - 1.0) * (t.size * t.line_height).round()),
        None => (w, h),
    }
}

/// A step's `focus` as a list of refs: one ref, or several.
pub fn focus_refs(step: &Value) -> Vec<&Value> {
    match step.get("focus") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(Value::Null) | None => Vec::new(),
        Some(v) => vec![v],
    }
}

/// For each item key, the steps that light it (`targetSteps`), given how a ref resolves to item keys.
pub fn target_steps(scene: &Value, resolve: impl Fn(&Value) -> Vec<String>) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    let steps = scene.get("steps").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    for (k, step) in steps.iter().enumerate() {
        let mut keys: Vec<String> = Vec::new();
        for r in focus_refs(step) {
            for key in resolve(r) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        for key in keys {
            out.entry(key).or_default().push(k);
        }
    }
    out
}

/// When each step lights its items: the start of its segment (`focusSpotlight`).
pub fn focus_starts(segments: &[Segment]) -> Vec<f64> {
    segments.iter().skip(1).map(|s| s.from).collect()
}

/// Emphasis by item key at a frame (`focusSpotlight`).
pub struct Focus<'a> {
    spot: Spotlight,
    steps: &'a HashMap<String, Vec<usize>>,
}

impl<'a> Focus<'a> {
    pub fn new(frame: f64, segments: &[Segment], steps: &'a HashMap<String, Vec<usize>>) -> Focus<'a> {
        Focus { spot: Spotlight::new(frame, &focus_starts(segments)), steps }
    }
    pub fn of(&self, key: &str) -> Emphasis {
        self.steps.get(key).map_or_else(|| self.spot.emphasis(&[]), |s| self.spot.emphasis(s))
    }
}

/// The emphasis of an item nothing lights or dims.
pub const STILL: Emphasis = CALM;

/// A picture scaled down to `w` by `h` by averaging the source pixels each one covers (premultiplied, so
/// transparent edges do not bleed), the way a browser filters a large picture drawn small.
pub fn downscale(src: &Pixmap, w: u32, h: u32) -> Option<Pixmap> {
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    if w == 0 || h == 0 || w as usize >= sw && h as usize >= sh {
        return None;
    }
    let (w, h) = ((w as usize).min(sw), (h as usize).min(sh));
    let weights = |from: usize, to: usize| -> Vec<Vec<(usize, f32)>> {
        let k = from as f32 / to as f32;
        (0..to)
            .map(|i| {
                let (a, b) = (i as f32 * k, (i as f32 + 1.0) * k);
                let mut v = Vec::new();
                let mut j = a.floor() as usize;
                while (j as f32) < b && j < from {
                    let cover = (b.min(j as f32 + 1.0) - a.max(j as f32)).max(0.0);
                    if cover > 0.0 {
                        v.push((j, cover / k));
                    }
                    j += 1;
                }
                v
            })
            .collect()
    };
    let (wx, wy) = (weights(sw, w), weights(sh, h));
    let data = src.data();
    let mut mid = vec![0f32; w * sh * 4];
    for y in 0..sh {
        for (x, ws) in wx.iter().enumerate() {
            let mut acc = [0f32; 4];
            for &(sx, wt) in ws {
                let p = (y * sw + sx) * 4;
                for c in 0..4 {
                    acc[c] += data[p + c] as f32 * wt;
                }
            }
            mid[(y * w + x) * 4..][..4].copy_from_slice(&acc);
        }
    }
    let mut out = Pixmap::new(w as u32, h as u32)?;
    let dst = out.data_mut();
    for (y, ws) in wy.iter().enumerate() {
        for x in 0..w {
            let mut acc = [0f32; 4];
            for &(sy, wt) in ws {
                let p = (sy * w + x) * 4;
                for c in 0..4 {
                    acc[c] += mid[p + c] * wt;
                }
            }
            let a = acc[3].round().clamp(0.0, 255.0);
            let o = (y * w + x) * 4;
            for c in 0..3 {
                dst[o + c] = acc[c].round().clamp(0.0, a) as u8;
            }
            dst[o + 3] = a as u8;
        }
    }
    Some(out)
}

/// The scene's callout: a boxed line at the right end of the header, such as a formula, that steps replace
/// (src/components/HeaderCallout.tsx).
pub struct Callout {
    fits: Vec<(String, crate::textfit::Fit)>,
    width: f32,
    height: f32,
}

impl Callout {
    pub fn new(scene: &Value) -> Option<Callout> {
        use crate::chrome::fittext::{LineHeight, fit_height};
        use crate::textfit::{Slot, fit_text};
        let mut texts: Vec<String> = Vec::new();
        let mut add = |v: Option<&Value>| {
            if let Some(s) = v.and_then(Value::as_str).filter(|s| !s.is_empty())
                && !texts.iter().any(|t| t == s)
            {
                texts.push(s.to_string());
            }
        };
        add(scene.get("callout"));
        for step in scene.get("steps").and_then(Value::as_array).into_iter().flatten() {
            add(step.get("callout"));
        }
        if texts.is_empty() {
            return None;
        }
        let fits: Vec<(String, crate::textfit::Fit)> =
            texts.into_iter().map(|t| (t.clone(), fit_text(&t, &Slot::named("headerCallout", 560.0 - 44.0)))).collect();
        let width = fits.iter().map(|f| f.1.width).fold(0.0, f64::max) as f32 + 44.0;
        let height = fits.iter().map(|f| fit_height(&f.1, LineHeight::Fit)).fold(0.0, f32::max) + 24.0;
        Some(Callout { fits, width, height })
    }

    pub fn height(&self) -> f32 {
        self.height
    }

    #[allow(clippy::too_many_arguments)]
    /// Draws the callout with its top right corner at (right, top), as the step settles from `was` to `now`.
    pub fn draw(
        &self,
        dl: &mut crate::display::DisplayList,
        right: f32,
        top: f32,
        was: &str,
        now: &str,
        t: f64,
        lit: f64,
    ) {
        use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
        use crate::color::Color;
        use crate::display::{BoxStyle, Shadow};
        use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, BORDER_STRONG, RAISED, TEXT};
        let b2f = |s: &str| if s.is_empty() { 0.0 } else { 1.0 };
        let shown = b2f(was) + (b2f(now) - b2f(was)) * t;
        if shown <= 0.0 {
            return;
        }
        let changed = was != now;
        let glow = if changed { lit } else { 0.0 } as f32;
        let (x, y, w, h) = (right - self.width, top, self.width, self.height);
        dl.push_layer(shown as f32);
        let mut style =
            BoxStyle::fill(RAISED).radius(14.0).border(if glow > 0.0 { ACCENT } else { BORDER_STRONG }, 1.5);
        if glow > 0.0 {
            style = style.shadow(Shadow { dx: 0.0, dy: 0.0, blur: 0.0, spread: 3.0 * glow, color: ACCENT_SOFT });
            style = style.shadow(Shadow::new(0.0, 0.0, 30.0 * glow, ACCENT_GLOW));
        } else {
            style = style.shadow(Shadow::new(0.0, 10.0, 26.0, Color::rgba8(0, 0, 0, 0.35)));
        }
        dl.rect(x, y, w, h, style);
        let text = |dl: &mut crate::display::DisplayList, value: &str, opacity: f64| {
            if value.is_empty() || opacity <= 0.0 {
                return;
            }
            if let Some((_, fit)) = self.fits.iter().find(|f| f.0 == value) {
                let th = fit_height(fit, LineHeight::Fit);
                dl.save();
                dl.fade(opacity as f32);
                draw_fit(dl, fit, x + 1.5, y + 1.5 + (h - 3.0 - th) / 2.0, TextOpts::new(TEXT).centered(w - 3.0));
                dl.restore();
            }
        };
        if changed {
            text(dl, was, 1.0 - t);
            text(dl, now, t);
        } else {
            text(dl, now, 1.0);
        }
        dl.pop_layer();
    }
}

fn fonts() -> std::sync::Arc<resvg::usvg::fontdb::Database> {
    use std::sync::OnceLock;
    static DB: OnceLock<std::sync::Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = resvg::usvg::fontdb::Database::new();
        db.load_font_data(include_bytes!("../../../assets/fonts/inter-latin.ttf").to_vec());
        db.load_font_data(include_bytes!("../../../assets/fonts/jetbrains-mono-latin.ttf").to_vec());
        db.load_font_data(include_bytes!("../../../assets/fonts/caveat-latin-600.ttf").to_vec());
        db.set_sans_serif_family("Inter Variable");
        db.set_monospace_family("JetBrains Mono");
        std::sync::Arc::new(db)
    })
    .clone()
}

/// Rasterizes SVG markup (a `w` by `h` pixel drawing) with resvg; None when it does not parse.
pub fn raster_svg(svg: &str, w: u32, h: u32) -> Option<Pixmap> {
    let opt = resvg::usvg::Options { fontdb: fonts(), ..Default::default() };
    let tree = resvg::usvg::Tree::from_str(svg, &opt).ok()?;
    let mut theirs = resvg::tiny_skia::Pixmap::new(w.max(1), h.max(1))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut theirs.as_mut());
    // resvg draws with its own tiny-skia; both hold premultiplied RGBA8, so the bytes carry over.
    let mut pixmap = Pixmap::new(w.max(1), h.max(1))?;
    pixmap.data_mut().copy_from_slice(theirs.data());
    Some(pixmap)
}

/// A hash of text, to name a rasterized frame for frame equality.
pub fn hash64(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

/// Escapes text and attribute values for XML.
pub fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A filter that draws `shadows` (blur radius in px as CSS gives it, colour as hex, opacity) around what it
/// filters, one after another as chained CSS `drop-shadow()`s do.
pub fn drop_shadow_filter(id: &str, shadows: &[(f64, &str, f64)]) -> String {
    let mut s = format!(
        r#"<filter id="{id}" filterUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" color-interpolation-filters="sRGB">"#
    );
    for (blur, color, alpha) in shadows {
        s.push_str(&format!(
            r#"<feDropShadow dx="0" dy="0" stdDeviation="{}" flood-color="{color}" flood-opacity="{alpha}"/>"#,
            blur / 2.0
        ));
    }
    s.push_str("</filter>");
    s
}
