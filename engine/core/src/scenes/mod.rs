//! The scene registry. Each scene type lives in its own module and registers one `prepare` function in
//! [`REGISTRY`]; see engine/README.md for the contract.

use crate::display::DisplayList;
use crate::model::Props;
use crate::timing::Segment;
use serde_json::Value;

pub mod array;
pub mod chart;
pub mod code;
pub mod compare;
pub mod er;
pub mod files;
pub mod flow;
pub mod graph;
pub mod image;
pub mod layers;
pub mod map;
pub mod media;
pub mod memory;
pub mod mermaid;
pub mod placeholder;
pub mod plot;
pub mod reading;
pub mod refs;
pub mod review;
pub mod sequence;
pub mod state;
pub mod svg;
pub mod table;
pub mod terminal;
pub mod tests;
pub mod text;
pub mod timeline;

/// What a scene is prepared from, once per project.
pub struct SceneInput<'a> {
    /// The storyboard scene, as JSON: deserialize the fields the type reads with serde.
    pub scene: &'a Value,
    /// Its index in the storyboard.
    pub index: usize,
    /// The whole props: hunks, syntax colours, the storyboard.
    pub props: &'a Props,
    /// The scene's length in frames.
    pub duration: f64,
    /// What the scene speaks, timed from its start: segment 0 is the narration, segment k + 1 is step k.
    pub segments: &'a [Segment],
}

/// One frame of a scene.
pub struct Frame<'a> {
    /// Frames since the scene's start (Remotion's `useCurrentFrame()` inside its `Sequence`).
    pub frame: f64,
    pub duration: f64,
    pub segments: &'a [Segment],
}

/// A prepared scene: layout done, ready to draw any frame. Shared by the render threads, so it holds no
/// per-frame state.
pub trait SceneView: Send + Sync {
    /// Draws the scene at `f.frame` in frame coordinates (1920 by 1080), shell included.
    fn draw(&self, f: &Frame, dl: &mut DisplayList);
}

/// Prepares a scene of one type, or explains why it cannot.
pub type Prepare = fn(&SceneInput) -> Result<Box<dyn SceneView>, String>;

/// Scene types the engine draws; any other type draws a placeholder card.
pub const REGISTRY: &[(&str, Prepare)] = &[
    ("text", text::prepare),
    ("code", code::prepare),
    ("flow", flow::prepare),
    ("compare", compare::prepare),
    ("terminal", terminal::prepare),
    ("array", array::prepare),
    ("memory", memory::prepare),
    ("plot", plot::prepare),
    ("chart", chart::prepare),
    ("table", table::prepare),
    ("review", review::prepare),
    ("reading", reading::prepare),
    ("tests", tests::prepare),
    ("files", files::prepare),
    ("sequence", sequence::prepare),
    ("timeline", timeline::prepare),
    ("layers", layers::prepare),
    ("graph", graph::prepare),
    ("state", state::prepare),
    ("er", er::prepare),
    ("image", image::prepare),
    ("svg", svg::prepare),
    ("mermaid", mermaid::prepare),
    ("map", map::prepare),
];

/// Prepares any scene: its type's own view, or a placeholder naming the type (and the problem, if any).
pub fn prepare(input: &SceneInput) -> Box<dyn SceneView> {
    let ty = input.scene.get("type").and_then(Value::as_str).unwrap_or("?");
    match REGISTRY.iter().find(|(t, _)| *t == ty) {
        Some((_, prepare)) => prepare(input).unwrap_or_else(|e| placeholder::view(input, Some(e))),
        None => placeholder::view(input, None),
    }
}

/// Deserializes a scene's own fields, naming the scene in the error.
pub fn parse<T: serde::de::DeserializeOwned>(input: &SceneInput) -> Result<T, String> {
    serde_json::from_value(input.scene.clone()).map_err(|e| format!("scene {}: {e}", input.index + 1))
}
