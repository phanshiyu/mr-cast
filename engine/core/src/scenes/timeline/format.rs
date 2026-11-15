//! `formatValue` and `niceTicks` of src/utils/chartLayout.ts, as the timeline's axis uses them.

const MINUS: char = '\u{2212}';
/// Units that sit against the number rather than after a space.
const TIGHT_UNITS: [&str; 4] = ["%", "x", "\u{d7}", "\u{b0}"];

/// `1234567` as "1,234,567"; `digits` is a plain decimal string without a sign.
fn group(plain: &str) -> String {
    let (int, frac) = plain.split_once('.').map_or((plain, None), |(i, f)| (i, Some(f)));
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if let Some(f) = frac {
        out.push('.');
        out.push_str(f);
    }
    out
}

/// A non-negative number rounded to `sig` significant digits, then to at most `max_frac` fraction digits when set,
/// printed with grouped thousands and no trailing zeros (`toLocaleString('en-US')`).
fn locale(v: f64, sig: i32, max_frac: Option<i32>) -> String {
    if v == 0.0 {
        return "0".into();
    }
    let e = v.log10().floor() as i32;
    let mut decimals = (sig - 1 - e).max(0);
    if let Some(m) = max_frac {
        decimals = decimals.min(m);
    }
    let scale = 10f64.powi(sig - 1 - e);
    let rounded = (v * scale).round() / scale;
    let mut s = format!("{:.*}", decimals as usize, rounded);
    if s.contains('.') {
        s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    group(&s)
}

/// `trimmed(v, 3)`: three significant digits, at most two fraction digits.
fn trimmed(v: f64) -> String {
    locale(v, 3, Some(2))
}

/// What a value prints with: a `prefix` before the number and a `unit` after it.
pub fn format_value(v: f64, unit: Option<&str>, prefix: Option<&str>) -> String {
    let abs = v.abs();
    let sign = if v < 0.0 { MINUS.to_string() } else { String::new() };
    let text = if abs >= 1e9 {
        format!("{}B", trimmed(abs / 1e9))
    } else if abs >= 1e6 {
        format!("{}M", trimmed(abs / 1e6))
    } else if abs >= 1e4 {
        format!("{}k", trimmed(abs / 1e3))
    } else {
        locale(abs, 4, None)
    };
    let head = format!("{sign}{}{text}", prefix.unwrap_or(""));
    match unit {
        Some(u) if !u.is_empty() => format!("{head}{}{u}", if TIGHT_UNITS.contains(&u) { "" } else { " " }),
        _ => head,
    }
}

/// `Number(t.toPrecision(12))`.
fn precision12(t: f64) -> f64 {
    format!("{t:.11e}").parse().unwrap_or(t)
}

fn ticks_of(lo: f64, span: f64, count: f64) -> Vec<f64> {
    let raw = span / count;
    let mag = 10f64.powf(raw.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0].iter().map(|m| m * mag).find(|&s| s >= raw).unwrap_or(10.0 * mag);
    let mut ticks = Vec::new();
    let mut t = (lo / step).floor() * step;
    while t < lo + span + step - step * 1e-9 {
        ticks.push(precision12(t));
        t += step;
    }
    ticks
}

/// Round ticks covering [min, max] from zero or below, with 3 to 6 intervals, whichever wastes least room above
/// the top value.
pub fn nice_ticks(min: f64, max: f64) -> Vec<f64> {
    let lo = min.min(0.0);
    let span = if max > lo { max - lo } else { 1.0 };
    let options: Vec<Vec<f64>> = [4.0, 5.0, 3.0, 6.0].iter().map(|&c| ticks_of(lo, span, c)).collect();
    let waste = |t: &[f64]| t[t.len() - 1] - (lo + span);
    let mut best = &options[0];
    for t in &options {
        if waste(t) < waste(best) - span * 0.02 {
            best = t;
        }
    }
    best.clone()
}
