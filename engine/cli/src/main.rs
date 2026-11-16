//! mr-cast-engine: renders the props the Node CLI writes to a video or a still.
//!
//!   mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--encoder x264|videotoolbox|none]
//!   mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]
//!
//! Frames render in parallel, in order-preserving chunks, and stream to ffmpeg as yuv420p.

mod encode;
mod mkv;

use mrc_core::model::{Picture, Props};
use mrc_core::{Project, render_frame, timing};
use rayon::prelude::*;
use std::collections::HashMap;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Instant;

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--scenes a..b] [--encoder x264|videotoolbox|none] [--cfr yes] [--skip-repeats no] [--scale s]\n  mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]"
    );
    ExitCode::from(2)
}

fn flags(args: &[String]) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let key = a.strip_prefix("--").ok_or_else(|| format!("unexpected argument {a}"))?;
        let value = it.next().ok_or_else(|| format!("--{key} needs a value"))?;
        out.insert(key.to_string(), value.clone());
    }
    Ok(out)
}

fn range(s: &str, max: u32) -> Result<std::ops::Range<u32>, String> {
    let (a, b) = s.split_once("..").ok_or_else(|| format!("{s} is not a range a..b"))?;
    let a: u32 = if a.is_empty() { 0 } else { a.parse().map_err(|_| format!("bad start in {s}"))? };
    let b: u32 = if b.is_empty() { max } else { b.parse().map_err(|_| format!("bad end in {s}"))? };
    Ok(a.min(max)..b.min(max))
}

fn load(f: &HashMap<String, String>) -> Result<Project, String> {
    let path = f.get("props").ok_or("--props is required")?;
    let json = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let mut props: Props = serde_json::from_str(&json).map_err(|e| format!("props: {e}"))?;
    let dir = std::path::Path::new(path).parent().map(|d| d.to_path_buf()).unwrap_or_default();
    for (src, entry) in props.images.clone() {
        match decode_picture(&dir.join(&entry.file)) {
            Ok(p) => {
                props.pictures.insert(src, p);
            }
            Err(e) => eprintln!("image {src}: {e}"),
        }
    }
    Ok(Project::new(props))
}

/// Decodes an image file of the run (PNG, JPEG, WebP or GIF), turned upright by its EXIF orientation.
fn decode_picture(file: &std::path::Path) -> Result<Picture, String> {
    use image::{ImageDecoder, ImageReader};
    let mut decoder = ImageReader::open(file)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut img = image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    let rgba = img.to_rgba8();
    Picture::from_rgba8(rgba.width(), rgba.height(), rgba.as_raw()).ok_or_else(|| "empty image".to_string())
}

/// The frame `mr-cast still` shows for scene `n` (1-based): its settled end, or the end of step `step`.
fn still_frame(p: &Project, n: usize, step: Option<usize>) -> Result<u32, String> {
    let t = p.timeline.get(n.wrapping_sub(1)).ok_or(format!("no scene {n}"))?;
    let settled = timing::settled_frame(t.duration);
    let local = match step {
        None => settled,
        Some(k) => {
            let s = t.segments.get(k + 1).ok_or(format!("scene {n} has no step {k}"))?;
            (s.from + s.duration - 2.0).min(settled)
        }
    };
    Ok((t.from + local) as u32)
}

fn still(f: &HashMap<String, String>) -> Result<(), String> {
    let p = load(f)?;
    let frame = match (f.get("frame"), f.get("scene")) {
        (Some(n), _) => n.parse().map_err(|_| "bad --frame")?,
        (None, Some(n)) => still_frame(
            &p,
            n.parse().map_err(|_| "bad --scene")?,
            f.get("step").map(|s| s.parse()).transpose().map_err(|_| "bad --step")?,
        )?,
        _ => return Err("--frame or --scene is required".into()),
    };
    let scale: f32 = f.get("scale").map_or(Ok(1.0), |s| s.parse()).map_err(|_| "bad --scale")?;
    let out = f.get("out").ok_or("--out is required")?;
    let t = Instant::now();
    let pix = render_frame(&p, frame, scale);
    eprintln!("frame {frame} in {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
    pix.save_png(out).map_err(|e| format!("{out}: {e}"))
}

fn render(f: &HashMap<String, String>) -> Result<(), String> {
    let start = Instant::now();
    let p = load(f)?;
    let total = p.frame_count();
    let mut frames: Vec<u32> = match (f.get("frames"), f.get("scenes")) {
        (Some(r), _) => range(r, total)?.collect(),
        (None, Some(list)) => {
            // Scenes by 1-based index, comma separated, each a number or a range a..b.
            let mut out = Vec::new();
            for part in list.split(',') {
                let r = if part.contains("..") {
                    range(part, p.timeline.len() as u32 + 1)?
                } else {
                    let n: u32 = part.parse().map_err(|_| "bad --scenes")?;
                    n..n + 1
                };
                for n in r {
                    if let Some(t) = p.timeline.get((n as usize).wrapping_sub(1)) {
                        out.extend(t.from as u32..(t.from + t.duration) as u32);
                    }
                }
            }
            out
        }
        _ => (0..total).collect(),
    };
    frames.dedup();
    let scale: f32 = f.get("scale").map_or(Ok(1.0), |s| s.parse()).map_err(|_| "bad --scale")?;
    let (w_px, h_px) = mrc_core::frame_size(scale);
    let encoder = f.get("encoder").map_or("x264", String::as_str);
    let out = f.get("out").map_or("out.mp4", String::as_str);
    let cfr = f.get("cfr").is_some_and(|v| v == "yes");
    let mut sink = encode::Sink::open(encoder, out, w_px, h_px, !cfr)?;
    let prepared = start.elapsed();
    let chunk = rayon::current_num_threads() * 8;
    thread_local! {
        static WORK: std::cell::RefCell<Option<(mrc_core::FrameRenderer, mrc_core::Pixmap)>> = const { std::cell::RefCell::new(None) };
    }
    // A frame whose display list matches the frame before draws the same pixels, so it reuses them: most frames
    // of a scene that has settled, between caption words, are such repeats.
    let skip = f.get("skip-repeats").is_none_or(|v| v != "no");
    let mut last: Option<(u64, Arc<Vec<u8>>)> = None;
    let mut repeats = 0usize;
    for part in frames.chunks(chunk) {
        let lists: Vec<(mrc_core::display::DisplayList, u64)> = part
            .par_iter()
            .map(|&n| {
                let dl = mrc_core::build_frame(&p, n);
                let h = dl.fingerprint();
                (dl, h)
            })
            .collect();
        let fresh: Vec<bool> = (0..lists.len())
            .map(|i| {
                let prev = if i == 0 { last.as_ref().map(|l| l.0) } else { Some(lists[i - 1].1) };
                !skip || prev != Some(lists[i].1)
            })
            .collect();
        let rendered: Vec<Option<Arc<Vec<u8>>>> = lists
            .par_iter()
            .zip(&fresh)
            .map(|((dl, _), &fresh)| {
                if !fresh {
                    return None;
                }
                let mut buf = sink.pool.lock().unwrap().pop().unwrap_or_default();
                WORK.with(|w| {
                    let mut w = w.borrow_mut();
                    let (r, pix) = w.get_or_insert_with(|| {
                        (mrc_core::FrameRenderer::default(), mrc_core::Pixmap::new(w_px, h_px).unwrap())
                    });
                    mrc_core::render_list_into(dl, scale, r, pix);
                    encode::yuv420(pix, &mut buf);
                });
                Some(Arc::new(buf))
            })
            .collect();
        for ((frame, (_, h)), &n) in rendered.into_iter().zip(&lists).zip(part) {
            let fresh = frame.is_some();
            let frame = match frame {
                Some(f) => f,
                None => {
                    repeats += 1;
                    last.as_ref().expect("a repeat follows a frame").1.clone()
                }
            };
            last = Some((*h, frame.clone()));
            // With timestamps a repeat is left out, but the last frame is always sent so the video ends on time.
            if fresh || !sink.vfr || Some(&n) == frames.last() {
                sink.write((n - frames[0]) as u64, frame)?;
            }
        }
    }
    drop(last);
    sink.finish()?;
    eprintln!("{repeats} frames repeat the one before and were not drawn again");
    let wall = start.elapsed().as_secs_f64();
    eprintln!(
        "{} frames in {:.2} s ({:.1} frames/s), prepared in {:.0} ms, encoder {encoder}",
        frames.len(),
        wall,
        frames.len() as f64 / wall,
        prepared.as_secs_f64() * 1000.0
    );
    Ok(())
}

/// Times one thread's work per frame, part by part: building the display list, rasterizing, converting to yuv.
fn bench(f: &HashMap<String, String>) -> Result<(), String> {
    let p = load(f)?;
    let total = p.frame_count();
    let frames: Vec<u32> = range(f.get("frames").map_or("..", String::as_str), total)?
        .step_by(f.get("every").map_or(Ok(10), |s| s.parse()).map_err(|_| "bad --every")?)
        .collect();
    let mut r = mrc_core::FrameRenderer::default();
    let (pw, ph) = mrc_core::frame_size(1.0);
    let mut pix = mrc_core::Pixmap::new(pw, ph).unwrap();
    let mut buf = Vec::new();
    r.renderer.profile = Some(HashMap::new());
    let (mut build, mut raster, mut yuv) = (0.0, 0.0, 0.0);
    for &n in &frames {
        let t = Instant::now();
        let dl = mrc_core::build_frame(&p, n);
        build += t.elapsed().as_secs_f64();
        let t = Instant::now();
        mrc_core::render_list_into(&dl, 1.0, &mut r, &mut pix);
        raster += t.elapsed().as_secs_f64();
        let t = Instant::now();
        encode::yuv420(&pix, &mut buf);
        yuv += t.elapsed().as_secs_f64();
    }
    let k = 1000.0 / frames.len() as f64;
    let mut kinds: Vec<_> = r.renderer.profile.take().unwrap().into_iter().collect();
    kinds.sort_by(|a, b| b.1.total_cmp(&a.1));
    eprintln!("{}", kinds.iter().map(|(n, t)| format!("{n} {:.2} ms", t * k)).collect::<Vec<_>>().join(", "));
    eprintln!(
        "{} frames, per frame on one thread: build {:.2} ms, raster {:.2} ms, yuv {:.2} ms",
        frames.len(),
        build * k,
        raster * k,
        yuv * k
    );
    Ok(())
}

/// Checks that frames the renderer would skip as repeats do draw the same pixels as the frame before.
fn check_repeats(f: &HashMap<String, String>) -> Result<(), String> {
    let p = load(f)?;
    let frames: Vec<u32> = range(f.get("frames").map_or("..", String::as_str), p.frame_count())?.collect();
    let bad: Vec<u32> = frames
        .par_windows(2)
        .filter_map(|w| {
            let (a, b) = (mrc_core::build_frame(&p, w[0]), mrc_core::build_frame(&p, w[1]));
            if a.fingerprint() != b.fingerprint() {
                return None;
            }
            (render_frame(&p, w[0], 1.0).data() != render_frame(&p, w[1], 1.0).data()).then_some(w[1])
        })
        .collect();
    eprintln!("{} of {} repeats draw different pixels: {:?}", bad.len(), frames.len() - 1, &bad[..bad.len().min(20)]);
    Ok(())
}

/// Compares a Remotion still with the engine's: writes the two stacked (Remotion on top) and their difference
/// (amplified four times, black where equal), and prints the mean absolute difference over the frame and the
/// worst 64-pixel tile with its position, in levels of 255 averaged over red, green and blue.
fn compare(f: &HashMap<String, String>) -> Result<(), String> {
    let load = |key: &str| {
        let path = f.get(key).ok_or(format!("--{key} is required"))?;
        mrc_core::Pixmap::load_png(path).map_err(|e| format!("{path}: {e}"))
    };
    let (a, b) = (load("remotion")?, load("engine")?);
    if (a.width(), a.height()) != (b.width(), b.height()) {
        return Err(format!("sizes differ: {}x{} and {}x{}", a.width(), a.height(), b.width(), b.height()));
    }
    let (w, h) = (a.width() as usize, a.height() as usize);
    let (pa, pb) = (a.data(), b.data());
    let mut diff = mrc_core::Pixmap::new(w as u32, h as u32).unwrap();
    const TILE: usize = 64;
    let (tw, th) = (w.div_ceil(TILE), h.div_ceil(TILE));
    let mut tiles = vec![0u64; tw * th];
    let mut total = 0u64;
    for (i, (x, y)) in pa.as_chunks::<4>().0.iter().zip(pb.as_chunks::<4>().0).enumerate() {
        let d: u32 = (0..3).map(|c| (x[c] as i32 - y[c] as i32).unsigned_abs()).sum();
        total += d as u64;
        tiles[(i / w / TILE) * tw + (i % w) / TILE] += d as u64;
        let o = &mut diff.data_mut()[i * 4..i * 4 + 4];
        for c in 0..3 {
            o[c] = ((x[c] as i32 - y[c] as i32).unsigned_abs() * 4).min(255) as u8;
        }
        o[3] = 255;
    }
    let mean = total as f64 / (w * h * 3) as f64;
    let (worst, value) = tiles.iter().enumerate().max_by_key(|t| *t.1).map(|(i, &v)| (i, v)).unwrap_or((0, 0));
    let (tx, ty) = (worst % tw * TILE, worst / tw * TILE);
    let tile_px = (TILE.min(w - tx) * TILE.min(h - ty) * 3) as f64;
    if let Some(out) = f.get("out-diff") {
        diff.save_png(out).map_err(|e| format!("{out}: {e}"))?;
    }
    if let Some(out) = f.get("out-compare") {
        let mut both = mrc_core::Pixmap::new(w as u32, 2 * h as u32).unwrap();
        both.data_mut()[..pa.len()].copy_from_slice(pa);
        both.data_mut()[pa.len()..].copy_from_slice(pb);
        both.save_png(out).map_err(|e| format!("{out}: {e}"))?;
    }
    println!("{mean:.2} {:.1} {tx},{ty}", value as f64 / tile_px);
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else { return usage() };
    let result = flags(&args[1..]).and_then(|f| match cmd.as_str() {
        "render" => render(&f),
        "still" => still(&f),
        "bench" => bench(&f),
        "check-repeats" => check_repeats(&f),
        "compare" => compare(&f),
        _ => Err(format!("unknown command {cmd}")),
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("mr-cast-engine: {e}");
            ExitCode::FAILURE
        }
    }
}
