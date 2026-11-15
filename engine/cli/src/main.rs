//! mr-cast-engine: renders the props the Node CLI writes to a video or a still.
//!
//!   mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--encoder x264|videotoolbox|none]
//!   mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]
//!   mr-cast-engine still --props props.json --scenes 1,3..5 [--step k] --out-dir dir
//!   mr-cast-engine sheet --props props.json --tiles tiles.json --out sheet.png
//!
//! Frames render in parallel, in order-preserving chunks, and stream to ffmpeg as yuv420p.

mod audio;
mod encode;
mod mkv;
mod sheet;

use mrc_core::{Project, render_frame, timing};
use rayon::prelude::*;
use std::collections::HashMap;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Instant;

fn usage() -> ExitCode {
    eprintln!(
        "usage:
  mr-cast-engine render --props props.json --out file.mp4 [--media-dir run] [--frames a..b] [--scenes a..b]
                        [--encoder x264|videotoolbox|none] [--cfr yes] [--skip-repeats no] [--scale s] [--progress yes]
  mr-cast-engine still --props props.json (--frame N | --scene N) [--step k] --out file.png [--scale s]
  mr-cast-engine still --props props.json --scenes 1,2,5..7 [--step k] --out-dir dir
  mr-cast-engine sheet --props props.json --tiles tiles.json --out sheet.png"
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
    Project::from_json(&json)
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

/// A still's file name, as `mr-cast still` has always written it: scene-03-code.png, scene-03-code-step-1.png.
fn still_name(p: &Project, n: usize, step: Option<usize>) -> String {
    let ty = p.props.storyboard.scenes[n - 1].get("type").and_then(|t| t.as_str()).unwrap_or("scene");
    let step = step.map_or(String::new(), |k| format!("-step-{k}"));
    format!("scene-{n:02}-{ty}{step}.png")
}

/// Scene numbers (1-based), comma separated, each a number or a range a..b (end excluded).
fn scene_list(list: &str, count: usize) -> Result<Vec<usize>, String> {
    let mut out = Vec::new();
    for part in list.split(',') {
        if part.contains("..") {
            out.extend(range(part, count as u32 + 1)?.map(|n| n as usize));
        } else {
            out.push(part.parse().map_err(|_| format!("bad scene {part}"))?);
        }
    }
    Ok(out)
}

fn still(f: &HashMap<String, String>) -> Result<(), String> {
    let p = load(f)?;
    let step: Option<usize> = f.get("step").map(|s| s.parse()).transpose().map_err(|_| "bad --step")?;
    let scale: f32 = f.get("scale").map_or(Ok(1.0), |s| s.parse()).map_err(|_| "bad --scale")?;
    if let Some(list) = f.get("scenes") {
        // Many stills at once, in parallel, each printed as it is written.
        let dir = std::path::Path::new(f.get("out-dir").ok_or("--out-dir is required with --scenes")?);
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let scenes = scene_list(list, p.timeline.len())?;
        let jobs: Vec<(u32, std::path::PathBuf)> = scenes
            .iter()
            .map(|&n| Ok((still_frame(&p, n, step)?, dir.join(still_name(&p, n, step)))))
            .collect::<Result<_, String>>()?;
        jobs.par_iter().try_for_each(|(frame, out)| {
            render_frame(&p, *frame, scale).save_png(out).map_err(|e| format!("{}: {e}", out.display()))
        })?;
        for (_, out) in &jobs {
            println!("{}", out.display());
        }
        return Ok(());
    }
    let frame = match (f.get("frame"), f.get("scene")) {
        (Some(n), _) => n.parse().map_err(|_| "bad --frame")?,
        (None, Some(n)) => still_frame(&p, n.parse().map_err(|_| "bad --scene")?, step)?,
        _ => return Err("--frame, --scene or --scenes is required".into()),
    };
    let out = f.get("out").ok_or("--out is required")?;
    let t = Instant::now();
    let pix = render_frame(&p, frame, scale);
    eprintln!("frame {frame} in {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
    pix.save_png(out).map_err(|e| format!("{out}: {e}"))
}

/// The chapters as an FFMETADATA file, in milliseconds as the MP4 stores them.
fn chapter_metadata(p: &Project) -> String {
    let escape = |s: &str| {
        s.chars()
            .flat_map(|c| match c {
                '=' | ';' | '#' | '\\' | '\n' => vec!['\\', c],
                c => vec![c],
            })
            .collect::<String>()
    };
    let ms = |frames: f64| (frames / timing::FPS * 1000.0).round() as u64;
    let mut out = String::from(";FFMETADATA1\n");
    for c in p.chapters() {
        out += &format!(
            "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={}\n",
            ms(c.from),
            ms(c.to),
            escape(&c.title)
        );
    }
    out
}

fn render(f: &HashMap<String, String>) -> Result<(), String> {
    let start = Instant::now();
    let p = load(f)?;
    let total = p.frame_count();
    let mut frames: Vec<u32> = match (f.get("frames"), f.get("scenes")) {
        (Some(r), _) => range(r, total)?.collect(),
        (None, Some(list)) => {
            let mut out = Vec::new();
            for n in scene_list(list, p.timeline.len())? {
                if let Some(t) = p.timeline.get(n.wrapping_sub(1)) {
                    out.extend(t.from as u32..(t.from + t.duration) as u32);
                }
            }
            out
        }
        _ => (0..total).collect(),
    };
    frames.sort_unstable();
    frames.dedup();
    if frames.is_empty() {
        return Err("no frames to render".into());
    }
    let scale: f32 = f.get("scale").map_or(Ok(1.0), |s| s.parse()).map_err(|_| "bad --scale")?;
    let encoder = f.get("encoder").map_or("x264", String::as_str);
    let out = f.get("out").map_or("out.mp4", String::as_str);
    let cfr = f.get("cfr").is_some_and(|v| v == "yes");
    let progress = f.get("progress").is_some_and(|v| v == "yes");
    // The voice-over and the chapters go into the same encode, through files beside the video.
    let mut extras = encode::Extras::default();
    let mut temp = Vec::new();
    if let Some(dir) = f.get("media-dir")
        && encoder != "none"
    {
        extras.voice = audio::track(&p, &frames, std::path::Path::new(dir))?;
    }
    if frames.len() == total as usize && encoder != "none" {
        let meta = std::path::PathBuf::from(format!("{out}.chapters.txt"));
        std::fs::write(&meta, chapter_metadata(&p)).map_err(|e| format!("{}: {e}", meta.display()))?;
        extras.chapters = Some(meta.clone());
        temp.push(meta);
    }
    let result = render_frames(&p, &frames, scale, encoder, out, cfr, progress, f, extras, start);
    remove(&temp);
    result
}

fn remove(files: &[std::path::PathBuf]) {
    for f in files {
        let _ = std::fs::remove_file(f);
    }
}

#[allow(clippy::too_many_arguments)]
fn render_frames(
    p: &Project,
    frames: &[u32],
    scale: f32,
    encoder: &str,
    out: &str,
    cfr: bool,
    progress: bool,
    f: &HashMap<String, String>,
    extras: encode::Extras,
    start: Instant,
) -> Result<(), String> {
    let (w_px, h_px) = mrc_core::frame_size(scale);
    let mut sink = encode::Sink::open(encoder, out, w_px, h_px, !cfr, extras)?;
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
    let mut done = 0usize;
    for part in frames.chunks(chunk) {
        let lists: Vec<(mrc_core::display::DisplayList, u64)> = part
            .par_iter()
            .map(|&n| {
                let dl = mrc_core::build_frame(p, n);
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
        done += part.len();
        if progress {
            // The Node CLI reads these lines for its progress bar.
            eprintln!("progress {done}/{}", frames.len());
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
        "sheet" => sheet::sheet(&f, &load(&f)?),
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
