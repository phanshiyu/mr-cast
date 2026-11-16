//! The phone inventory and the token sequence built from it (dizione/symbols.py).
//!
//! 59 phones of American English, 12 punctuation marks and 5 special tokens. A phone is held as its id, the index
//! into [`SYMBOLS`], which is the id the model reads. Lexical stress is a parallel feature (0 none, 1 primary,
//! 2 secondary).

pub const PAD: u8 = 0;
pub const BOS: u8 = 1;
pub const EOS: u8 = 2;
pub const SP: u8 = 3;
pub const UNK: u8 = 4;

/// Append-only: the model's ids index this list.
pub const SYMBOLS: [&str; 76] = [
    "<pad>", "<bos>", "<eos>", "<sp>", "<unk>", ",", ".", "?", "!", ";", ":", "\"", "'", "(", ")", "—", "…", "p", "b",
    "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "m", "n", "ŋ", "l", "ɹ", "j", "w", "tʃ", "dʒ",
    "ɾ", "ʔ", "ə", "ɐ", "ɚ", "ᵻ", "ɪ", "i", "iː", "ɛ", "æ", "ʌ", "ɑː", "ɔ", "ɔː", "ʊ", "uː", "ɜː", "eɪ", "aɪ", "ɔɪ",
    "oʊ", "aʊ", "iə", "oː", "ɑːɹ", "ɔːɹ", "oːɹ", "ɪɹ", "ɛɹ", "ʊɹ", "aɪɚ", "aɪə", "əl", "n̩",
];

/// The first punctuation id, the first phone id and the first vowel id.
const FIRST_MARK: u8 = 5;
const FIRST_PHONE: u8 = 17;
const FIRST_VOWEL: u8 = 43;

/// A phone with its stress.
pub type Phone = (u8, u8);
pub type Phones = Vec<Phone>;

/// The id of a symbol, if it is one.
pub fn id(symbol: &str) -> Option<u8> {
    SYMBOLS.iter().position(|s| *s == symbol).map(|i| i as u8)
}

/// The id of a symbol the rules name; panics on a typo, which the tests would catch.
pub fn p(symbol: &str) -> u8 {
    id(symbol).unwrap_or_else(|| panic!("{symbol:?} is not a symbol"))
}

pub fn is_phone(id: u8) -> bool {
    id >= FIRST_PHONE
}

pub fn is_vowel(id: u8) -> bool {
    id >= FIRST_VOWEL
}

pub fn is_mark(id: u8) -> bool {
    (FIRST_MARK..FIRST_PHONE).contains(&id)
}

/// The id of a punctuation mark.
pub fn mark_id(mark: &str) -> Option<u8> {
    id(mark).filter(|&i| is_mark(i))
}

/// The model's input for one utterance: ids and stress, and where each spoken word starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Phonemized {
    pub ids: Vec<u8>,
    pub stress: Vec<u8>,
    /// The token index of each spoken word's first phone, in order.
    pub words: Vec<usize>,
}

impl Phonemized {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }
}

impl std::fmt::Display for Phonemized {
    /// As Python's `str(Phonemized)`: each symbol with its stress mark, separated by spaces.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (k, (&i, &s)) in self.ids.iter().zip(&self.stress).enumerate() {
            if k > 0 {
                f.write_str(" ")?;
            }
            f.write_str(match s {
                1 => "ˈ",
                2 => "ˌ",
                _ => "",
            })?;
            f.write_str(SYMBOLS[i as usize])?;
        }
        Ok(())
    }
}

/// A piece of the text: a punctuation mark, or a run of spoken words.
#[derive(Clone, Debug)]
pub enum Piece {
    Mark(u8),
    Words(Vec<Phones>),
}

/// The text has no word, number or letter to say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NothingToPronounce;

impl std::fmt::Display for NothingToPronounce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the text has nothing to pronounce")
    }
}

impl std::error::Error for NothingToPronounce {}

/// The token sequence: words separated by `<sp>`, repeated punctuation collapsed, between `<bos>` and `<eos>`.
pub fn tokenize(pieces: &[Piece]) -> Result<Phonemized, NothingToPronounce> {
    let mut ids = vec![BOS];
    let mut stress = vec![0];
    let mut words = Vec::new();
    for piece in pieces {
        match piece {
            Piece::Mark(m) => {
                if *ids.last().unwrap() != *m {
                    ids.push(*m);
                    stress.push(0);
                }
            }
            Piece::Words(list) => {
                for word in list {
                    let last = *ids.last().unwrap();
                    if is_phone(last) || last == UNK {
                        ids.push(SP);
                        stress.push(0);
                    }
                    if !word.is_empty() {
                        words.push(ids.len());
                    }
                    for &(phone, level) in word {
                        ids.push(phone);
                        stress.push(level);
                    }
                }
            }
        }
    }
    ids.push(EOS);
    stress.push(0);
    if !ids.iter().any(|&i| is_phone(i) || i == UNK) {
        return Err(NothingToPronounce);
    }
    Ok(Phonemized { ids, stress, words })
}
