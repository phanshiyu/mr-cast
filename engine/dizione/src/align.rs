//! Which letters spell which phoneme (dizione/align.py, `Aligner` only: the table is trained in Python).

use std::collections::HashMap;

const MAX_RUN: usize = 4;
const UNSEEN: f64 = -14.0;

/// ARPABET symbol without its stress digit.
pub fn base(symbol: &str) -> &str {
    symbol.trim_end_matches(['0', '1', '2'])
}

pub struct Aligner {
    table: HashMap<String, HashMap<String, f64>>,
}

impl Aligner {
    /// `align.json`: `{phoneme: {letters: log probability}}`.
    pub fn from_json(text: &str) -> Result<Aligner, String> {
        let table = serde_json::from_str(text).map_err(|e| format!("align.json: {e}"))?;
        Ok(Aligner { table })
    }

    fn score(&self, phone: &str, run: &[char]) -> f64 {
        let run_s: String = run.iter().collect();
        match self.table.get(phone).and_then(|known| known.get(&run_s)) {
            Some(v) => *v,
            None => UNSEEN - 2.0 * (run.len() as f64 - 1.0).abs(),
        }
    }

    /// One run of letters per phoneme, or None when the word is too long for the pronunciation.
    pub fn align(&self, word: &str, phones: &[String]) -> Option<Vec<String>> {
        let phones: Vec<&str> = phones.iter().map(|p| base(p)).collect();
        let word: Vec<char> = word.chars().collect();
        let (letters, count) = (word.len(), phones.len());
        if count == 0 || letters > MAX_RUN * count {
            return None;
        }
        let low = -1e18;
        let mut best = vec![vec![low; letters + 1]; count + 1];
        let mut step = vec![vec![0usize; letters + 1]; count + 1];
        best[0][0] = 0.0;
        for j in 1..=count {
            let phone = phones[j - 1];
            for i in 0..=letters {
                for k in 0..=MAX_RUN.min(i) {
                    if best[j - 1][i - k] > low {
                        let value = best[j - 1][i - k] + self.score(phone, &word[i - k..i]);
                        if value > best[j][i] {
                            best[j][i] = value;
                            step[j][i] = k;
                        }
                    }
                }
            }
        }
        if best[count][letters] <= low {
            return None;
        }
        let mut runs = Vec::with_capacity(count);
        let mut i = letters;
        for j in (1..=count).rev() {
            let k = step[j][i];
            runs.push(word[i - k..i].iter().collect());
            i -= k;
        }
        runs.reverse();
        Some(runs)
    }
}
