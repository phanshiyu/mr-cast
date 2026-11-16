//! mr-cast-engine: renders the props the Node CLI writes to a video or a still.
//!
//!   mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--encoder h264|none] [--qp n]
//!   mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]
//!   mr-cast-engine still --props props.json --scenes 1,3..5 [--step k] --out-dir dir
//!   mr-cast-engine sheet --props props.json --tiles tiles.json --out sheet.png
//!   mr-cast-engine voice --model-dir dir --job job.json   (voice.rs: speaks clips with tiny-voca)
//!
//! Frames render and encode in parallel, one run of frames per core, into an MP4 written here (encode.rs).

mod aac;
mod audio;
mod encode;
mod h264;
mod mp4;
mod sheet;
mod voice;

use mrc_core::model::{Picture, Props};
use mrc_core::{Project, render_frame, timing};
use rayon::prelude::*;
use std::collections::HashMap;
use std::process::ExitCode;
use std::time::Instant;

fn usage() -> ExitCode {
    eprintln!(
        "usage:
  mr-cast-engine render --props props.json --out file.mp4 [--media-dir run] [--frames a..b] [--scenes a..b]
                        [--encoder h264|none] [--qp n] [--cfr yes] [--skip-repeats no] [--scale s] [--progress yes]
  mr-cast-engine still --props props.json (--frame N | --scene N) [--step k] --out file.png [--scale s]
  mr-cast-engine still --props props.json --scenes 1,2,5..7 [--step k] --out-dir dir
  mr-cast-engine sheet --props props.json --tiles tiles.json --out sheet.png
  mr-cast-engine voice --model-dir dir --job job.json"
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

/// The chapters, in milliseconds as the MP4 stores them.
fn chapters(p: &Project) -> Vec<mp4::Chapter> {
    let ms = |frames: f64| (frames / timing::FPS * 1000.0).round() as u64;
    p.chapters().into_iter().map(|c| mp4::Chapter { start_ms: ms(c.from), end_ms: ms(c.to), title: c.title }).collect()
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
    let encode = match f.get("encoder").map_or("h264", String::as_str) {
        "h264" => true,
        "none" => false,
        other => return Err(format!("unknown encoder {other}; use h264 or none")),
    };
    let out = f.get("out").map_or("out.mp4", String::as_str);
    let cfr = f.get("cfr").is_some_and(|v| v == "yes");
    let progress = f.get("progress").is_some_and(|v| v == "yes");
    // The voice-over mixes and the chapters are named before the frames render; a part of the video has none.
    let mut extras = encode::Extras::default();
    if let Some(dir) = f.get("media-dir")
        && encode
    {
        extras.voice = audio::track(&p, &frames, std::path::Path::new(dir))?;
    }
    if frames.len() == total as usize {
        extras.chapters = chapters(&p);
    }
    let (w_px, h_px) = mrc_core::frame_size(scale);
    let mut settings = encode.then(|| h264::Settings::new(w_px, h_px));
    if let (Some(s), Some(qp)) = (settings.as_mut(), f.get("qp")) {
        s.qp = qp.parse().ok().filter(|q| (10..=51).contains(q)).ok_or("--qp is a number from 10 to 51")?;
    }
    // A frame whose display list matches the frame before draws the same pixels, so it is neither drawn nor
    // encoded again: most frames of a scene that has settled, between caption words, are such repeats.
    let skip = f.get("skip-repeats").is_none_or(|v| v != "no");
    let prints: Vec<u64> = if skip {
        frames.par_iter().map(|&n| mrc_core::build_frame(&p, n).fingerprint()).collect()
    } else {
        (0..frames.len() as u64).collect()
    };
    let keys = encode::keys(&frames, &prints, cfr);
    let prepared = start.elapsed();
    thread_local! {
        static WORK: std::cell::RefCell<Option<(mrc_core::FrameRenderer, mrc_core::Pixmap)>> = const { std::cell::RefCell::new(None) };
    }
    let draw = |n: u32, buf: &mut Vec<u8>| {
        let dl = mrc_core::build_frame(&p, n);
        WORK.with(|w| {
            let mut w = w.borrow_mut();
            let (r, pix) = w.get_or_insert_with(|| {
                (mrc_core::FrameRenderer::default(), mrc_core::Pixmap::new(w_px, h_px).unwrap())
            });
            mrc_core::render_list_into(&dl, scale, r, pix);
            encode::yuv420(pix, buf);
        });
    };
    let count = frames.len() as u64;
    let report = |done: u64| {
        if progress {
            // The Node CLI reads these lines for its progress bar.
            eprintln!("progress {}/{count}", done.min(count));
        }
    };
    encode::encode(&keys, settings, &draw, extras, out, &report)?;
    let fresh = keys.iter().filter(|k| k.fresh).count();
    eprintln!("{} frames repeat the one before and were not drawn again", frames.len() - fresh);
    let wall = start.elapsed().as_secs_f64();
    eprintln!(
        "{} frames in {:.2} s ({:.1} frames/s), {} samples, prepared in {:.0} ms",
        frames.len(),
        wall,
        frames.len() as f64 / wall,
        keys.len(),
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

/// Times one encoder on the frames of --frames that change, after rendering them all.
fn bench_encode(f: &HashMap<String, String>) -> Result<(), String> {
    let p = load(f)?;
    let frames: Vec<u32> = range(f.get("frames").map_or("0..300", String::as_str), p.frame_count())?.collect();
    let prints: Vec<u64> = frames.par_iter().map(|&n| mrc_core::build_frame(&p, n).fingerprint()).collect();
    let keys = encode::keys(&frames, &prints, false);
    let yuv: Vec<Vec<u8>> = keys
        .par_iter()
        .map(|k| {
            let mut buf = Vec::new();
            encode::yuv420(&render_frame(&p, k.frame, 1.0), &mut buf);
            buf
        })
        .collect();
    let s = h264::Settings::new(1920, 1080);
    for _ in 0..f.get("repeat").map_or(1, |r| r.parse().unwrap()) {
        let t = Instant::now();
        let mut enc = h264::Encoder::new(s)?;
        let mut bytes = 0;
        for (k, y) in keys.iter().zip(&yuv) {
            bytes += enc.encode(y, (k.time * 1000 / 30) as i64)?.data.len();
        }
        let secs = t.elapsed().as_secs_f64();
        eprintln!(
            "{s:?}: {} frames in {secs:.2} s, {:.1} frames/s, {bytes} bytes",
            keys.len(),
            keys.len() as f64 / secs
        );
    }
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

/// Describes an MP4 as JSON (its tracks, their samples and edits, and both kinds of chapters), and with --pcm
/// writes its voice-over, as it plays, as 16-bit little-endian samples: for the tests and the smoke check.
fn probe(f: &HashMap<String, String>) -> Result<(), String> {
    let path = f.get("in").ok_or("--in is required")?;
    let file = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let r = mp4::read(&file)?;
    let chapters = |c: &[(u64, String)]| {
        c.iter().map(|(start, title)| serde_json::json!({ "start": start, "title": title })).collect::<Vec<_>>()
    };
    let mut tracks = Vec::new();
    for t in &r.tracks {
        let mut j = serde_json::json!({
            "handler": t.handler,
            "codec": t.codec,
            "timescale": t.timescale,
            "samples": t.samples.len(),
            "duration": t.durations.iter().map(|&d| d as u64).sum::<u64>(),
            "sync": t.sync.as_ref().map_or(t.samples.len(), Vec::len),
            "edit": t.edit,
            "enabled": t.enabled,
        });
        if t.handler == "text" {
            j["chapters"] = chapters(&mp4::text_chapters(&file, t)).into();
        }
        tracks.push(j);
    }
    println!(
        "{}",
        serde_json::json!({ "boxes": r.top, "duration": r.duration_ms, "tracks": tracks, "chapters": chapters(&r.chpl) })
    );
    if let Some(out) = f.get("pcm") {
        let t = r.tracks.iter().find(|t| t.handler == "soun").ok_or("the file has no audio")?;
        let frames: Vec<&[u8]> = t.samples.iter().map(|&(o, n)| &file[o as usize..o as usize + n as usize]).collect();
        let (rate, channels, pcm) = aac::decode(&t.config, &frames)?;
        let (skip, ms) = t.edit.unwrap_or((0, u64::MAX / rate as u64));
        let from = (skip as usize + aac::DECODER_DELAY) * channels as usize;
        let len = (ms * rate as u64 / 1000) as usize * channels as usize;
        let pcm = &pcm[from.min(pcm.len())..(from + len).min(pcm.len())];
        let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_le_bytes()).collect();
        std::fs::write(out, bytes).map_err(|e| format!("{out}: {e}"))?;
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else { return usage() };
    let result = flags(&args[1..]).and_then(|f| match cmd.as_str() {
        "render" => render(&f),
        "still" => still(&f),
        "bench" => bench(&f),
        "bench-encode" => bench_encode(&f),
        "check-repeats" => check_repeats(&f),
        "sheet" => sheet::sheet(&f, &load(&f)?),
        "compare" => compare(&f),
        "probe" => probe(&f),
        "voice" => voice::command(&f),
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
