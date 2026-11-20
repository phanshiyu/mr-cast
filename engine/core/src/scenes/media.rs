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

/// Where resvg lays out an element: its box, and when it is mostly one stroked line (a line, polyline, open path, or
/// a group of them with little else, such as an arrow with its head), the point halfway along its longest line and the
/// line's direction there (x, y, radians).
pub struct SvgShape {
    pub bbox: (f64, f64, f64, f64),
    pub spine: Option<(f64, f64, f64)>,
}

/// The shape of each element named in `ids` as resvg lays out SVG markup, in its root's user units; elements it draws
/// nothing for are left out.
pub fn svg_shapes(svg: &str, ids: &[String]) -> Vec<(String, SvgShape)> {
    let opt = resvg::usvg::Options { fontdb: fonts(), ..Default::default() };
    let Ok(tree) = resvg::usvg::Tree::from_str(svg, &opt) else { return Vec::new() };
    ids.iter()
        .filter_map(|id| {
            let node = tree.node_by_id(id)?;
            let b = node.abs_bounding_box()?;
            let bbox = (b.x() as f64, b.y() as f64, b.width() as f64, b.height() as f64);
            Some((id.clone(), SvgShape { bbox, spine: spine_of_node(node, bbox.2 * bbox.3) }))
        })
        .collect()
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
mod tests {
    use super::*;

    fn shapes(body: &str) -> Vec<(String, SvgShape)> {
        let svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"600\">{body}</svg>");
        svg_shapes(&svg, &["curve".into(), "diag".into(), "card".into(), "frame".into(), "arrow".into(), "bowl".into()])
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
