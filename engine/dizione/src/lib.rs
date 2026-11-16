//! dizione in Rust: English text to tiny-voca's phoneme tokens.
//!
//! A port of the dizione Python package (https://github.com/n4ze3m/dizione, Apache-2.0, commit 8cd889e), module by
//! module: normalize (text to words), engine (words to phones), convert and align (CMUdict to the inventory),
//! morphology, sentence, homographs and g2p (the unknown-word model). Its hand-written tables are in `data/`; the
//! built data (lexicon.tsv, align.json, g2p.json, g2p.npz, homographs.json) comes with the model and is read from a
//! directory. `tests/fixtures.rs` checks the output against the Python package's on several thousand sentences.

mod align;
mod convert;
mod engine;
mod g2p;
mod homographs;
mod morphology;
mod normalize;
mod py;
mod rx;
mod sentence;
pub mod symbols;
mod tables;

pub use engine::{DATA_FILES, Phonemizer};
pub use symbols::{NothingToPronounce, Phonemized, SYMBOLS};
