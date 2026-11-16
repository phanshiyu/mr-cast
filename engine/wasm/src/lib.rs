//! The browser player's renderer: mrc_core behind wasm-bindgen. The page loads the props once, then asks for
//! frames; a frame that draws what the frame before drew (equal display-list fingerprints, at the same size) is
//! not drawn again, so a settled scene costs almost nothing while it plays.

use mrc_core::{FrameRenderer, Pixmap, Project, build_frame, frame_size, render_list_into};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Player {
    project: Project,
    renderer: FrameRenderer,
    pixmap: Option<Pixmap>,
    /// The fingerprint and scale of what `pixmap` holds.
    drawn: Option<(u64, f32)>,
}

#[wasm_bindgen]
impl Player {
    /// Loads the props, the same JSON the Node CLI hands the engine binary.
    #[wasm_bindgen(constructor)]
    pub fn new(props: &str) -> Result<Player, JsError> {
        let project = Project::from_json(props).map_err(|e| JsError::new(&e))?;
        Ok(Player { project, renderer: FrameRenderer::default(), pixmap: None, drawn: None })
    }

    /// The video's length in frames.
    #[wasm_bindgen(js_name = totalFrames)]
    pub fn total_frames(&self) -> u32 {
        self.project.frame_count()
    }

    /// Each scene's first frame and length, flattened: [from0, duration0, from1, duration1, ...].
    pub fn scenes(&self) -> Vec<f64> {
        self.project.timeline.iter().flat_map(|t| [t.from, t.duration]).collect()
    }

    /// The MP4's chapters as JSON: [{ "title", "from", "to" }] in frames.
    pub fn chapters(&self) -> String {
        let items: Vec<String> = self
            .project
            .chapters()
            .iter()
            .map(|c| format!(r#"{{"title":{},"from":{},"to":{}}}"#, json_string(&c.title), c.from, c.to))
            .collect();
        format!("[{}]", items.join(","))
    }

    /// What frame `frame` draws, as a number: equal fingerprints draw equal pixels.
    pub fn fingerprint(&self, frame: u32) -> u64 {
        build_frame(&self.project, frame).fingerprint()
    }

    /// Draws frame `frame` at `scale` (1 is 1920 by 1080) into the pixel buffer, unless the buffer already holds
    /// the same picture at that size. Returns whether it drew.
    pub fn render(&mut self, frame: u32, scale: f32) -> bool {
        let dl = build_frame(&self.project, frame);
        let key = (dl.fingerprint(), scale);
        if self.drawn == Some(key) {
            return false;
        }
        let (w, h) = frame_size(scale);
        if self.pixmap.as_ref().is_none_or(|p| p.width() != w || p.height() != h) {
            self.pixmap = Pixmap::new(w, h);
        }
        let Some(pix) = self.pixmap.as_mut() else { return false };
        render_list_into(&dl, scale, &mut self.renderer, pix);
        self.drawn = Some(key);
        true
    }

    /// The pixel buffer's width, in pixels.
    pub fn width(&self) -> u32 {
        self.pixmap.as_ref().map_or(0, Pixmap::width)
    }

    /// The pixel buffer's height, in pixels.
    pub fn height(&self) -> u32 {
        self.pixmap.as_ref().map_or(0, Pixmap::height)
    }

    /// Where the RGBA pixels are in the module's memory (premultiplied, but every frame is opaque). A view on
    /// them is valid until the next call into the player.
    #[wasm_bindgen(js_name = pixelsPtr)]
    pub fn pixels_ptr(&self) -> *const u8 {
        self.pixmap.as_ref().map_or(std::ptr::null(), |p| p.data().as_ptr())
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out += "\\\"",
            '\\' => out += "\\\\",
            c if (c as u32) < 0x20 => out += &format!("\\u{:04x}", c as u32),
            c => out.push(c),
        }
    }
    out + "\""
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROPS: &str = r#"{"storyboard":{"scenes":[
        {"type":"text","narration":"One two three.","headline":"A \"quoted\" title","items":["a"],"chapter":"Why"},
        {"type":"text","narration":"Four.","headline":"B","items":["b"]}
    ]},"showCaptions":false}"#;

    #[test]
    fn a_repeat_is_not_drawn_again() {
        let mut p = Player::new(PROPS).unwrap_or_else(|_| panic!("props"));
        assert!(p.total_frames() > 60);
        assert!(p.render(0, 0.25));
        assert_eq!((p.width(), p.height()), (480, 270));
        let settled = p.scenes()[1] as u32 - 40;
        assert!(p.render(settled, 0.25));
        assert!(!p.render(settled + 1, 0.25));
        // A new size always draws.
        assert!(p.render(settled + 1, 0.5));
    }

    #[test]
    fn chapters_are_json() {
        let p = Player::new(PROPS).unwrap_or_else(|_| panic!("props"));
        let c = p.chapters();
        assert!(c.starts_with(r#"[{"title":"Why","from":0,"to":"#), "{c}");
        assert!(c.contains(r#"{"title":"text","from":"#), "{c}");
        assert_eq!(json_string("a\"b\\c\n"), r#""a\"b\\c\u000a""#);
    }
}
