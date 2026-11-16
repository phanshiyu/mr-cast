//! The video's chapters: one per run of scenes with the same chapter title, as the MP4's chapter markers list them.

use crate::timing::TimedScene;
use serde_json::Value;

/// A chapter of the video, in frames from its start.
#[derive(Clone, Debug, PartialEq)]
pub struct Chapter {
    pub title: String,
    pub from: f64,
    pub to: f64,
}

/// A scene's chapter title in the MP4: its `chapter`, or its type when it has none.
fn title(scene: &Value) -> String {
    let chapter = scene.get("chapter").and_then(Value::as_str).map(str::trim).unwrap_or("");
    if chapter.is_empty() {
        scene.get("type").and_then(Value::as_str).unwrap_or("").to_string()
    } else {
        chapter.into()
    }
}

/// Consecutive scenes with one title share a chapter.
pub fn chapters(scenes: &[Value], timeline: &[TimedScene]) -> Vec<Chapter> {
    let mut out: Vec<Chapter> = Vec::new();
    for t in timeline {
        let title = title(&scenes[t.index]);
        let to = t.from + t.duration;
        match out.last_mut() {
            Some(last) if last.title == title => last.to = to,
            _ => out.push(Chapter { title, from: t.from, to }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scenes_with_one_title_share_a_chapter() {
        let scenes = vec![
            json!({"type": "text", "chapter": " Why "}),
            json!({"type": "code", "chapter": "Why"}),
            json!({"type": "flow"}),
        ];
        let t = |index, from, duration| TimedScene { index, from, duration, segments: vec![] };
        let got = chapters(&scenes, &[t(0, 0.0, 30.0), t(1, 30.0, 60.0), t(2, 90.0, 10.0)]);
        assert_eq!(
            got,
            vec![
                Chapter { title: "Why".into(), from: 0.0, to: 90.0 },
                Chapter { title: "flow".into(), from: 90.0, to: 100.0 },
            ]
        );
    }
}
