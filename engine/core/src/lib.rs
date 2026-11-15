//! mr-cast's frame renderer. A [`Project`] is the props the Node CLI writes, with every scene laid out once;
//! [`build_frame`] turns a frame number into a [`display::DisplayList`], and [`render_frame`] rasterizes it.
//! Nothing here touches threads, files or processes, so the crate builds for wasm32-unknown-unknown.

pub mod anim;
pub mod chrome;
pub mod color;
pub mod display;
pub mod icons;
pub mod markup;
pub mod model;
pub mod raster;
pub mod scenes;
pub mod speech;
pub mod steps;
pub mod text;
pub mod textfit;
pub mod theme;
pub mod timing;

use display::DisplayList;
use model::Props;
use raster::Renderer;
use scenes::{Frame, SceneInput, SceneView};
use std::cell::RefCell;
use timing::TimedScene;
pub use tiny_skia::Pixmap;

/// The props with every scene prepared.
pub struct Project {
    pub props: Props,
    pub timeline: Vec<TimedScene>,
    scenes: Vec<Box<dyn SceneView>>,
}

impl Project {
    pub fn new(props: Props) -> Project {
        let timeline = timing::timeline(&props.storyboard.scenes, props.voiceover.as_ref());
        let scenes = timeline
            .iter()
            .map(|t| {
                scenes::prepare(&SceneInput {
                    scene: &props.storyboard.scenes[t.index],
                    index: t.index,
                    props: &props,
                    duration: t.duration,
                    segments: &t.segments,
                })
            })
            .collect();
        Project { props, timeline, scenes }
    }

    pub fn from_json(json: &str) -> Result<Project, String> {
        let props: Props = serde_json::from_str(json).map_err(|e| format!("props: {e}"))?;
        Ok(Project::new(props))
    }

    /// The video's length in frames (at least 1).
    pub fn frame_count(&self) -> u32 {
        (self.timeline.iter().map(|t| t.duration).sum::<f64>() as u32).max(1)
    }

    /// The scene shown at `frame`, and the frame within it.
    pub fn scene_at(&self, frame: u32) -> Option<(usize, f64)> {
        let f = frame as f64;
        self.timeline.iter().find(|t| f >= t.from && f < t.from + t.duration).map(|t| (t.index, f - t.from))
    }
}

/// Everything frame `frame` draws, backdrop excluded (it never changes; see [`render_frame_with`]).
pub fn build_frame(project: &Project, frame: u32) -> DisplayList {
    let mut dl = DisplayList::new();
    if let Some((i, local)) = project.scene_at(frame) {
        let t = &project.timeline[i];
        let f = Frame { frame: local, duration: t.duration, segments: &t.segments };
        project.scenes[i].draw(&f, &mut dl);
        if project.props.show_captions {
            chrome::captions::draw(&mut dl, &t.segments, local, t.duration);
        }
    }
    dl
}

/// A thread's renderer and its cached backdrop.
pub struct FrameRenderer {
    pub renderer: Renderer,
    backdrop: Option<(f32, Pixmap)>,
}

impl Default for FrameRenderer {
    fn default() -> Self {
        FrameRenderer { renderer: Renderer::new(), backdrop: None }
    }
}

impl FrameRenderer {
    fn backdrop(&mut self, scale: f32) -> &Pixmap {
        if self.backdrop.as_ref().is_none_or(|(s, _)| *s != scale) {
            let (w, h) = frame_size(scale);
            let mut p = Pixmap::new(w, h).expect("frame size");
            let mut dl = DisplayList::new();
            chrome::backdrop::draw(&mut dl);
            self.renderer.draw(&dl, &mut p, tiny_skia::Transform::from_scale(scale, scale));
            self.backdrop = Some((scale, p));
        }
        &self.backdrop.as_ref().unwrap().1
    }
}

/// Pixel size of a frame drawn at `scale` (1 is 1920 by 1080).
pub fn frame_size(scale: f32) -> (u32, u32) {
    (((1920.0 * scale).round() as u32).max(1), ((1080.0 * scale).round() as u32).max(1))
}

/// Renders frame `frame` at `scale` with a caller-held renderer; the pixmap is premultiplied RGBA.
pub fn render_frame_with(project: &Project, frame: u32, scale: f32, r: &mut FrameRenderer) -> Pixmap {
    let mut p = r.backdrop(scale).clone();
    let dl = build_frame(project, frame);
    r.renderer.draw(&dl, &mut p, tiny_skia::Transform::from_scale(scale, scale));
    p
}

thread_local! {
    static RENDERER: RefCell<FrameRenderer> = RefCell::new(FrameRenderer::default());
}

/// Renders frame `frame` at `scale` with this thread's renderer.
pub fn render_frame(project: &Project, frame: u32, scale: f32) -> Pixmap {
    RENDERER.with(|r| render_frame_with(project, frame, scale, &mut r.borrow_mut()))
}
