//! `mr-cast-engine voice`: speaks clips with tiny-voca (docs/adr/0046-tiny-voca-voice.md).
//!
//!   mr-cast-engine voice --model-dir <dir> --job job.json
//!
//! job.json is `{"clips": [{"text", "voice": "f2" | "m2", "speed", "out": "<file.wav>"}]}`. Each clip is read as
//! tiny-voca's `speak_text` reads a text: a full stop added when it ends without a mark, then sentence by sentence,
//! a sentence too long for one call cut after commas and then between words, a sentence with nothing to say
//! skipped, and the whole clip scaled down when it peaks above 0.99. Its text goes through the dizione port
//! (engine/dizione) and the ONNX model runs in tract, in pure Rust. Clips and their sentences run on every core.
//!
//! Each finished clip is a 16-bit 24 kHz WAV at `out` and a line on stdout:
//! `{"clip": i, "seconds": s, "sentences": [{"words": n, "start": s, "end": s, "times": [s, ...]}]}`. A sentence
//! here is one call of the model: `words` counts the clip text's words it covers (split at white space, as
//! shared/timing.mjs counts them), `start` and `end` are where its phones start and end, and `times` is where each
//! of its words starts, from the model's `durations` (frames of 256 samples per token). `progress <done>/<total>`
//! lines on stderr count clips.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, mpsc};

use dizione::Phonemizer;
use dizione::symbols::is_phone;
use fancy_regex::Regex;
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::json;
use tract_hir::internal::*;
use tract_onnx::model::ParsingContext;
use tract_onnx::pb::{AttributeProto, NodeProto, attribute_proto::AttributeType};

/// The loudest sample a clip keeps, as tiny-voca's `limit_peak`.
const PEAK: f32 = 0.99;
/// A clip with nothing the model can say is this much silence, so it still has a length.
const SILENT_SECONDS: f64 = 0.3;

#[derive(Deserialize)]
struct Config {
    sample_rate: u32,
    hop: usize,
    voices: Vec<String>,
    model: ModelConfig,
}

#[derive(Deserialize)]
struct ModelConfig {
    max_tokens: usize,
    max_frames: usize,
}

/// The phonemizer and the model, loaded once and shared by every thread.
pub struct Voice {
    phonemizer: Phonemizer,
    plan: Arc<TypedRunnableModel>,
    config: Config,
}

/// tract reads an ONNX Cast to int64 as a cast to a symbolic dimension, which CumSum cannot add up; the durations
/// are such a cast. This Cast keeps int64 as int64.
fn cast(_ctx: &ParsingContext, node: &NodeProto) -> TractResult<(Box<dyn InferenceOp>, Vec<String>)> {
    Ok((expand(Cast { to: node.get_attr::<DatumType>("to")? }), vec![]))
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct Cast {
    to: DatumType,
}

impl Expansion for Cast {
    fn name(&self) -> StaticName {
        "Cast".into()
    }

    fn rules<'r, 'p: 'r, 's: 'r>(
        &'s self,
        s: &mut Solver<'r>,
        inputs: &'p [TensorProxy],
        outputs: &'p [TensorProxy],
    ) -> InferenceResult {
        check_input_arity(inputs, 1)?;
        check_output_arity(outputs, 1)?;
        s.equals(&outputs[0].datum_type, self.to.bex())?;
        s.equals(&outputs[0].rank, &inputs[0].rank)?;
        s.equals(&outputs[0].shape, &inputs[0].shape)?;
        Ok(())
    }

    fn wire(&self, prefix: &str, model: &mut TypedModel, inputs: &[OutletId]) -> TractResult<TVec<OutletId>> {
        model.wire_node(prefix, tract_core::ops::cast::cast(self.to), &[inputs[0]])
    }
}

/// Where the model's files are under its directory.
pub fn files(dir: &Path) -> [PathBuf; 2] {
    [dir.join("onnx").join("model.onnx"), dir.join("config.json")]
}

impl Voice {
    pub fn load(dir: &Path) -> Result<Voice, String> {
        let [onnx, config_file] = files(dir);
        let config: Config = serde_json::from_str(
            &std::fs::read_to_string(&config_file).map_err(|e| format!("{}: {e}", config_file.display()))?,
        )
        .map_err(|e| format!("{}: {e}", config_file.display()))?;
        let phonemizer = Phonemizer::load(&dir.join("phonemizer"))?;
        let plan = load_plan(&onnx).map_err(|e| format!("{}: {e:#}", onnx.display()))?;
        Ok(Voice { phonemizer, plan, config })
    }

    pub fn voice_index(&self, name: &str) -> Result<i64, String> {
        self.config
            .voices
            .iter()
            .position(|v| v.eq_ignore_ascii_case(name))
            .map(|i| i as i64)
            .ok_or_else(|| format!("tiny-voca has no voice {name:?}; it has {}", self.config.voices.join(", ")))
    }

    /// One call of the model: the samples and each token's frames.
    fn synthesize(&self, ids: &[u8], stress: &[u8], voice: i64, speed: f32) -> Result<(Vec<f32>, Vec<i64>), String> {
        let n = ids.len();
        let ids: Vec<i64> = ids.iter().map(|&i| i as i64).collect();
        let stress: Vec<i64> = stress.iter().map(|&s| s as i64).collect();
        let run = || -> TractResult<_> {
            let inputs: TVec<TValue> = tvec![
                tensor1(&ids).into_shape(&[1, n])?.into(),
                tensor1(&stress).into_shape(&[1, n])?.into(),
                tensor1(&[voice]).into(),
                tensor1(&[speed]).into(),
                tensor1(&[0f32]).into(),
                tensor1(&[1f32]).into(),
            ];
            let out = self.plan.run(inputs)?;
            let audio = out[0].to_plain_array_view::<f32>()?.iter().copied().collect::<Vec<_>>();
            let durations = out[1].to_plain_array_view::<i64>()?.iter().copied().collect::<Vec<_>>();
            Ok((audio, durations))
        };
        let (audio, durations) = run().map_err(|e| format!("the voice model failed: {e:#}"))?;
        if audio.iter().any(|x| !x.is_finite()) {
            return Err("the voice model produced non-finite audio".into());
        }
        Ok((audio, durations))
    }
}

fn load_plan(path: &Path) -> TractResult<Arc<TypedRunnableModel>> {
    let mut onnx = tract_onnx::onnx();
    onnx.op_register.insert("Cast", cast);
    let mut proto = onnx.proto_model_for_path(path)?;
    // The noise of the source-filter head is drawn from a fixed seed, so a text always sounds the same.
    for node in proto.graph.as_mut().map(|g| g.node.iter_mut()).into_iter().flatten() {
        if node.op_type == "RandomNormalLike" && !node.attribute.iter().any(|a| a.name == "seed") {
            node.attribute.push(AttributeProto {
                name: "seed".into(),
                r#type: AttributeType::Float as i32,
                f: 46.0,
                ..Default::default()
            });
        }
    }
    let mut model = onnx.model_for_proto_model(&proto)?;
    let n = model.symbols.sym("N");
    let facts = [
        InferenceFact::dt_shape(i64::datum_type(), tvec![1.to_dim(), n.to_dim()]),
        InferenceFact::dt_shape(i64::datum_type(), tvec![1.to_dim(), n.to_dim()]),
        InferenceFact::dt_shape(i64::datum_type(), tvec![1]),
        InferenceFact::dt_shape(f32::datum_type(), tvec![1]),
        InferenceFact::dt_shape(f32::datum_type(), tvec![1]),
        InferenceFact::dt_shape(f32::datum_type(), tvec![1]),
    ];
    for (i, fact) in facts.into_iter().enumerate() {
        model.set_input_fact(i, fact)?;
    }
    model.into_optimized()?.into_runnable()
}

// ---- splitting, as tiny-voca's infer.py ----------------------------------------------------------------------

static SENTENCE_END: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:(?<=[.!?…])|(?<=[.!?…]["')\]]))\s+(?=["'(\[]?[A-Z0-9])"#).unwrap());
static NOT_AN_END: LazyLock<Regex> = LazyLock::new(|| {
    // Python's \b under re.ASCII: no ASCII letter, digit or underscore before.
    Regex::new(r"(?i)(?:(?<![A-Za-z0-9_])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|(?<![A-Za-z0-9_])[A-Z])\.$")
        .unwrap()
});
static CLAUSE_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?<=[,;:—])\s+").unwrap());
const CLOSING: &[char] = &['"', '\'', '”', '’', ')', ']', '»'];

/// White space as JavaScript's `\s` (which shared/timing.mjs splits words at) and tiny-voca's `[\s\uFEFF]` see it.
fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}' || matches!(c, '\u{1c}'..='\u{1f}')
}

/// The text's words, split at white space, as `wordCount` in shared/timing.mjs counts them.
pub fn words(text: &str) -> Vec<&str> {
    text.split(is_space).filter(|w| !w.is_empty()).collect()
}

/// tiny-voca's `finished`, on the words: a full stop after the last word when the text ends without a mark.
fn finish(words: &mut [String]) {
    let Some(last) = words.last_mut() else { return };
    let marked = if last.chars().any(char::is_alphanumeric) {
        last.trim_end_matches(CLOSING).chars().last().is_some_and(|c| ".!?…,;:".contains(c))
    } else {
        last.chars().any(|c| ".!?…".contains(c)) || [",", ";", ":"].contains(&last.as_str())
    };
    if !marked {
        last.push('.');
    }
}

/// The word index each single space of `joined` (words joined by spaces) stands after, for a pattern's matches.
fn cuts(pattern: &Regex, joined: &str) -> Vec<usize> {
    pattern.find_iter(joined).filter_map(Result::ok).map(|m| joined[..m.start()].matches(' ').count() + 1).collect()
}

/// tiny-voca's `sentences`: word ranges of `words`, each with whether it has anything to say (a part without a
/// letter or a digit is skipped, as tiny-voca drops it).
fn sentences(words: &[String]) -> Vec<(std::ops::Range<usize>, bool)> {
    let joined = words.join(" ");
    let mut bounds = cuts(&SENTENCE_END, &joined);
    bounds.push(words.len());
    let mut out = Vec::new();
    let mut start = 0;
    for end in bounds {
        let current = words[start..end].join(" ");
        if !NOT_AN_END.is_match(&current).unwrap_or(false) || end == words.len() {
            out.push(start..end);
            start = end;
        }
    }
    out.into_iter().map(|r| (r.clone(), words[r].iter().any(|w| w.chars().any(char::is_alphanumeric)))).collect()
}

/// tiny-voca's `shorter`: cut after commas and the like, else in two between words; None for a single word.
fn shorter(range: std::ops::Range<usize>, words: &[String]) -> Option<Vec<std::ops::Range<usize>>> {
    let piece = &words[range.clone()];
    let mut bounds = cuts(&CLAUSE_END, &piece.join(" "));
    if !bounds.is_empty() {
        bounds.push(piece.len());
        let mut start = 0;
        return Some(
            bounds
                .into_iter()
                .map(|end| {
                    let r = range.start + start..range.start + end;
                    start = end;
                    r
                })
                .collect(),
        );
    }
    if piece.len() < 2 {
        return None;
    }
    let half = piece.len().div_ceil(2);
    Some(vec![range.start..range.start + half, range.start + half..range.end])
}

// ---- speaking -------------------------------------------------------------------------------------------------

/// One call of the model: the words it says, its audio and its timing.
struct Spoken {
    range: std::ops::Range<usize>,
    audio: Vec<f32>,
    /// Seconds from the call's start: each word's start, the first phone's start and the last phone's end.
    times: Vec<f64>,
    start: f64,
    end: f64,
}

/// A run of words: said by one call, or silent.
enum Part {
    Said(Spoken),
    Silent(std::ops::Range<usize>),
}

impl Voice {
    fn seconds(&self, frames: i64) -> f64 {
        (frames as usize * self.config.hop) as f64 / self.config.sample_rate as f64
    }

    /// How many spoken words (`<sp>`-separated groups) `text` has; 0 when it has nothing to say.
    fn spoken_words(&self, text: &str) -> usize {
        self.phonemizer.phonemize(text).map_or(0, |p| p.words.len())
    }

    /// Reads one range of words, cutting it shorter when it is too long for one call (`read` in speak_text).
    fn read(
        &self,
        range: std::ops::Range<usize>,
        words: &[String],
        voice: i64,
        speed: f32,
    ) -> Result<Vec<Part>, String> {
        let text = words[range.clone()].join(" ");
        let Ok(phones) = self.phonemizer.phonemize(&text) else { return Ok(vec![Part::Silent(range)]) };
        if phones.len() <= self.config.model.max_tokens - 12 {
            let (audio, durations) = self.synthesize(&phones.ids, &phones.stress, voice, speed)?;
            let frames: i64 = durations.iter().sum();
            if frames as usize <= self.config.model.max_frames {
                return Ok(vec![Part::Said(self.timed(range, words, &phones, audio, &durations))]);
            }
        }
        let pieces = shorter(range, words).ok_or_else(|| format!("one word is too long to speak: {text:.40}"))?;
        let mut out = Vec::new();
        for piece in pieces {
            out.extend(self.read(piece, words, voice, speed)?);
        }
        Ok(out)
    }

    /// Where each word of a call starts. The model times tokens; each word of the text is given the spoken words
    /// that its prefix of the text adds (a number or a date can be several spoken words, a sign none), and starts
    /// at the first phone of the first of them.
    fn timed(
        &self,
        range: std::ops::Range<usize>,
        words: &[String],
        phones: &dizione::Phonemized,
        audio: Vec<f32>,
        durations: &[i64],
    ) -> Spoken {
        let mut at = Vec::with_capacity(durations.len() + 1);
        let mut sum = 0i64;
        at.push(0.0);
        for d in durations {
            sum += d;
            at.push(self.seconds(sum));
        }
        let spoken = phones.words.len();
        let word_start = |g: usize| phones.words.get(g).map_or(at[at.len() - 1], |&t| at[t]);
        let first = phones.ids.iter().position(|&i| is_phone(i)).unwrap_or(0);
        let last = phones.ids.iter().rposition(|&i| is_phone(i)).map_or(at.len() - 1, |i| i + 1);
        let n = range.len();
        let mut times = Vec::with_capacity(n);
        let mut before = 0;
        for k in 1..=n {
            times.push(word_start(before.min(spoken)));
            let upto = if k == n { spoken } else { self.spoken_words(&words[range.start..range.start + k].join(" ")) };
            before = upto.clamp(before, spoken);
        }
        let end = at[last];
        for t in &mut times {
            *t = t.min(end);
        }
        Spoken { range, audio, times, start: at[first], end }
    }

    /// Speaks `text`: its samples at 24 kHz and its sentences' timing.
    pub fn speak(&self, text: &str, voice: i64, speed: f32) -> Result<(Vec<f32>, Vec<serde_json::Value>), String> {
        let mut words: Vec<String> = words(text).into_iter().map(String::from).collect();
        finish(&mut words);
        let parts: Vec<Part> = sentences(&words)
            .into_par_iter()
            .map(
                |(range, said)| {
                    if said { self.read(range, &words, voice, speed) } else { Ok(vec![Part::Silent(range)]) }
                },
            )
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        let rate = self.config.sample_rate as f64;
        let mut samples: Vec<f32> = Vec::new();
        let mut sentences = Vec::new();
        let round = |s: f64| (s * 1000.0).round() / 1000.0;
        for part in parts {
            let offset = samples.len() as f64 / rate;
            match part {
                Part::Silent(range) => sentences.push(json!({
                    "words": range.len(), "start": round(offset), "end": round(offset),
                    "times": vec![round(offset); range.len()],
                })),
                Part::Said(s) => {
                    sentences.push(json!({
                        "words": s.range.len(),
                        "start": round(offset + s.start),
                        "end": round(offset + s.end),
                        "times": s.times.iter().map(|t| round(offset + t)).collect::<Vec<_>>(),
                    }));
                    samples.extend_from_slice(&s.audio);
                }
            }
        }
        if samples.is_empty() {
            samples = vec![0.0; (SILENT_SECONDS * rate) as usize];
        }
        let loudest = samples.iter().fold(0f32, |m, x| m.max(x.abs()));
        if loudest > PEAK {
            let k = PEAK / loudest;
            samples.iter_mut().for_each(|x| *x *= k);
        }
        Ok((samples, sentences))
    }
}

/// 16-bit mono PCM, written to `<file>.tmp-<pid>` and renamed, so a half-written clip is never under its name.
fn write_wav(path: &Path, samples: &[f32], rate: u32) -> Result<(), String> {
    let tmp = PathBuf::from(format!("{}.tmp-{}", path.display(), std::process::id()));
    let spec =
        hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let write = || -> Result<(), hound::Error> {
        let mut w = hound::WavWriter::create(&tmp, spec)?;
        for &x in samples {
            w.write_sample((x.clamp(-1.0, 1.0) * 32767.0).round() as i16)?;
        }
        w.finalize()
    };
    write().map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[derive(Deserialize)]
struct Job {
    clips: Vec<JobClip>,
}

#[derive(Deserialize)]
struct JobClip {
    text: String,
    voice: String,
    speed: f32,
    out: PathBuf,
}

pub fn command(f: &HashMap<String, String>) -> Result<(), String> {
    let dir = PathBuf::from(f.get("model-dir").ok_or("--model-dir is required")?);
    let job_file = f.get("job").ok_or("--job is required")?;
    let job: Job = serde_json::from_str(&std::fs::read_to_string(job_file).map_err(|e| format!("{job_file}: {e}"))?)
        .map_err(|e| format!("{job_file}: {e}"))?;
    let voice = Voice::load(&dir)?;
    let total = job.clips.len();
    eprintln!("progress 0/{total}");
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let printer = std::thread::spawn(move || -> Result<(), String> {
        let mut done = 0;
        let mut stdout = std::io::stdout().lock();
        for line in rx {
            writeln!(stdout, "{}", line?).map_err(|e| e.to_string())?;
            stdout.flush().map_err(|e| e.to_string())?;
            done += 1;
            eprintln!("progress {done}/{total}");
        }
        Ok(())
    });
    let rate = voice.config.sample_rate;
    job.clips.par_iter().enumerate().for_each_with(tx, |tx, (i, clip)| {
        let result = (|| {
            let index = voice.voice_index(&clip.voice)?;
            let (samples, sentences) = voice.speak(&clip.text, index, clip.speed)?;
            write_wav(&clip.out, &samples, rate)?;
            let seconds = (samples.len() as f64 / rate as f64 * 1000.0).round() / 1000.0;
            Ok(json!({ "clip": i, "seconds": seconds, "sentences": sentences }).to_string())
        })();
        let _ = tx.send(result);
    });
    printer.join().map_err(|_| "the output thread failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// tiny-voca's sentence splitting, on the narration of every example: tests/fixtures/voice-splits.json was
    /// written by tiny-voca's own `sentences(finished(text))` (engine/dizione/tests/fixtures/make-phonemes.py).
    #[test]
    fn splits_as_tiny_voca() {
        let cases: Vec<(String, Vec<String>)> =
            serde_json::from_str(include_str!("../tests/fixtures/voice-splits.json")).unwrap();
        for (text, want) in cases {
            let mut w: Vec<String> = words(&text).into_iter().map(String::from).collect();
            finish(&mut w);
            let got: Vec<String> =
                sentences(&w).into_iter().filter(|(_, said)| *said).map(|(r, _)| w[r].join(" ")).collect();
            assert_eq!(got, want, "{text}");
        }
    }

    #[test]
    fn cuts_long_sentences_as_tiny_voca() {
        let w: Vec<String> = "one, two; three four".split(' ').map(String::from).collect();
        assert_eq!(shorter(0..4, &w), Some(vec![0..1, 1..2, 2..4]));
        let w: Vec<String> = "a b c d e".split(' ').map(String::from).collect();
        assert_eq!(shorter(0..5, &w), Some(vec![0..3, 3..5]));
        assert_eq!(shorter(0..1, &w), None);
    }
}
