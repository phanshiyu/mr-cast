//! The mermaid scene: a Mermaid diagram drawn in the content box. A port of src/components/MermaidDiagram.tsx;
//! where the component runs Mermaid's JS in the browser, the engine draws the SVG with merman (a headless Rust
//! Mermaid) and rasterizes it with resvg. Built without the `mermaid` feature (the wasm player), the scene draws
//! the message card the component shows for a diagram that fails.

use super::media::{hash64, raster_svg};
use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::text::{Style, baseline_in, line_metrics, shape};
use crate::textfit::{Slot, fit_lines, fit_text};
use crate::theme::{ACCENT, BG, DEL, DEL_BG, MUTED, SURFACE, TEXT, content_box};
use crate::timing::FPS;
use serde_json::Value;
use std::sync::Arc;
use tiny_skia::Pixmap;

/// Mermaid lays text out at 16px; past this, small diagrams look blown up rather than legible.
const MAX_UPSCALE: f64 = 1.9;

#[allow(clippy::large_enum_variant)]
enum Body {
    Diagram { pixmap: Arc<Pixmap>, key: u64, w: f64, h: f64 },
    Error { title: crate::textfit::Fit, first: crate::textfit::Fit, rest: Option<crate::textfit::Fit> },
}

struct MermaidView {
    shell: Shell,
    body: Body,
}

/// The CSS `font-weight` merman asks about, as a number: keywords and numbers, 400 when absent or unknown.
#[cfg(feature = "mermaid")]
fn css_weight(w: Option<&str>) -> f32 {
    match w.map(str::trim) {
        Some(w) if w.eq_ignore_ascii_case("bold") => 700.0,
        Some(w) if w.eq_ignore_ascii_case("bolder") => 800.0,
        Some(w) => w.parse::<f32>().map_or(400.0, |n| n.clamp(100.0, 900.0)),
        None => 400.0,
    }
}

/// The width of `text` as the engine's shaper sets it in the font resvg draws: Inter at the style's size and weight
/// (JetBrains Mono for a monospace family). Merman measures each line it wraps itself, so `text` is one line.
#[cfg(feature = "mermaid")]
fn shaped_width(text: &str, style: &merman::svg::TextStyle) -> f64 {
    use crate::text::{Face, Style};
    let mono = style.font_family.as_deref().is_some_and(|f| {
        let f = f.to_ascii_lowercase();
        f.contains("mono") && !f.contains("inter")
    });
    let face = if mono { Face::Mono } else { Face::Sans };
    let size = style.font_size.max(0.0) as f32;
    let weight = css_weight(style.font_weight.as_deref());
    f64::from(crate::text::width(text, Style::new(face, weight, size)))
}

#[cfg(feature = "mermaid")]
fn measurement_policy() -> merman::svg::TextMeasurementPolicy {
    use merman::svg::{
        DeterministicTextMeasurer, MeasurementProfileId, TextMeasurementPolicy, TextMeasurementProfile,
        TextMeasurementProfileIdentity,
    };
    let id = MeasurementProfileId::new("mr-cast.inter-swash").expect("static profile id");
    let identity = TextMeasurementProfileIdentity::new(id, "1").expect("static profile version");
    let measurer = DeterministicTextMeasurer::default().with_width_callback(shaped_width);
    TextMeasurementPolicy::uniform(TextMeasurementProfile::new(identity, measurer))
}

#[cfg(feature = "mermaid")]
fn render(code: &str) -> Result<(String, f64, f64), String> {
    use merman::svg::SvgPipeline;
    use merman::{
        MermaidEngine, OperationControl, RenderOutput, RenderRequest, Renderer, SourcePresentationConfig, SvgRequest,
    };
    let sans = "Inter Variable";
    let palette = ["#7c8cff", "#3ddc97", "#fbbf24", "#ff6b7a", "#5ec8f2", "#c084fc", "#f472b6", "#a3e635"];
    let (node, alt, deep, line, edge) = ("#1c2033", "#161a26", "#11131c", "#aab2c8", "#3a3f52");
    let (accent, text, bg, add, del) = ("#7c8cff", "#f2f4f8", "#07080c", "#3ddc97", "#ff6b7a");
    let mut map = serde_json::Map::new();
    map.insert("darkMode".into(), true.into());
    for (k, v) in [
        ("fontFamily", sans),
        ("fontSize", "16px"),
        ("background", bg),
        ("textColor", text),
        ("titleColor", text),
        ("lineColor", line),
        ("primaryColor", node),
        ("primaryTextColor", text),
        ("primaryBorderColor", accent),
        ("secondaryColor", alt),
        ("secondaryTextColor", text),
        ("secondaryBorderColor", edge),
        ("tertiaryColor", deep),
        ("tertiaryTextColor", text),
        ("tertiaryBorderColor", edge),
        ("mainBkg", node),
        ("nodeBorder", accent),
        ("clusterBkg", deep),
        ("clusterBorder", edge),
        ("edgeLabelBackground", "#0d0f16"),
        ("noteBkgColor", "#2a2414"),
        ("noteTextColor", text),
        ("noteBorderColor", "#fbbf24"),
        ("sectionBkgColor", alt),
        ("altSectionBkgColor", bg),
        ("sectionBkgColor2", alt),
        ("gridColor", edge),
        ("taskBkgColor", "#2b3360"),
        ("taskBorderColor", accent),
        ("taskTextColor", text),
        ("taskTextLightColor", text),
        ("taskTextOutsideColor", text),
        ("taskTextDarkColor", text),
        ("activeTaskBkgColor", accent),
        ("activeTaskBorderColor", accent),
        ("doneTaskBkgColor", "#1f4a3a"),
        ("doneTaskBorderColor", add),
        ("critBkgColor", "#4a1f27"),
        ("critBorderColor", del),
        ("todayLineColor", del),
        ("pieOpacity", "0.92"),
        ("pieStrokeColor", bg),
        ("pieOuterStrokeColor", edge),
        ("pieTitleTextColor", text),
        ("pieSectionTextColor", bg),
        ("pieLegendTextColor", text),
        ("commitLabelColor", text),
        ("commitLabelBackground", node),
        ("classText", text),
        ("labelColor", text),
        ("attributeBackgroundColorOdd", alt),
        ("attributeBackgroundColorEven", deep),
    ] {
        map.insert(k.into(), v.into());
    }
    for (i, c) in palette.iter().enumerate() {
        for key in [format!("pie{}", i + 1), format!("cScale{i}"), format!("git{i}")] {
            map.insert(key, (*c).into());
        }
        for key in [format!("cScaleLabel{i}"), format!("gitBranchLabel{i}")] {
            map.insert(key, bg.into());
        }
    }
    let site = SourcePresentationConfig::from_value(serde_json::json!({
        "theme": "base", "fontFamily": sans, "themeVariables": serde_json::Value::Object(map),
        "gantt": { "useWidth": 1000, "fontSize": 16, "sectionFontSize": 16, "barHeight": 34, "barGap": 8 },
    }));
    let renderer = Renderer::new().with_presentation_engine(MermaidEngine::new().with_site_config(site));
    let mut request = SvgRequest::default();
    request.options.diagram_id = Some("mermaid-scene".to_string());
    request.environment = request.environment.with_text_measurement_policy(measurement_policy());
    request.pipeline = Some(SvgPipeline::resvg_safe());
    let out = renderer.render(RenderRequest::svg(code, OperationControl::new(), request)).map_err(|e| e.to_string())?;
    let RenderOutput::Svg(Some(svg)) = out else { return Err("no Mermaid diagram detected".into()) };
    let svg = svg.svg().to_string();
    let vb = svg
        .split("viewBox=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .ok_or("Mermaid produced a diagram with no size")?;
    let n: Vec<f64> = vb
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    if n.len() != 4 || n[2] <= 0.0 || n[3] <= 0.0 {
        return Err("Mermaid produced a diagram with no size".into());
    }
    Ok((svg, n[2], n[3]))
}

#[cfg(not(feature = "mermaid"))]
fn render(_code: &str) -> Result<(String, f64, f64), String> {
    Err("This player draws no Mermaid diagrams.\nRender the video with the mr-cast engine to see this one.".into())
}

/// The root `<svg>` sized to fill the raster, as `sizedSvg` does.
fn sized(svg: &str, w: u32, h: u32) -> String {
    let Some(start) = svg.find("<svg") else { return svg.to_string() };
    let Some(end) = svg[start..].find('>').map(|e| e + start) else { return svg.to_string() };
    let tag = &svg[start..end];
    let strip = |tag: &str, name: &str| -> String {
        let pat = format!(" {name}=\"");
        match tag.find(&pat) {
            Some(i) => {
                let close = tag[i + pat.len()..].find('"').map_or(tag.len(), |c| c + i + pat.len() + 1);
                format!("{}{}", &tag[..i], &tag[close..])
            }
            None => tag.to_string(),
        }
    };
    let mut t = strip(&strip(&strip(tag, "width"), "height"), "style");
    t.push_str(&format!(" width=\"{w}\" height=\"{h}\""));
    format!("{}{}{}", &svg[..start], t, &svg[end..])
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let code = scene.get("code").and_then(Value::as_str).unwrap_or("");
    let shell = Shell::new(scene);
    let (bw, bh) = content_box(scene.get("title").and_then(Value::as_str).is_some_and(|t| !t.is_empty()));
    let body = match render(code) {
        Ok((svg, w, h)) => {
            let scale = (bw / w).min(bh / h).min(MAX_UPSCALE);
            let (pw, ph) = ((w * scale).round() as u32, (h * scale).round() as u32);
            let svg = sized(&svg, pw, ph);
            match raster_svg(&svg, pw, ph) {
                Some(p) => Body::Diagram { pixmap: Arc::new(p), key: hash64(&svg), w: w * scale, h: h * scale },
                None => error_body("Mermaid produced a diagram that cannot be drawn"),
            }
        }
        Err(m) => error_body(&m),
    };
    Ok(Box::new(MermaidView { shell, body }))
}

fn error_body(message: &str) -> Body {
    let mut lines = message.trim().split('\n');
    let first = lines.next().unwrap_or("Unknown Mermaid error").to_string();
    let rest: Vec<String> = lines.map(String::from).collect();
    let mut title = Slot::named("eyebrow", 1104.0);
    title.size = 20.0;
    title.min = 20.0;
    title.weight = 800.0;
    title.letter_spacing = Some(2.0);
    title.upper = Some(true);
    let mut head = Slot::named("imageCaption", 1104.0);
    head.size = 32.0;
    head.min = 32.0;
    head.weight = 650.0;
    head.lines = 99;
    head.line_height = 1.3;
    head.balanced = Some(false);
    let rest = (!rest.is_empty()).then(|| {
        let mut slot = Slot::named("payload", 1104.0);
        slot.size = 20.0;
        slot.min = 20.0;
        slot.line_height = 1.45;
        fit_lines(&rest, &slot, 220.0)
    });
    Body::Error { title: fit_text("Mermaid diagram failed to render", &title), first: fit_text(&first, &head), rest }
}

impl SceneView for MermaidView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let enter = spring(f.frame - 4.0, FPS, Spring::damping(200.0));
        self.shell.draw(dl, f.frame, f.duration, None, |dl, bx| match &self.body {
            Body::Diagram { pixmap, key, w, h } => {
                let (x, y) = ((bx.w as f64 - w) / 2.0, (bx.h as f64 - h) / 2.0);
                dl.save();
                dl.fade(enter.min(1.0) as f32);
                let s = interpolate(enter, &[0.0, 1.0], &[0.94, 1.0], CLAMP) as f32;
                dl.scale_about(s, (x + w / 2.0) as f32, (y + h / 2.0) as f32);
                dl.image(pixmap.clone(), *key, x as f32, y as f32, *w as f32, *h as f32);
                dl.restore();
            }
            Body::Error { title, first, rest } => {
                let w = 1200.0f32;
                let inner = |fit: &crate::textfit::Fit| fit_height(fit, LineHeight::Fit);
                let mut h = 40.0 + 40.0 + 4.0 + inner(title) + 16.0 + inner(first);
                if let Some(r) = rest {
                    h += 24.0 + inner(r).min(220.0);
                }
                let (x, y) = ((bx.w - w) / 2.0, (bx.h - h) / 2.0);
                dl.save();
                dl.fade(1.0);
                dl.rect(
                    x,
                    y,
                    w,
                    h,
                    BoxStyle::fill(SURFACE).radius(24.0).border(DEL, 2.0).shadow(Shadow {
                        dx: 0.0,
                        dy: 0.0,
                        blur: 0.0,
                        spread: 6.0,
                        color: DEL_BG,
                    }),
                );
                let mut top = y + 2.0 + 40.0;
                top += draw_fit(dl, title, x + 2.0 + 48.0, top, TextOpts::new(DEL)) + 16.0;
                top += draw_fit(dl, first, x + 2.0 + 48.0, top, TextOpts::new(TEXT));
                if let Some(r) = rest {
                    draw_fit(dl, r, x + 2.0 + 48.0, top + 24.0, TextOpts::new(MUTED));
                }
                dl.restore();
            }
        });
        let _ = (ACCENT, BG, Color::TRANSPARENT, Style::mono(400.0, 1.0), baseline_in, line_metrics, shape);
    }
}
