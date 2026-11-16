//! Contact sheets: scenes' settled frames in a grid, three to a row, each under a label with its scene number,
//! type and chapter, as the ContactSheet composition (src/components/ContactSheet.tsx) laid them out.

use mrc_core::display::{BoxStyle, DisplayList};
use mrc_core::text::{Face, Style, baseline_in, line_metrics};
use mrc_core::{FrameRenderer, Pixmap, Project, render_frame_with, theme, timing};
use rayon::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

const COLUMNS: usize = 3;
const TILE_W: u32 = 600;
const TILE_H: u32 = 338;
const GAP: u32 = 14;
const LABEL_H: u32 = 40;

/// The sheet's pixel size for `count` tiles.
pub fn sheet_size(count: usize) -> (u32, u32) {
    let rows = count.div_ceil(COLUMNS).max(1) as u32;
    (COLUMNS as u32 * TILE_W + (COLUMNS as u32 + 1) * GAP, rows * (TILE_H + LABEL_H + GAP) + GAP)
}

/// A tile's top left corner.
fn tile_at(i: usize) -> (u32, u32) {
    let (col, row) = ((i % COLUMNS) as u32, (i / COLUMNS) as u32);
    (GAP + col * (TILE_W + GAP), GAP + row * (TILE_H + LABEL_H + GAP))
}

/// `src` at half its size, each pixel the mean of a 2 by 2 block (an odd last row or column averages what it has).
fn halve(src: &Pixmap) -> Pixmap {
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    let (w, h) = (sw.div_ceil(2), sh.div_ceil(2));
    let mut out = Pixmap::new(w as u32, h as u32).expect("tile size");
    let d = src.data();
    let o = out.data_mut();
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0u32; 4];
            let mut n = 0;
            for sy in (2 * y)..(2 * y + 2).min(sh) {
                for sx in (2 * x)..(2 * x + 2).min(sw) {
                    let i = (sy * sw + sx) * 4;
                    for c in 0..4 {
                        sum[c] += d[i + c] as u32;
                    }
                    n += 1;
                }
            }
            let i = (y * w + x) * 4;
            for c in 0..4 {
                o[i + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    out
}

/// Copies `src` into `dst` at (x, y), cut at `dst`'s edges. Both are opaque, so this is a plain copy.
fn blit(dst: &mut Pixmap, src: &Pixmap, x: u32, y: u32) {
    let (dw, dh) = (dst.width() as usize, dst.height() as usize);
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    let (x, y) = (x as usize, y as usize);
    let w = sw.min(dw.saturating_sub(x));
    for row in 0..sh.min(dh.saturating_sub(y)) {
        let s = &src.data()[row * sw * 4..(row * sw + w) * 4];
        dst.data_mut()[((y + row) * dw + x) * 4..((y + row) * dw + x + w) * 4].copy_from_slice(s);
    }
}

/// `--tiles` is a JSON array of `{ "scene": <1-based>, "label": "..." }`; each tile shows its scene's settled frame.
pub fn sheet(f: &HashMap<String, String>, p: &Project) -> Result<(), String> {
    let path = f.get("tiles").ok_or("--tiles is required")?;
    let out = f.get("out").ok_or("--out is required")?;
    let tiles: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?)
        .map_err(|e| format!("{path}: {e}"))?;
    let tiles: Vec<(usize, String)> = tiles
        .iter()
        .map(|t| {
            let n = t.get("scene").and_then(Value::as_u64).ok_or("a tile has no scene")? as usize;
            let label = t.get("label").and_then(Value::as_str).unwrap_or("").to_string();
            Ok((n, label))
        })
        .collect::<Result<_, String>>()?;
    let frames: Vec<u32> = tiles
        .iter()
        .map(|&(n, _)| {
            let t = p.timeline.get(n.wrapping_sub(1)).ok_or(format!("no scene {n}"))?;
            Ok((t.from + timing::settled_frame(t.duration)) as u32)
        })
        .collect::<Result<_, String>>()?;
    // Drawn at twice the tile's size and halved, as the browser shrank 1920-wide stills: thin strokes of small
    // text drawn straight at a third of the size lose their ink.
    let scale = 2.0 * TILE_W as f32 / theme::WIDTH;
    let stills: Vec<Pixmap> =
        frames.par_iter().map(|&n| halve(&render_frame_with(p, n, scale, &mut FrameRenderer::default()))).collect();
    let (w, h) = sheet_size(tiles.len());
    let mut pix = Pixmap::new(w, h).ok_or("sheet size")?;
    let bg = theme::BG;
    pix.fill(tiny_skia::Color::from_rgba(bg.r, bg.g, bg.b, 1.0).ok_or("colour")?);
    let mut dl = DisplayList::new();
    let style = Style::mono(600.0, 22.0);
    let m = line_metrics(Face::Mono, 22.0);
    // The label's line box is centred in its row, as flex `align-items: center` centres it.
    let baseline = ((LABEL_H as f32 - m.normal) / 2.0) + baseline_in(Face::Mono, 22.0, m.normal);
    for (i, ((_, label), still)) in tiles.iter().zip(&stills).enumerate() {
        let (x, y) = tile_at(i);
        // The image is content-box: its 1px border sits outside the 600 by 338 picture.
        blit(&mut pix, still, x + 1, y + LABEL_H + 1);
        let (x, y) = (x as f32, y as f32);
        dl.rect(
            x,
            y + LABEL_H as f32,
            TILE_W as f32 + 2.0,
            TILE_H as f32 + 2.0,
            BoxStyle::empty().border(theme::BORDER_STRONG, 1.0),
        );
        dl.push_clip(x, y, TILE_W as f32, LABEL_H as f32, 0.0);
        dl.text(label, style, x, y + baseline, theme::TEXT);
        dl.pop_clip();
    }
    let mut r = FrameRenderer::default();
    r.renderer.draw(&dl, &mut pix, tiny_skia::Transform::identity());
    pix.save_png(out).map_err(|e| format!("{out}: {e}"))?;
    println!("{out}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halving_averages_blocks() {
        let mut p = Pixmap::new(3, 2).unwrap();
        p.data_mut().copy_from_slice(&[
            0, 0, 0, 255, 100, 100, 100, 255, 50, 50, 50, 255, //
            200, 200, 200, 255, 100, 100, 100, 255, 50, 50, 50, 255,
        ]);
        let h = halve(&p);
        assert_eq!((h.width(), h.height()), (2, 1));
        assert_eq!(h.data(), &[100, 100, 100, 255, 50, 50, 50, 255]);
    }

    #[test]
    fn three_tiles_to_a_row() {
        assert_eq!(sheet_size(1), (1856, 406));
        assert_eq!(sheet_size(12), (1856, 4 * 392 + 14));
        assert_eq!(tile_at(4), (14 + 614, 14 + 392));
    }
}
