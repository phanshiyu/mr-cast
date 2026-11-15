//! mr-cast-engine: renders the props the Node CLI writes to a video or a still.
//!
//!   mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--encoder x264|videotoolbox|none]
//!   mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]
//!
//! Frames render in parallel, in order-preserving chunks, and stream to ffmpeg as yuv420p.

mod encode;

use mrc_core::{Project, render_frame, timing};
use rayon::prelude::*;
use std::collections::HashMap;
use std::process::ExitCode;
use std::time::Instant;

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  mr-cast-engine render --props props.json --out file.mp4 [--frames a..b] [--scenes a..b] [--encoder x264|videotoolbox|none] [--scale s]\n  mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out file.png [--scale s]"
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
    let (w, h) = mrc_core::frame_size(scale);
    let encoder = f.get("encoder").map_or("x264", String::as_str);
    let out = f.get("out").map_or("out.mp4", String::as_str);
    let mut sink = encode::Sink::open(encoder, out, w, h)?;
    let prepared = start.elapsed();
    let chunk = rayon::current_num_threads() * 4;
    for part in frames.chunks(chunk) {
        let rendered: Vec<Vec<u8>> = part.par_iter().map(|&n| encode::yuv420(&render_frame(&p, n, scale))).collect();
        for frame in rendered {
            sink.write(frame)?;
        }
    }
    sink.finish()?;
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

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else { return usage() };
    let result = flags(&args[1..]).and_then(|f| match cmd.as_str() {
        "render" => render(&f),
        "still" => still(&f),
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
