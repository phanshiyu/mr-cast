//! What the picture and diagram scenes (image, svg, mermaid, map) share: a box-filter downscale for pictures, and
//! drawing SVG markup with resvg.

use tiny_skia::Pixmap;

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
/// filters, one after another as chained CSS `drop-shadow()`s do, within a region `(x, y, width, height)` in user
/// units. The region must hold everything the shadows reach that is on screen; an endless one makes the renderer
/// size its buffers for it, and a frame takes seconds.
pub fn drop_shadow_filter_in(id: &str, region: (f64, f64, f64, f64), shadows: &[(f64, &str, f64)]) -> String {
    let (x, y, w, h) = region;
    let mut s = format!(
        r#"<filter id="{id}" filterUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}" color-interpolation-filters="sRGB">"#
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

/// The box of each element named in `ids` as resvg lays out SVG markup, in its root's user units; elements it draws
/// nothing for are left out.
pub fn svg_boxes(svg: &str, ids: &[String]) -> Vec<(String, (f64, f64, f64, f64))> {
    let opt = resvg::usvg::Options { fontdb: fonts(), ..Default::default() };
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return Vec::new() };
    ids.iter()
        .filter_map(|id| {
            let b = tree.node_by_id(id)?.abs_bounding_box()?;
            Some((id.clone(), (b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64)))
        })
        .collect()
}
