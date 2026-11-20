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

/// The family the bundled font at `index` (see `text::FONT_DATA`) goes by in resvg's font database. The three faces
/// keep their own names; each fallback gets one of its own (Inter's and JetBrains Mono's share theirs with the Latin
/// files), so a run of text can name the font that has its glyphs.
pub fn svg_family(index: u8) -> String {
    match index {
        0 => "Inter Variable".into(),
        1 => "JetBrains Mono".into(),
        2 => "Caveat".into(),
        i => format!("mr-cast fallback {i}"),
    }
}

/// resvg's font database: every bundled font, with each one's id by its index in `text::FONT_DATA`.
fn fonts() -> &'static (std::sync::Arc<resvg::usvg::fontdb::Database>, Vec<resvg::usvg::fontdb::ID>) {
    use resvg::usvg::fontdb::{Database, Language, Source};
    use std::sync::OnceLock;
    static DB: OnceLock<(std::sync::Arc<Database>, Vec<resvg::usvg::fontdb::ID>)> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = Database::new();
        let mut ids = Vec::new();
        for (i, data) in crate::text::FONT_DATA.iter().enumerate() {
            let mut loaded = Database::new();
            loaded.load_font_source(Source::Binary(std::sync::Arc::new(*data)));
            let mut face = loaded.faces().next().expect("bundled font").clone();
            face.families = vec![(svg_family(i as u8), Language::English_UnitedStates)];
            ids.push(db.push_face_info(face));
        }
        db.set_sans_serif_family("Inter Variable");
        db.set_monospace_family("JetBrains Mono");
        // A family no bundled font has falls back to the serif one: draw it in Inter rather than not at all.
        db.set_serif_family("Inter Variable");
        (std::sync::Arc::new(db), ids)
    })
}

/// resvg's options: the bundled fonts, and a character a font lacks looked for along that face's chain of fallbacks,
/// as the engine's own text does. resvg's own fallback takes the first font in the database that has the character,
/// which for an arrow in Caveat is Inter, and when that font has every other character too it redraws the whole line
/// in it.
fn svg_options() -> resvg::usvg::Options<'static> {
    let mut opt = resvg::usvg::Options { fontdb: fonts().0.clone(), ..Default::default() };
    opt.font_resolver.select_fallback = Box::new(|c, used, _| {
        let ids = &fonts().1;
        let face = match ids.iter().position(|&id| id == used[0])? {
            0 => crate::text::Face::Sans,
            1 => crate::text::Face::Mono,
            2 => crate::text::Face::Hand,
            // A run already in a fallback (see `svg::text_runs`) is shaped whole in it, but only its own characters
            // are kept.
            _ => return None,
        };
        crate::text::chain(face)
            .iter()
            .map(|&i| (i, ids[i as usize]))
            .find(|&(i, id)| !used.contains(&id) && crate::text::font_at(i).charmap().map(c) != 0)
            .map(|(_, id)| id)
    });
    opt
}

/// Rasterizes SVG markup (a `w` by `h` pixel drawing) with resvg; None when it does not parse.
pub fn raster_svg(svg: &str, w: u32, h: u32) -> Option<Pixmap> {
    let opt = svg_options();
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
    let opt = svg_options();
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return Vec::new() };
    ids.iter()
        .filter_map(|id| {
            let b = tree.node_by_id(id)?.abs_bounding_box()?;
            Some((id.clone(), (b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64)))
        })
        .collect()
}

/// Each glyph resvg lays the text of SVG markup out in: the character it draws and the bundled font it comes from
/// (see `text::FONT_DATA`), None for a missing glyph.
#[cfg(test)]
pub fn svg_glyph_fonts(svg: &str) -> Vec<(String, Option<u8>)> {
    fn walk(g: &resvg::usvg::Group, out: &mut Vec<(String, Option<u8>)>) {
        for n in g.children() {
            match n {
                resvg::usvg::Node::Group(g) => walk(g, out),
                resvg::usvg::Node::Text(t) => {
                    for g in t.layouted().iter().flat_map(|s| &s.positioned_glyphs) {
                        let font = fonts().1.iter().position(|&id| id == g.font).map(|i| i as u8);
                        out.push((g.text.clone(), font.filter(|_| g.id.0 != 0)));
                    }
                }
                _ => {}
            }
        }
    }
    let tree = resvg::usvg::Tree::from_str(svg, &svg_options()).expect("svg");
    let mut out = Vec::new();
    walk(tree.root(), &mut out);
    out
}
