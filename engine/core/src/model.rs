//! The props the Node CLI hands the engine: the same object bin/lib/render.mjs passes Remotion as inputProps,
//! written as JSON, plus `highlight`, the syntax colours Node computes with the player's own highlighter.
//! Every struct ignores fields it does not know, so the model can lag the storyboard schema.

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Props {
    pub storyboard: Storyboard,
    #[serde(default)]
    pub hunks: HashMap<String, Hunk>,
    #[serde(default = "yes")]
    pub show_captions: bool,
    #[serde(default)]
    pub voiceover: Option<Voiceover>,
    #[serde(default)]
    pub highlight: Highlight,
    /// The run's images.json: each image source as written, with its copy's file (resolved by the host) and size.
    #[serde(default)]
    pub images: HashMap<String, ImageEntry>,
    /// The decoded copies, by the same sources. The core reads no files: the host decodes each `images` file
    /// (see [`Picture::from_rgba8`]) and fills this in before building a `Project`.
    #[serde(skip)]
    pub pictures: HashMap<String, Picture>,
}

/// One image of the run's images.json.
#[derive(Clone, Debug, Deserialize)]
pub struct ImageEntry {
    pub file: String,
    pub width: u32,
    pub height: u32,
}

/// A decoded image: premultiplied RGBA, shared by every frame that draws it.
#[derive(Clone, Debug)]
pub struct Picture {
    pub pixmap: std::sync::Arc<tiny_skia::Pixmap>,
}

impl Picture {
    /// From straight (non-premultiplied) RGBA8 pixels, row by row; None when the size and data disagree.
    pub fn from_rgba8(width: u32, height: u32, rgba: &[u8]) -> Option<Picture> {
        let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
        if rgba.len() != pixmap.data().len() {
            return None;
        }
        for (dst, src) in pixmap.pixels_mut().iter_mut().zip(rgba.as_chunks::<4>().0) {
            let c = tiny_skia::ColorU8::from_rgba(src[0], src[1], src[2], src[3]).premultiply();
            *dst = c;
        }
        Some(Picture { pixmap: std::sync::Arc::new(pixmap) })
    }
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize)]
pub struct Storyboard {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    /// Scenes stay JSON: each scene module reads its own fields with serde (see `scenes`).
    pub scenes: Vec<Value>,
    /// Review mode's findings (shared/review.mjs); an array when the storyboard is a reviewed one.
    #[serde(default)]
    pub findings: Option<Value>,
    /// The brief (what the change is for, what to check first, its parts), kept as JSON.
    #[serde(default)]
    pub brief: Option<Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineType {
    Context,
    Add,
    Del,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub kind: LineType,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HunkStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Source,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub id: String,
    pub file: String,
    #[serde(default)]
    pub old_file: Option<String>,
    pub status: HunkStatus,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub start_line: i64,
    #[serde(default)]
    pub old_start_line: i64,
    #[serde(default)]
    pub end_line: i64,
    #[serde(default)]
    pub additions: i64,
    #[serde(default)]
    pub deletions: i64,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Sentence {
    pub start: f64,
    pub end: f64,
    pub words: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Clip {
    #[serde(default)]
    pub src: String,
    pub seconds: f64,
    #[serde(default)]
    pub sentences: Option<Vec<Sentence>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Voiceover {
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub speed: Option<f64>,
    #[serde(default)]
    pub pauses: Option<f64>,
    #[serde(default)]
    pub clips: HashMap<String, Clip>,
}

/// A line of code as coloured pieces: [text, CSS colour].
pub type TokenLine = Vec<(String, String)>;

/// Syntax colours from src/utils/highlight.ts (Prism with the One Dark theme), computed by Node so the
/// engine draws exactly the player's colours without a second highlighter (see engine/README.md).
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Highlight {
    /// The colour of text no token style names.
    #[serde(default)]
    pub plain: Option<String>,
    /// Each hunk's lines, by hunk id, index for index with `hunk.lines`.
    #[serde(default)]
    pub hunks: HashMap<String, Vec<TokenLine>>,
    /// Other code a scene draws, keyed "<language>\n<code>".
    #[serde(default)]
    pub snippets: HashMap<String, Vec<TokenLine>>,
}
