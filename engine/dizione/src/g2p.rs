//! The unknown-word model (dizione/g2p.py): letters -> CMUdict phonemes. Letter embeddings (each letter given
//! `slots` positions), residual convolutions, a bidirectional GRU and a CTC output layer read greedily.
//! The weights are `g2p.npz` (float32 arrays stored uncompressed, as numpy.savez writes them).

use std::collections::HashMap;

use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

#[derive(Deserialize)]
struct Settings {
    letters: String,
    symbols: Vec<String>,
    convs: usize,
    layers: usize,
    slots: usize,
}

/// A float32 array.
struct Array {
    shape: Vec<usize>,
    data: Vec<f32>,
    wide: Vec<f64>,
}

impl Array {
    fn cols(&self) -> usize {
        self.shape.get(1).copied().unwrap_or(1)
    }

    fn row(&self, r: usize) -> &[f32] {
        let c = self.cols();
        &self.data[r * c..(r + 1) * c]
    }
}

pub struct Model {
    settings: Settings,
    weights: HashMap<String, Array>,
    letters: HashMap<char, usize>,
}

fn u16le(b: &[u8], at: usize) -> usize {
    u16::from_le_bytes([b[at], b[at + 1]]) as usize
}

fn u32le(b: &[u8], at: usize) -> usize {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as usize
}

/// The arrays of an .npz whose entries are stored uncompressed.
fn read_npz(buf: &[u8]) -> Result<HashMap<String, Array>, String> {
    let mut eocd = buf.len().checked_sub(22).ok_or("not a zip file")?;
    while u32le(buf, eocd) != 0x0605_4b50 {
        eocd = eocd.checked_sub(1).ok_or("not a zip file")?;
    }
    let entries = u16le(buf, eocd + 10);
    let mut at = u32le(buf, eocd + 16);
    let mut out = HashMap::new();
    for _ in 0..entries {
        let method = u16le(buf, at + 10);
        let size = u32le(buf, at + 24);
        let name_len = u16le(buf, at + 28);
        let local = u32le(buf, at + 42);
        let name = String::from_utf8_lossy(&buf[at + 46..at + 46 + name_len]).to_string();
        at += 46 + name_len + u16le(buf, at + 30) + u16le(buf, at + 32);
        if method != 0 {
            return Err(format!("{name} is compressed"));
        }
        let start = local + 30 + u16le(buf, local + 26) + u16le(buf, local + 28);
        let array = read_npy(&buf[start..start + size]).map_err(|e| format!("{name}: {e}"))?;
        out.insert(name.trim_end_matches(".npy").to_string(), array);
    }
    Ok(out)
}

fn read_npy(buf: &[u8]) -> Result<Array, String> {
    let major = buf[6];
    let (header_len, at) = if major == 1 { (u16le(buf, 8), 10) } else { (u32le(buf, 8), 12) };
    let header = String::from_utf8_lossy(&buf[at..at + header_len]);
    if !header.contains("'descr': '<f4'") || header.contains("'fortran_order': True") {
        return Err(format!("unsupported array ({})", header.trim()));
    }
    let shape_text = header.split("'shape': (").nth(1).and_then(|s| s.split(')').next()).ok_or("no shape")?;
    let shape: Vec<usize> = shape_text.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    let data: Vec<f32> = buf[at + header_len..].as_chunks::<4>().0.iter().map(|c| f32::from_le_bytes(*c)).collect();
    let wide = data.iter().map(|&v: &f32| v as f64).collect();
    Ok(Array { shape, data, wide })
}

/// `x @ w.T + b` for a row `x`, accumulated in f64 and rounded once (numpy's float32 BLAS is within a rounding of
/// it). The weights are kept as f64 (`Array::wide`) so the loop is all multiply-adds.
fn affine(x: &[f32], w: &Array, b: &[f32]) -> Vec<f32> {
    let x: Vec<f64> = x.iter().map(|&v| v as f64).collect();
    let cols = w.cols();
    (0..w.shape[0])
        .map(|r| {
            let row = &w.wide[r * cols..(r + 1) * cols];
            // Eight running sums, so the loop vectorizes; in f64 their order does not show in the f32 result.
            let mut acc = [0f64; 8];
            let split = x.len() / 8 * 8;
            for (xa, ca) in x[..split].as_chunks::<8>().0.iter().zip(row[..split].as_chunks::<8>().0) {
                for k in 0..8 {
                    acc[k] += xa[k] * ca[k];
                }
            }
            let mut sum: f64 = acc.iter().sum();
            for (a, c) in x[split..].iter().zip(&row[split..]) {
                sum += a * c;
            }
            (sum + b[r] as f64) as f32
        })
        .collect()
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

impl Model {
    pub fn load(settings_json: &str, npz: &[u8]) -> Result<Model, String> {
        let settings: Settings = serde_json::from_str(settings_json).map_err(|e| format!("g2p.json: {e}"))?;
        if settings.convs != 0 {
            return Err("g2p.npz has convolutions, which this port does not run".into());
        }
        let weights = read_npz(npz).map_err(|e| format!("g2p.npz: {e}"))?;
        let letters = settings.letters.chars().enumerate().map(|(i, c)| (c, i + 1)).collect();
        Ok(Model { settings, weights, letters })
    }

    fn w(&self, name: &str) -> &Array {
        &self.weights[name]
    }

    /// The word reduced to the letters the model knows (accents removed).
    pub fn spellable(&self, word: &str) -> String {
        let plain: String = word.to_lowercase().nfkd().filter(|c| self.letters.contains_key(c)).collect();
        plain.trim_matches('\'').to_string()
    }

    fn gru(&self, x: &[Vec<f32>], layer: usize, suffix: &str, reverse: bool) -> Vec<Vec<f32>> {
        let w_ih = self.w(&format!("gru__weight_ih_l{layer}{suffix}"));
        let w_hh = self.w(&format!("gru__weight_hh_l{layer}{suffix}"));
        let b_ih = &self.w(&format!("gru__bias_ih_l{layer}{suffix}")).data;
        let b_hh = &self.w(&format!("gru__bias_hh_l{layer}{suffix}")).data;
        let size = w_hh.shape[1];
        let inputs: Vec<Vec<f32>> = x.iter().map(|row| affine(row, w_ih, b_ih)).collect();
        let mut state = vec![0f32; size];
        let mut out = vec![Vec::new(); x.len()];
        let order: Vec<usize> = if reverse { (0..x.len()).rev().collect() } else { (0..x.len()).collect() };
        for t in order {
            let recurrent = affine(&state, w_hh, b_hh);
            let inp = &inputs[t];
            let mut next = vec![0f32; size];
            for k in 0..size {
                let reset = sigmoid(inp[k] + recurrent[k]);
                let update = sigmoid(inp[size + k] + recurrent[size + k]);
                let candidate = (inp[2 * size + k] + reset * recurrent[2 * size + k]).tanh();
                next[k] = (1.0 - update) * candidate + update * state[k];
            }
            state = next;
            out[t] = state.clone();
        }
        out
    }

    /// CMUdict symbols with stress digits for `word` (letters and apostrophes).
    pub fn predict(&self, word: &str) -> Vec<String> {
        let word = self.spellable(word);
        if word.is_empty() {
            return Vec::new();
        }
        let slots = self.settings.slots;
        let embed = self.w("embed__weight");
        let slot = self.w("slot");
        let mut x: Vec<Vec<f32>> = Vec::new();
        for c in word.chars() {
            let e = embed.row(self.letters[&c]);
            for s in 0..slots {
                x.push(e.iter().zip(slot.row(s)).map(|(a, b)| a + b).collect());
            }
        }
        for layer in 0..self.settings.layers {
            let forward = self.gru(&x, layer, "", false);
            let backward = self.gru(&x, layer, "_reverse", true);
            x = forward
                .into_iter()
                .zip(backward)
                .map(|(mut f, b)| {
                    f.extend(b);
                    f
                })
                .collect();
        }
        let out_w = self.w("out__weight");
        let out_b = &self.w("out__bias").data;
        let mut symbols = Vec::new();
        let mut previous = 0;
        for row in &x {
            let logits = affine(row, out_w, out_b);
            let mut label = 0;
            for (k, v) in logits.iter().enumerate() {
                if *v > logits[label] {
                    label = k;
                }
            }
            if label != previous && label != 0 {
                symbols.push(self.settings.symbols[label - 1].clone());
            }
            previous = label;
        }
        symbols
    }
}
