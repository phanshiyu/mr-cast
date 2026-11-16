//! Pen and ink geometry against src/utils/penGeometry.ts and inkGeometry.ts, from fixtures the TS wrote.

use mrc_core::marks::geometry::*;
use serde_json::Value;

fn fixture() -> Vec<Value> {
    let path = format!("{}/tests/fixtures/marks.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn bx(v: &Value) -> Bx {
    Bx::new(
        v["x"].as_f64().unwrap(),
        v["y"].as_f64().unwrap(),
        v["width"].as_f64().unwrap(),
        v["height"].as_f64().unwrap(),
    )
}

fn pt(v: &Value) -> Pt {
    Pt { x: v["x"].as_f64().unwrap(), y: v["y"].as_f64().unwrap() }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

fn same_box(a: &Bx, b: &Value, what: &str) {
    let b = bx(b);
    assert!(
        close(a.x, b.x) && close(a.y, b.y) && close(a.width, b.width) && close(a.height, b.height),
        "{what}: {a:?} vs {b:?}"
    );
}

fn same_strokes(a: &[Stroke], b: &Value, what: &str) {
    let b = b.as_array().unwrap();
    assert_eq!(a.len(), b.len(), "{what}: stroke count");
    for (s, w) in a.iter().zip(b) {
        let pts = w["points"].as_array().unwrap();
        assert_eq!(s.points.len(), pts.len(), "{what}: points");
        assert_eq!(s.sharp, w["sharp"].as_bool().unwrap_or(false), "{what}: sharp");
        for (p, q) in s.points.iter().zip(pts) {
            let q = pt(q);
            assert!(close(p.x, q.x) && close(p.y, q.y), "{what}: {p:?} vs {q:?}");
        }
    }
}

fn same_sketch(a: &Sketch, b: &Value, what: &str) {
    same_strokes(&a.strokes, &b["strokes"], what);
    same_box(&a.bounds, &b["bounds"], what);
}

#[test]
fn pen_and_ink_geometry_match_the_ts() {
    let area = Bx::new(0.0, 0.0, 1712.0, 760.0);
    let obstacles =
        [Bx::new(560.0, 205.0, 200.0, 50.0), Bx::new(100.0, 205.0, 180.0, 50.0), Bx::new(300.0, 300.0, 400.0, 80.0)];
    let lines = [Pt { x: 400.0, y: 330.0 }, Pt { x: 900.0, y: 100.0 }];
    let cases = fixture();
    assert!(cases.len() > 30);
    for c in &cases {
        let target = bx(&c["target"]);
        let seed = c["seed"].as_u64().unwrap() as u32;
        let clutter = Clutter { target, mark: None, obstacles: &obstacles, lines: &lines };
        match c["kind"].as_str().unwrap() {
            "mark" => {
                let mark = Mark::parse(c["mark"].as_str().unwrap()).unwrap();
                let s = sketch_mark(mark, &target, &area, &obstacles, seed, 4.5);
                same_sketch(&s, &c["sketch"], c["mark"].as_str().unwrap());
                same_box(&place_note(mark, (220.0, 43.0), &s, &clutter, &area), &c["note"], "note");
            }
            "arrow" => {
                let (tail, note) = place_arrow((220.0, 43.0), &clutter, &area);
                let t = pt(&c["arrow"]["tail"]);
                assert!(close(tail.x, t.x) && close(tail.y, t.y), "arrow tail");
                same_box(&note, &c["arrow"]["note"], "arrow note");
                same_sketch(&arrow_sketch(tail, &target, seed, 4.5), &c["sketch"], "arrow");
            }
            "tick" => same_sketch(&tick_sketch(&target, seed, 4.5), &c["sketch"], "tick"),
            "brace" => {
                let side = InkSide::parse(c["side"].as_str().unwrap()).unwrap();
                same_sketch(&brace_sketch(&target, side, seed, 4.5), &c["sketch"], "brace");
                same_box(&clear_of(&target, side, &obstacles), &c["clear"], "clearOf");
                same_box(
                    &beside_clear(&target, side, (200.0, 50.0), 16.0, &obstacles, &area),
                    &c["beside"],
                    "besideClear",
                );
            }
            "link" => {
                let source = bx(&c["source"]);
                let tail = edge_toward(&source, Pt { x: target.x, y: target.y });
                same_sketch(&link_sketch(Some(&source), tail, &target, &obstacles, seed, 4.5), &c["sketch"], "link");
                let (b, crowded) = place_text(&target, &target, (200.0, 50.0), &obstacles, &area, &TEXT_SIDES);
                same_box(&b, &c["text"]["box"], "placeText");
                assert_eq!(crowded, c["text"]["crowded"].as_bool().unwrap());
                let (lb, strokes) = leader(&target, (200.0, 50.0), &obstacles, &area, seed, 4.5);
                same_box(&lb, &c["leader"]["box"], "leader");
                same_strokes(&strokes, &c["leader"]["strokes"], "leader strokes");
                match row_end(&target, (200.0, 50.0), &obstacles, &area) {
                    Some(r) => same_box(&r, &c["rowEnd"], "rowEnd"),
                    None => assert!(c["rowEnd"].is_null()),
                }
            }
            k => panic!("unknown case {k}"),
        }
    }
}
