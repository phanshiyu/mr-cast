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
/// nothing for are left out. usvg keeps no node for a `<tspan>`, only its text's run of glyphs, so a tspan is found
/// by painting it a colour of its own and taking the box of the glyphs drawn in that colour.
pub fn svg_boxes(svg: &str, ids: &[String]) -> Vec<(String, (f64, f64, f64, f64))> {
    let opt = resvg::usvg::Options { fontdb: fonts(), ..Default::default() };
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return Vec::new() };
    let mut found: Vec<Option<(f64, f64, f64, f64)>> = ids
        .iter()
        .map(|id| {
            let b = tree.node_by_id(id)?.abs_bounding_box()?;
            Some((b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64))
        })
        .collect();
    let mut marked = svg.to_string();
    let mut colours = std::collections::HashMap::new();
    for (i, id) in ids.iter().enumerate() {
        if found[i].is_none() && colours.len() < 0x10000 {
            let colour = [0x01, 0x7f ^ (colours.len() >> 8) as u8, colours.len() as u8];
            if let Some(m) = mark_tspan(&marked, id, colour) {
                marked = m;
                colours.insert(colour, i);
            }
        }
    }
    if !colours.is_empty()
        && let Ok(tree) = resvg::usvg::Tree::from_str(&marked, &opt)
    {
        let mut boxes: std::collections::HashMap<usize, resvg::usvg::Rect> = std::collections::HashMap::new();
        span_boxes(tree.root(), false, &colours, &mut boxes);
        for (i, b) in boxes {
            found[i] = Some((b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64));
        }
    }
    ids.iter().zip(found).filter_map(|(id, b)| Some((id.clone(), b?))).collect()
}

/// `svg` with the `<tspan>` whose id is `id` filled in `colour`, solid, or None if no tspan has that id.
fn mark_tspan(svg: &str, id: &str, colour: [u8; 3]) -> Option<String> {
    let at = svg.find(&format!(" id=\"{}\"", xml_escape(id)))?;
    let start = svg[..at].rfind('<')?;
    let end = at + svg[at..].find('>')?;
    let tag = &svg[start..end];
    let rest = tag.strip_prefix("<tspan")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let mut attrs = rest.to_string();
    for name in ["fill", "fill-opacity"] {
        if let Some(a) = attrs.find(&format!(" {name}=\"")) {
            let from = a + name.len() + 3;
            let to = from + attrs[from..].find('"')? + 1;
            attrs.replace_range(a..to, "");
        }
    }
    let [r, g, b] = colour;
    Some(format!("{}<tspan fill=\"#{r:02x}{g:02x}{b:02x}\"{attrs}{}", &svg[..start], &svg[end..]))
}

/// The box of the glyphs each marker colour paints, in the texts under `group`, by the index the colour stands for.
fn span_boxes(
    group: &resvg::usvg::Group,
    in_text: bool,
    colours: &std::collections::HashMap<[u8; 3], usize>,
    out: &mut std::collections::HashMap<usize, resvg::usvg::Rect>,
) {
    use resvg::usvg::{Node, Paint};
    for node in group.children() {
        match node {
            Node::Group(g) => span_boxes(g, in_text, colours, out),
            Node::Text(t) => span_boxes(t.flattened(), true, colours, out),
            Node::Path(p) if in_text => {
                let Some(Paint::Color(c)) = p.fill().map(|f| f.paint()) else { continue };
                let (Some(&i), Some(b)) = (colours.get(&[c.red, c.green, c.blue]), p.abs_bounding_box()) else {
                    continue;
                };
                let b = match out.get(&i) {
                    Some(o) => resvg::usvg::Rect::from_ltrb(
                        o.left().min(b.left()),
                        o.top().min(b.top()),
                        o.right().max(b.right()),
                        o.bottom().max(b.bottom()),
                    )
                    .unwrap_or(b),
                    None => b,
                };
                out.insert(i, b);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::svg_boxes;

    #[test]
    fn a_tspan_has_the_box_of_its_own_words() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><g transform="translate(10 0)"><text id="line" x="20" y="100" font-size="40" font-family="Inter Variable" fill="#fff">The <tspan id="verb" fill="#3ddc97" fill-opacity="0.5">quick</tspan> fox <tspan id="end">jumps</tspan></text></g></svg>"##;
        let ids: Vec<String> = ["line", "verb", "end", "none"].map(String::from).to_vec();
        let boxes: std::collections::HashMap<_, _> = svg_boxes(svg, &ids).into_iter().collect();
        let (line, verb, end) = (boxes["line"], boxes["verb"], boxes["end"]);
        assert!(!boxes.contains_key("none"));
        for (name, b) in [("verb", verb), ("end", end)] {
            assert!(b.2 > 0.0 && b.3 > 0.0, "{name} has a box");
            assert!(
                b.0 >= line.0 && b.0 + b.2 <= line.0 + line.2 + 0.5,
                "{name} lies along the line: {b:?} in {line:?}"
            );
            assert!(b.1 >= line.1 - 0.5 && b.1 + b.3 <= line.1 + line.3 + 0.5, "{name} sits on the line");
        }
        assert!(verb.0 > line.0 + 40.0, "the verb starts after \"The\": {verb:?}");
        assert!(verb.0 + verb.2 < end.0, "the verb ends before the last word");
        assert!(verb.2 < line.2 / 2.0, "the verb is one word of the line");
    }
}
