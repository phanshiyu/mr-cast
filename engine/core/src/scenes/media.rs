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

/// The box of each element named in `ids`, in its own user units (those a filter on it with
/// `filterUnits="userSpaceOnUse"` is in), cut to the part of it inside the `size` of the canvas, as resvg lays out
/// SVG markup; None for one it draws nothing for or that is wholly outside the canvas.
pub fn svg_local_boxes(svg: &str, ids: &[String], size: (f64, f64)) -> Vec<Option<(f64, f64, f64, f64)>> {
    let opt = svg_options();
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return vec![None; ids.len()] };
    ids.iter()
        .map(|id| {
            let node = tree.node_by_id(id)?;
            let b = node.abs_bounding_box()?;
            let (x0, y0) = ((b.x() as f64).max(0.0), (b.y() as f64).max(0.0));
            let (x1, y1) = ((b.right() as f64).min(size.0), (b.bottom() as f64).min(size.1));
            if x1 <= x0 || y1 <= y0 {
                return None;
            }
            // A group's own transform is part of the space its filter is in, a shape's is its parent's.
            let t = match node {
                resvg::usvg::Node::Group(g) => g.abs_transform(),
                _ => node.abs_transform(),
            }
            .invert()?;
            let corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)].map(|(x, y)| {
                let (x, y) = (x as f32, y as f32);
                ((t.sx * x + t.kx * y + t.tx) as f64, (t.ky * x + t.sy * y + t.ty) as f64)
            });
            let (lx, ly) = corners.iter().fold((f64::MAX, f64::MAX), |(a, b), c| (a.min(c.0), b.min(c.1)));
            let (hx, hy) = corners.iter().fold((f64::MIN, f64::MIN), |(a, b), c| (a.max(c.0), b.max(c.1)));
            Some((lx, ly, hx - lx, hy - ly))
        })
        .collect()
}

/// Where resvg lays out an element: its box, and when it is mostly one stroked line (a line, polyline, open path, or
/// a group of them with little else, such as an arrow with its head), the point halfway along its longest line and the
/// line's direction there (x, y, radians).
pub struct SvgShape {
    pub bbox: (f64, f64, f64, f64),
    pub spine: Option<(f64, f64, f64)>,
}

/// The shape of each element named in `ids` as resvg lays out SVG markup, in its root's user units; elements it draws
/// nothing for are left out. usvg keeps no node for a `<tspan>`, only its text's run of glyphs, so a tspan is found
/// by painting it a colour of its own and taking the box of the glyphs drawn in that colour.
pub fn svg_shapes(svg: &str, ids: &[String]) -> Vec<(String, SvgShape)> {
    let opt = svg_options();
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return Vec::new() };
    let mut found: Vec<Option<SvgShape>> = ids
        .iter()
        .map(|id| {
            let node = tree.node_by_id(id)?;
            let b = node.abs_bounding_box()?;
            let bbox = (b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64);
            Some(SvgShape { bbox, spine: spine_of_node(node, bbox.2 * bbox.3) })
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
            let bbox = (b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64);
            found[i] = Some(SvgShape { bbox, spine: None });
        }
    }
    ids.iter().zip(found).filter_map(|(id, s)| Some((id.clone(), s?))).collect()
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
    use super::svg_shapes;

    #[test]
    fn a_tspan_has_the_box_of_its_own_words() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><g transform="translate(10 0)"><text id="line" x="20" y="100" font-size="40" font-family="Inter Variable" fill="#fff">The <tspan id="verb" fill="#3ddc97" fill-opacity="0.5">quick</tspan> fox <tspan id="end">jumps</tspan></text></g></svg>"##;
        let ids: Vec<String> = ["line", "verb", "end", "none"].map(String::from).to_vec();
        let boxes: std::collections::HashMap<_, _> =
            svg_shapes(svg, &ids).into_iter().map(|(id, s)| (id, s.bbox)).collect();
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

/// How much of a line-like element may be filled area (heads, dots, a short label), as a share of the larger of its
/// box's area and its line's length squared.
const LINE_FILL_SHARE: f64 = 0.1;

fn spine_of_node(node: &resvg::usvg::Node, box_area: f64) -> Option<(f64, f64, f64)> {
    use crate::marks::geometry::{Pt, spine_of};
    use resvg::usvg::Node;
    use resvg::usvg::tiny_skia_path::{PathSegment, Point};
    fn walk(node: &Node, area: &mut f64, lines: &mut Vec<Vec<Pt>>) {
        let rect_area = |b: resvg::usvg::Rect| (b.width() * b.height()) as f64;
        match node {
            Node::Group(g) => g.children().iter().for_each(|c| walk(c, area, lines)),
            Node::Path(p) if !p.is_visible() => {}
            Node::Path(p) => {
                let closed = p.data().segments().any(|s| matches!(s, PathSegment::Close));
                if closed || p.stroke().is_none() {
                    *area += p.abs_bounding_box().map_or(0.0, rect_area);
                    return;
                }
                let tf = p.abs_transform();
                let at = |q: Point| {
                    let mut q = q;
                    tf.map_point(&mut q);
                    Pt { x: q.x as f64, y: q.y as f64 }
                };
                let first = lines.len();
                let mut pts: Vec<Pt> = Vec::new();
                let mut last = Point::zero();
                for seg in p.data().segments() {
                    match seg {
                        PathSegment::MoveTo(q) => {
                            if pts.len() > 1 {
                                lines.push(std::mem::take(&mut pts));
                            }
                            pts.clear();
                            pts.push(at(q));
                            last = q;
                        }
                        PathSegment::LineTo(q) => {
                            pts.push(at(q));
                            last = q;
                        }
                        PathSegment::QuadTo(c, q) => {
                            for i in 1..=16 {
                                let t = i as f32 / 16.0;
                                let u = 1.0 - t;
                                pts.push(at(Point::from_xy(
                                    u * u * last.x + 2.0 * u * t * c.x + t * t * q.x,
                                    u * u * last.y + 2.0 * u * t * c.y + t * t * q.y,
                                )));
                            }
                            last = q;
                        }
                        PathSegment::CubicTo(c1, c2, q) => {
                            for i in 1..=24 {
                                let t = i as f32 / 24.0;
                                let u = 1.0 - t;
                                let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                                pts.push(at(Point::from_xy(
                                    a * last.x + b * c1.x + c * c2.x + d * q.x,
                                    a * last.y + b * c1.y + c * c2.y + d * q.y,
                                )));
                            }
                            last = q;
                        }
                        PathSegment::Close => {}
                    }
                }
                if pts.len() > 1 {
                    lines.push(pts);
                }
                // A fill on an open path covers what its line encloses: nothing for a straight line, a lot for a bowl.
                if p.fill().is_some() {
                    *area += lines[first..].iter().map(|l| enclosed(l)).sum::<f64>();
                }
            }
            Node::Text(t) => *area += rect_area(t.abs_bounding_box()),
            Node::Image(i) => *area += i.abs_bounding_box().width() as f64 * i.abs_bounding_box().height() as f64,
        }
    }
    // The area a polyline closed back to its start encloses (the shoelace formula).
    fn enclosed(l: &[Pt]) -> f64 {
        let n = l.len();
        (0..n).map(|i| l[i].x * l[(i + 1) % n].y - l[(i + 1) % n].x * l[i].y).sum::<f64>().abs() / 2.0
    }
    let (mut area, mut lines) = (0.0, Vec::new());
    walk(node, &mut area, &mut lines);
    let length = |l: &Vec<Pt>| l.windows(2).map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y)).sum::<f64>();
    let longest = lines.iter().max_by(|a, b| length(a).total_cmp(&length(b)))?;
    let len = length(longest);
    if area > LINE_FILL_SHARE * box_area.max(len * len) {
        return None;
    }
    spine_of(longest).map(|s| (s.mid.x, s.mid.y, s.angle))
}

#[cfg(test)]
mod shape_tests {
    use super::*;

    fn shapes(body: &str) -> Vec<(String, SvgShape)> {
        let svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"600\">{body}</svg>");
        svg_shapes(&svg, &["curve".into(), "diag".into(), "card".into(), "frame".into(), "arrow".into(), "bowl".into()])
    }

    #[test]
    fn a_glow_region_is_its_element_in_its_own_units_and_in_frame() {
        let svg = concat!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 800 400">"##,
            r##"<rect id="plain" x="20" y="20" width="100" height="50"/>"##,
            r##"<g transform="translate(300 100)"><rect id="moved" x="10" y="10" width="40" height="40"/></g>"##,
            r##"<g id="group" transform="translate(500 0)"><rect x="0" y="0" width="60" height="60"/></g>"##,
            r##"<rect id="huge" x="-1000" y="-1000" width="4000" height="1100"/>"##,
            r##"<rect id="away" x="900" y="0" width="50" height="50"/></svg>"##,
        );
        let ids = ["plain", "moved", "group", "huge", "away", "none"].map(String::from);
        let boxes = svg_local_boxes(svg, &ids, (400.0, 200.0));
        let near = |b: Option<(f64, f64, f64, f64)>, want: (f64, f64, f64, f64)| {
            let b = b.expect("a box");
            assert!(
                [(b.0, want.0), (b.1, want.1), (b.2, want.2), (b.3, want.3)].iter().all(|(a, w)| (a - w).abs() < 0.5),
                "{b:?} is not {want:?}"
            );
        };
        // Each in the units of the element itself, not the canvas's half-size pixels.
        near(boxes[0], (20.0, 20.0, 100.0, 50.0));
        // A shape's parent moves it: its box is in its parent's units, before the move.
        near(boxes[1], (10.0, 10.0, 40.0, 40.0));
        // A group's own transform is part of its filter's space.
        near(boxes[2], (0.0, 0.0, 60.0, 60.0));
        // Only the part of it the frame shows, which is all a glow can be seen in.
        near(boxes[3], (0.0, 0.0, 800.0, 100.0));
        assert!(boxes[4].is_none() && boxes[5].is_none());
    }

    #[test]
    fn lines_have_a_middle_and_shapes_do_not() {
        let found = shapes(concat!(
            r##"<path id="curve" d="M60 520 C 160 80, 420 80, 520 480" fill="none" stroke="#888" stroke-width="4"/>"##,
            r##"<line id="diag" x1="600" y1="560" x2="920" y2="60" stroke="#888" stroke-width="4"/>"##,
            r##"<rect id="card" x="980" y="40" width="180" height="120" fill="#888"/>"##,
            r##"<rect id="frame" x="980" y="240" width="180" height="120" fill="none" stroke="#888"/>"##,
            r##"<g id="arrow"><path d="M40 580 L 900 580" fill="none" stroke="#888" stroke-width="4"/>"##,
            r##"<path d="M900 570 L 920 580 L 900 590 z" fill="#888"/></g>"##,
            r##"<path id="bowl" d="M40 40 Q 240 440 440 40" stroke="#888"/>"##,
        ));
        let spine = |id: &str| found.iter().find(|(k, _)| k == id).unwrap().1.spine;
        // Halfway along the curve is at its top, near x = 280, not the middle of its box.
        let (x, y, _) = spine("curve").unwrap();
        assert!((x - 280.0).abs() < 15.0 && y < 200.0, "curve middle at ({x}, {y})");
        let (x, y, _) = spine("diag").unwrap();
        assert!((x - 760.0).abs() < 1.0 && (y - 310.0).abs() < 1.0);
        assert!(spine("card").is_none());
        assert!(spine("frame").is_none());
        // An open path with the default fill draws a filled bowl, a shape.
        assert!(spine("bowl").is_none());
        let (x, y, angle) = spine("arrow").unwrap();
        assert!((x - 470.0).abs() < 1.0 && (y - 580.0).abs() < 1.0 && angle.abs() < 1e-6);
    }
}
