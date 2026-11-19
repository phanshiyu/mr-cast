//! The files scene: the changed files as a tree by directory, or the change's parts as a map of cards. A port of
//! src/components/FileTree.tsx, PartsMap.tsx, FilesTotals.tsx and shared/files.mjs.

mod model;
mod parts;
mod tree;

use super::{Frame, SceneInput, SceneView};
use crate::chrome::callout::header_box;
use crate::chrome::shell::{Aside, Shell};
use crate::display::DisplayList;
use crate::icons;
use crate::marks::geometry::Bx;
use crate::marks::{LayoutBoxes, Pen, Refs, Stage};
use crate::steps::{Emphasis, Spotlight, spotlight_starts};
use crate::text::{Face, Style, line_metrics, width};
use crate::theme::{ACCENT, ADD, DEL, MUTED, content_box};
use crate::timing::build_frames;
use crate::timing::js_round;
use model::{Part, ShownFile, resolve_ref, scene_files, scene_parts};
use serde_json::Value;
use std::collections::HashMap;

struct FilesView {
    shell: Shell,
    files: Vec<ShownFile>,
    body: Body,
    box_h: f64,
    box_w: f64,
    /// The steps that light each item key, when the scene has steps.
    keys: Option<HashMap<String, Vec<usize>>>,
    /// The paths the narration walks, without steps.
    walked: Vec<String>,
    pen: Pen,
}

enum Body {
    Tree(tree::FilesLayout),
    Parts(parts::PartsLayout),
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let has_title = scene.get("title").and_then(Value::as_str).is_some_and(|t| !t.is_empty());
    let (bw, bh) = content_box(has_title);
    let files = scene_files(scene, &input.props.hunks);
    let parts: Option<Vec<Part>> = scene_parts(scene, &files);
    let steps = scene.get("steps").and_then(Value::as_array).filter(|s| !s.is_empty());
    let keys = steps.map(|_| crate::targets::target_steps_with(scene, |r| resolve_ref(&files, parts.as_deref(), r)));
    let strings = |v: Option<&Value>| -> Vec<String> {
        v.and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let (body, walked) = match &parts {
        Some(parts) if !parts.is_empty() || scene.get("parts").is_some_and(Value::is_array) => {
            (Body::Parts(parts::layout_parts(parts, bw, bh)), strings(scene.get("highlight")))
        }
        _ => {
            let empty = serde_json::Map::new();
            let notes = scene.get("notes").and_then(Value::as_object).unwrap_or(&empty);
            let rows = tree::tree_rows(&files, notes);
            let highlight = strings(scene.get("highlight"));
            let walked = if highlight.is_empty() {
                rows.iter()
                    .filter_map(|r| match r {
                        tree::TreeRow::File { file, note: Some(n), .. } if !n.is_empty() => Some(file.path.clone()),
                        _ => None,
                    })
                    .collect()
            } else {
                highlight
            };
            (Body::Tree(tree::layout_files(&rows, bw, bh)), walked)
        }
    };
    let marks = match &body {
        Body::Parts(l) => {
            Stage { left: (bw - l.width).max(0.0) / 2.0, top: (bh - l.height).max(0.0) * 0.3, scale: 1.0 }
                .targets(&parts_boxes(l), (bw, bh))
        }
        Body::Tree(l) => Stage { left: 0.0, top: (bh - l.height * l.scale).max(0.0) * 0.3, scale: l.scale }
            .targets(&files_boxes(l), (bw, bh)),
    };
    let refs = FilesRefs { files: &files, parts: parts.as_deref() };
    let pen = Pen::new(scene, input.segments, &refs, vec![marks], true, header_box(scene));
    Ok(Box::new(FilesView { shell: Shell::new(scene), files, body, box_h: bh, box_w: bw, keys, walked, pen }))
}

/// A step's refs, resolved over the scene's files and parts.
struct FilesRefs<'a> {
    files: &'a [ShownFile],
    parts: Option<&'a [Part]>,
}

impl Refs for FilesRefs<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        resolve_ref(self.files, self.parts, r)
    }
}

/// The box of each file's name, in layout units; a note keeps off every name, count and note (`filesBoxes`).
fn files_boxes(l: &tree::FilesLayout) -> LayoutBoxes {
    let icon_w = js_round(l.font * 0.95) + js_round(l.font * 0.4);
    let mut out = LayoutBoxes::default();
    let mut obstacles = Vec::new();
    for p in &l.rows {
        let left = p.x + l.name_x + p.row.depth() as f64 * l.indent;
        let name =
            Bx::new(left, p.y + 4.0, (icon_w + p.name.width).min(l.name_x + l.name_w - (left - p.x)), l.row_h - 8.0);
        obstacles.push(name);
        let tree::TreeRow::File { file, .. } = &p.row else { continue };
        out.add(format!("f:{}", file.path), name);
        if let Some(cx) = l.counts_x {
            obstacles.push(Bx::new(p.x + cx, p.y, l.note_x - cx - 12.0, l.row_h));
        }
        if let Some(note) = &p.note {
            obstacles.push(Bx::new(p.x + l.note_x, p.y, l.note_w.min(note.width), l.row_h));
        }
    }
    out.obstacles = Some(obstacles);
    out
}

/// The box of each part's card and of each file listed on it; a file not listed is its card (`partsBoxes`).
fn parts_boxes(l: &parts::PartsLayout) -> LayoutBoxes {
    let mut out = LayoutBoxes::default();
    let mut obstacles = Vec::new();
    for card in &l.cards {
        let b = Bx::new(card.x, card.y, card.w, card.h);
        out.add(format!("p:{}", card.part.name), b);
        obstacles.push(b);
        for f in &card.part.files {
            out.add(format!("f:{}", f.path), b);
        }
        for f in &card.files {
            let key = format!("f:{}", f.path);
            let fb = Bx::new(card.x + parts::CARD_PAD, card.y + f.y, card.w - 2.0 * parts::CARD_PAD, parts::FILE_ROW_H);
            match out.boxes.iter_mut().find(|(k, _)| *k == key) {
                Some(slot) => slot.1 = fb,
                None => out.add(key, fb),
            }
        }
    }
    out.obstacles = Some(obstacles);
    out
}

fn brighter(a: Emphasis, b: Emphasis) -> Emphasis {
    Emphasis { opacity: a.opacity.max(b.opacity), bar: a.bar.max(b.bar), glow: a.glow.max(b.glow) }
}

impl FilesView {
    /// The count of files, lines and tests at the header's right end (`FilesTotals`).
    fn totals(&self) -> (f32, impl Fn(&mut DisplayList, f32, f32) + '_) {
        let add: i64 = self.files.iter().map(|f| f.additions.unwrap_or(0)).sum();
        let del: i64 = self.files.iter().map(|f| f.deletions.unwrap_or(0)).sum();
        let mut seen: Vec<&str> = Vec::new();
        let mut unique: Vec<&ShownFile> = Vec::new();
        for f in &self.files {
            if !seen.contains(&f.path.as_str()) {
                seen.push(&f.path);
                unique.push(f);
            }
        }
        let tests = unique.iter().filter(|f| f.test).count();
        let counted = self.files.iter().any(|f| f.additions.is_some() || f.deletions.is_some());
        let sans = Style::sans(400.0, 21.0);
        let mono = Style::mono(700.0, 21.0);
        let (ls, lm) = (line_metrics(Face::Sans, 21.0), line_metrics(Face::Mono, 21.0));
        // The tests item is a flex box whose baseline is its icon's bottom edge, so it can sit above the others'.
        let flask_ascent = if tests > 0 { (ls.normal - 20.0).max(0.0) / 2.0 + 20.0 } else { 0.0 };
        let flask_descent = if tests > 0 { (ls.normal - flask_ascent).max(0.0) } else { 0.0 };
        let ascent = ls.ascent.max(lm.ascent).max(flask_ascent);
        let descent = ls.descent.max(lm.descent).max(flask_descent);
        let height = ascent + descent + 6.0;
        let files_text = format!("{} {}", unique.len(), if unique.len() == 1 { "file" } else { "files" });
        let plus = format!("+{add}");
        let minus = format!("\u{2212}{del}");
        let tests_text = format!("{tests} {}", if tests == 1 { "test" } else { "tests" });
        let draw = move |dl: &mut DisplayList, right: f32, top: f32| {
            let mut w = width(&files_text, sans);
            if counted {
                w += 22.0 + width(&plus, mono) + width(" ", mono) + width(&minus, mono);
            }
            if tests > 0 {
                w += 22.0 + 20.0 + 6.0 + width(&tests_text, sans);
            }
            let base = top + ascent;
            let mut x = right - w;
            x += dl.text(&files_text, sans, x, base, MUTED);
            if counted {
                x += 22.0;
                x += dl.text(&plus, mono, x, base, ADD);
                x += width(" ", mono);
                x += dl.text(&minus, mono, x, base, DEL);
            }
            if tests > 0 {
                x += 22.0;
                icons::draw(dl, "FlaskConical", x, base - flask_ascent, 20.0, ACCENT, 2.2);
                dl.text(&tests_text, sans, x + 20.0 + 6.0, base - flask_ascent + ls.ascent, ACCENT);
            }
        };
        (height, draw)
    }
}

impl SceneView for FilesView {
    fn pencil_spans(&self) -> Vec<crate::chrome::pencil::Span> {
        let b = self.shell.content(0.0);
        self.pen.frame_spans((b.x, b.y))
    }

    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let step_starts: Vec<f64> = f.segments.iter().skip(1).map(|s| s.from).collect();
        let focus = Spotlight::new(frame, &step_starts);
        let walk_starts = spotlight_starts(f.segments, self.walked.len(), build_frames("files"));
        let walk = Spotlight::new(frame, &walk_starts);
        let by_key = |key: &str| -> Emphasis {
            focus.emphasis(self.keys.as_ref().and_then(|k| k.get(key)).map_or(&[][..], |v| v.as_slice()))
        };
        let walked_at = |path: &str| -> Vec<usize> { self.walked.iter().position(|p| p == path).into_iter().collect() };
        let (aside_h, aside_draw) = self.totals();
        let aside = Aside { height: aside_h, draw: &aside_draw };
        self.shell.draw(dl, frame, f.duration, Some(aside), |dl, _bx| {
            self.pen.draw(dl, frame, f.segments, |dl| match &self.body {
                Body::Tree(l) => {
                    let top = (self.box_h - l.height * l.scale).max(0.0) * 0.3;
                    dl.translate(0.0, top as f32);
                    dl.scale_about(l.scale as f32, 0.0, 0.0);
                    let n = l.rows.len();
                    let stagger = 4f64.min((tree::ROWS_END - tree::START - 4.0) / (n as f64 - 1.0).max(1.0));
                    for (i, placed) in l.rows.iter().enumerate() {
                        let path = match &placed.row {
                            tree::TreeRow::File { file, .. } => Some(file.path.as_str()),
                            tree::TreeRow::Dir { .. } => None,
                        };
                        let e = if self.keys.is_some() {
                            by_key(&format!("f:{}", path.unwrap_or("null")))
                        } else {
                            walk.emphasis(&path.map(walked_at).unwrap_or_default())
                        };
                        // Directories stay readable while files are spotlit: they are the map, not the subject.
                        let e = if path.is_none() { Emphasis { opacity: e.opacity.max(0.7), ..e } } else { e };
                        let ctx =
                            tree::RowCtx { layout: l, at: tree::START + 4.0 + i as f64 * stagger, emphasis: e, frame };
                        tree::draw_row(dl, placed, &ctx);
                    }
                }
                Body::Parts(l) => {
                    let left = (self.box_w - l.width).max(0.0) / 2.0;
                    let top = (self.box_h - l.height).max(0.0) * 0.3;
                    dl.translate(left as f32, top as f32);
                    let emphases: Vec<Emphasis> = l
                        .cards
                        .iter()
                        .map(|card| {
                            if self.keys.is_some() {
                                card.part.files.iter().fold(by_key(&format!("p:{}", card.part.name)), |e, f| {
                                    brighter(e, by_key(&format!("f:{}", f.path)))
                                })
                            } else {
                                let steps: Vec<usize> =
                                    card.part.files.iter().flat_map(|f| walked_at(&f.path)).collect();
                                walk.emphasis(&steps)
                            }
                        })
                        .collect();
                    let link_in = parts::link_in(frame);
                    for link in &l.links {
                        let (a, b) = (emphases[link.from], emphases[link.to]);
                        let dim = a.opacity.min(b.opacity) as f32;
                        parts::draw_link(dl, link, link_in * dim * 0.85, a.glow.max(b.glow) > 0.5);
                    }
                    let stagger = 5f64.min(12.0 / (l.cards.len() as f64 - 1.0).max(1.0));
                    for (i, card) in l.cards.iter().enumerate() {
                        parts::draw_card(dl, card, parts::land_of(frame, i, stagger), emphases[i]);
                    }
                }
            })
        });
    }
}
