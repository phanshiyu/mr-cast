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
