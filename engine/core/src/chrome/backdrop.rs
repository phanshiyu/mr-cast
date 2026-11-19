//! The backdrop behind every scene (the `Backdrop` of src/Walkthrough.tsx).

use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint};
use crate::theme::BG;

pub fn draw(dl: &mut DisplayList) {
    let (w, h) = (1920.0, 1080.0);
    if crate::look::board() {
        // A matte board, a little lighter where the drawing is.
        dl.rect(0.0, 0.0, w, h, BoxStyle::fill(crate::look::BOARD_BG));
        let light = Color::rgba8(255, 250, 235, 0.025);
        dl.rect(
            0.0,
            0.0,
            w,
            h,
            BoxStyle::fill(Paint::Radial {
                center: (w * 0.5, h * 0.45),
                radius: (w * 0.7, h * 0.75),
                stops: vec![(0.0, light), (1.0, light.alpha(0.0))],
            }),
        );
        return;
    }
    dl.rect(0.0, 0.0, w, h, BoxStyle::fill(BG));
    dl.rect(
        0.0,
        0.0,
        w,
        h,
        BoxStyle::fill(Paint::css_linear(
            160.0,
            w,
            h,
            vec![(0.0, Color::css("#0d1018")), (0.55, BG), (1.0, Color::css("#05060a"))],
        )),
    );
    let accent = Color::rgba8(124, 140, 255, 0.16);
    let add = Color::rgba8(61, 220, 151, 0.06);
    dl.rect(
        0.0,
        0.0,
        w,
        h,
        BoxStyle::fill(Paint::Radial {
            center: (w * 1.0, h * 1.1),
            radius: (900.0, 600.0),
            stops: vec![(0.0, add), (0.6, add.alpha(0.0))],
        }),
    );
    dl.rect(
        0.0,
        0.0,
        w,
        h,
        BoxStyle::fill(Paint::Radial {
            center: (w * 0.12, h * -0.1),
            radius: (1200.0, 700.0),
            stops: vec![(0.0, accent), (0.6, accent.alpha(0.0))],
        }),
    );
}
