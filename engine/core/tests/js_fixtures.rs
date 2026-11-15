//! Timing and text fitting against what the JS computes, from fixtures `node scripts/engine-dump.mjs fixtures`
//! writes by running shared/timing.mjs and shared/textfit.mjs.

use mrc_core::model::Voiceover;
use mrc_core::textfit::{Family, Font, Slot, fit_lines, fit_text, measure};
use mrc_core::timing::{scene_duration, scene_segments, spoken_at};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).expect(&path)).unwrap()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

#[test]
fn timing_matches_the_js() {
    let cases = fixture("timing.json");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 100, "too few timing fixtures");
    for (n, case) in cases.iter().enumerate() {
        let scene = &case["scene"];
        let voiceover: Option<Voiceover> = serde_json::from_value(case["voiceover"].clone()).unwrap();
        let segments = scene_segments(scene, voiceover.as_ref());
        let want = case["segments"].as_array().unwrap();
        assert_eq!(segments.len(), want.len(), "case {n}: segment count");
        for (s, w) in segments.iter().zip(want) {
            let ctx = format!("case {n} ({}): {}", scene["type"], w["text"]);
            assert_eq!(s.text, w["text"].as_str().unwrap_or(""), "{ctx}: text");
            for (got, key) in [
                (s.from, "from"),
                (s.mark_from, "markFrom"),
                (s.voice_from, "voiceFrom"),
                (s.duration, "durationInFrames"),
                (s.speaking_frames, "speakingFrames"),
            ] {
                assert!(close(got, w[key].as_f64().unwrap()), "{ctx}: {key} {got} vs {}", w[key]);
            }
        }
        assert_eq!(scene_duration(&segments), case["duration"].as_f64().unwrap(), "case {n}: duration");
        for (f, w) in [0.0, 7.0, 45.0, 90.0, 200.0].iter().zip(case["spoken"].as_array().unwrap()) {
            let (index, word) = spoken_at(&segments, *f);
            assert_eq!(
                (index as u64, word as u64),
                (w["index"].as_u64().unwrap(), w["word"].as_u64().unwrap()),
                "case {n}: spokenAt({f})"
            );
        }
    }
}

fn slot(v: &Value) -> Slot {
    serde_json::from_value(v.clone()).unwrap()
}

fn lines_text(lines: &Value) -> Vec<Vec<(String, bool, bool)>> {
    lines
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            l.as_array()
                .unwrap()
                .iter()
                .map(|r| {
                    (
                        r["text"].as_str().unwrap().to_string(),
                        r["bold"].as_bool().unwrap_or(false),
                        r["code"].as_bool().unwrap_or(false),
                    )
                })
                .collect()
        })
        .collect()
}

#[test]
fn text_fitting_matches_the_js() {
    let f = fixture("textfit.json");
    let fits = f["fits"].as_array().unwrap();
    assert!(fits.len() > 1000);
    for (n, case) in fits.iter().enumerate() {
        let s = slot(&case["slot"]);
        let text = case["text"].as_str().unwrap();
        let got = fit_text(text, &s);
        let want = &case["fit"];
        let ctx = format!("fit {n}: slot {} width {} text {text:?}", s.name, s.width);
        assert_eq!(got.size, want["size"].as_f64().unwrap(), "{ctx}: size");
        assert_eq!(got.fits, want["fits"].as_bool().unwrap(), "{ctx}: fits");
        let got_lines: Vec<Vec<(String, bool, bool)>> =
            got.lines.iter().map(|l| l.iter().map(|r| (r.text.clone(), r.bold, r.code)).collect()).collect();
        assert_eq!(got_lines, lines_text(&want["lines"]), "{ctx}: lines");
        for (a, b) in got.widths.iter().zip(want["widths"].as_array().unwrap()) {
            assert!(close(*a, b.as_f64().unwrap()), "{ctx}: width {a} vs {b}");
        }
        assert!(close(got.height, want["height"].as_f64().unwrap()), "{ctx}: height");
    }
    for (n, case) in f["lines"].as_array().unwrap().iter().enumerate() {
        let lines: Vec<String> = serde_json::from_value(case["lines"].clone()).unwrap();
        let got = fit_lines(&lines, &slot(&case["slot"]), case["height"].as_f64().unwrap());
        assert_eq!(got.size, case["fit"]["size"].as_f64().unwrap(), "lines {n}: size");
        assert_eq!(got.fits, case["fit"]["fits"].as_bool().unwrap(), "lines {n}: fits");
    }
    for (n, case) in f["measures"].as_array().unwrap().iter().enumerate() {
        let font = &case["font"];
        let family = if font["family"] == "mono" { Family::Mono } else { Family::Sans };
        let mut fo = Font::new(family, font["weight"].as_f64().unwrap(), font["size"].as_f64().unwrap())
            .spacing(font["letterSpacing"].as_f64().unwrap());
        if font["upper"].as_bool().unwrap() {
            fo = fo.upper();
        }
        let got = measure(case["text"].as_str().unwrap(), &fo);
        let want = case["width"].as_f64().unwrap();
        assert!(close(got, want), "measure {n} {case}: {got} vs {want}");
    }
}

#[test]
fn speech_matches_the_js() {
    for case in fixture("speech.json").as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        assert_eq!(mrc_core::speech::speech_text(text), case["spoken"].as_str().unwrap(), "{text}");
    }
}

#[test]
fn springs_and_easings_match_remotion() {
    use mrc_core::anim::{Easing, Spring, spring_full};
    let f = fixture("anim.json");
    for case in f["springs"].as_array().unwrap() {
        let c = &case["config"];
        let mut s = Spring::default();
        if let Some(d) = c["damping"].as_f64() {
            s.damping = d;
        }
        if let Some(k) = c["stiffness"].as_f64() {
            s.stiffness = k;
        }
        let got = spring_full(case["frame"].as_f64().unwrap(), 30.0, s, case["duration"].as_f64());
        let want = case["value"].as_f64().unwrap();
        assert!((got - want).abs() < 1e-9, "{case}: {got}");
    }
    for case in f["easings"].as_array().unwrap() {
        let t = case["t"].as_f64().unwrap();
        assert!(
            (Easing::Bezier(0.25, 0.1, 0.25, 1.0).apply(t) - case["bezier"].as_f64().unwrap()).abs() < 1e-9,
            "{case}"
        );
        assert!((Easing::OutCubic.apply(t) - case["outCubic"].as_f64().unwrap()).abs() < 1e-12, "{case}");
    }
}
