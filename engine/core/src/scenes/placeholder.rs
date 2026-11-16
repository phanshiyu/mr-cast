//! A card naming a scene type the engine does not draw yet.

use super::{Frame, SceneInput, SceneView};
use crate::chrome::shell::Shell;
use crate::display::{BoxStyle, DisplayList};
use crate::text::Style;
use crate::theme::{BORDER, MUTED, SURFACE, TEXT};

struct Placeholder {
    shell: Shell,
    label: String,
    note: String,
}

pub fn view(input: &SceneInput, problem: Option<String>) -> Box<dyn SceneView> {
    let ty = input.scene.get("type").and_then(|t| t.as_str()).unwrap_or("?");
    Box::new(Placeholder {
        shell: Shell::new(input.scene),
        label: format!("{ty} scene"),
        note: problem.unwrap_or_else(|| "not drawn by the Rust engine yet".into()),
    })
}

impl SceneView for Placeholder {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        self.shell.draw(dl, f.frame, f.duration, None, |dl, bx| {
            dl.rect(0.0, 0.0, bx.w, bx.h, BoxStyle::fill(SURFACE).radius(22.0).border(BORDER, 1.0));
            let title = Style::sans(700.0, 56.0);
            let w = crate::text::width(&self.label, title);
            dl.text(&self.label, title, (bx.w - w) / 2.0, bx.h / 2.0, TEXT);
            let small = Style::sans(500.0, 26.0);
            let w = crate::text::width(&self.note, small);
            dl.text(&self.note, small, (bx.w - w) / 2.0, bx.h / 2.0 + 56.0, MUTED);
        });
    }
}
