//! Inline markup in the text a scene draws: a port of shared/markup.mjs.
//!
//! `**bold**`, `` `code` ``, `==marked==` and `[words]{tone}`, with a backslash keeping a markup character literal.

/// A styled piece of text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Run {
    pub text: String,
    pub bold: bool,
    pub code: bool,
    pub mark: bool,
    pub tone: Option<String>,
}

impl Run {
    pub fn plain(text: impl Into<String>) -> Self {
        Run { text: text.into(), ..Default::default() }
    }
    pub fn styled(&self) -> bool {
        self.bold || self.code || self.mark || self.tone.is_some()
    }
}

const TONE_NAMES: [&str; 5] = ["good", "bad", "warn", "accent", "neutral"];
const ESCAPABLE: &str = "*`=[]{}\\";

fn is_space(ch: Option<char>) -> bool {
    ch.is_none_or(|c| c.is_whitespace())
}

/// Index of the `]` that closes a tone span opened at `open`, skipping escapes and code.
fn closing_bracket(src: &[char], open: usize) -> Option<usize> {
    let mut i = open + 1;
    while i < src.len() {
        match src[i] {
            '\\' => i += 1,
            '`' => {
                let end = (i + 1..src.len()).find(|&j| src[j] == '`')?;
                i = end;
            }
            ']' => return Some(i),
            '[' | '\n' => return None,
            _ => {}
        }
        i += 1;
    }
    None
}

#[derive(Default)]
struct Style {
    bold: bool,
    mark: bool,
    tone: Option<String>,
}

/// Splits `src` into styled runs; malformed markup stays literal text (shared/markup.mjs `parseMarkup`).
pub fn parse_markup(src: &str) -> Vec<Run> {
    let text: Vec<char> = src.chars().collect();
    let mut runs: Vec<Run> = Vec::new();
    let mut style = Style::default();
    let mut tone_end: Option<usize> = None;
    let mut buf = String::new();

    let flush = |buf: &mut String, runs: &mut Vec<Run>, style: &Style, code: bool| {
        if buf.is_empty() {
            return;
        }
        let run = Run { text: std::mem::take(buf), bold: style.bold, code, mark: style.mark, tone: style.tone.clone() };
        if let Some(last) = runs.last_mut()
            && !code
            && !last.code
            && last.bold == run.bold
            && last.mark == run.mark
            && last.tone == run.tone
        {
            last.text.push_str(&run.text);
            return;
        }
        runs.push(run);
    };

    let mut i = 0;
    while i < text.len() {
        let ch = text[i];
        if ch == '\\' && text.get(i + 1).is_some_and(|c| ESCAPABLE.contains(*c)) {
            i += 1;
            buf.push(text[i]);
            i += 1;
            continue;
        }
        if Some(i) == tone_end {
            flush(&mut buf, &mut runs, &style, false);
            style.tone = None;
            i = (i..text.len()).find(|&j| text[j] == '}').unwrap_or(text.len());
            tone_end = None;
            i += 1;
            continue;
        }
        if ch == '`' {
            let mut end = None;
            let mut code = String::new();
            let mut j = i + 1;
            while j < text.len() {
                if text[j] == '\\' && text.get(j + 1) == Some(&'`') {
                    code.push('`');
                    j += 1;
                } else if text[j] == '`' {
                    end = Some(j);
                    break;
                } else {
                    code.push(text[j]);
                }
                j += 1;
            }
            match end {
                None => buf.push(ch),
                Some(end) => {
                    flush(&mut buf, &mut runs, &style, false);
                    buf = code;
                    flush(&mut buf, &mut runs, &style, true);
                    i = end;
                }
            }
            i += 1;
            continue;
        }
        let pair: Option<char> = match (ch, text.get(i + 1)) {
            ('*', Some('*')) => Some('*'),
            ('=', Some('=')) => Some('='),
            _ => None,
        };
        if let Some(p) = pair {
            let can_open = !is_space(text.get(i + 2).copied());
            let can_close = !is_space(if i == 0 { None } else { Some(text[i - 1]) });
            let on = if p == '*' { style.bold } else { style.mark };
            if on && can_close {
                flush(&mut buf, &mut runs, &style, false);
                if p == '*' {
                    style.bold = false
                } else {
                    style.mark = false
                }
                i += 2;
                continue;
            }
            if !on && can_open {
                let blocked = p == '=' && (style.tone.is_some() || style.bold);
                if !blocked {
                    flush(&mut buf, &mut runs, &style, false);
                    if p == '*' {
                        style.bold = true
                    } else {
                        style.mark = true
                    }
                    i += 2;
                    continue;
                }
            }
            buf.push(ch);
            buf.push(text[i + 1]);
            i += 2;
            continue;
        }
        if ch == '['
            && let Some(close) = closing_bracket(&text, i)
            && text.get(close + 1) == Some(&'{')
        {
            let name: String = text[close + 2..].iter().take_while(|c| c.is_ascii_alphabetic()).collect();
            if text.get(close + 2 + name.chars().count()) == Some(&'}')
                && TONE_NAMES.contains(&name.as_str())
                && style.tone.is_none()
                && !style.mark
                && !style.bold
            {
                flush(&mut buf, &mut runs, &style, false);
                style.tone = Some(name);
                tone_end = Some(close);
                i += 1;
                continue;
            }
        }
        buf.push(ch);
        i += 1;
    }
    flush(&mut buf, &mut runs, &style, false);
    runs
}

/// The text without its markup, as a voice reads it.
pub fn plain_text(src: &str) -> String {
    parse_markup(src).into_iter().map(|r| r.text).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_kind() {
        let runs = parse_markup("a **b** `c` ==d== [e]{warn} x == y");
        let texts: Vec<_> = runs.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["a ", "b", " ", "c", " ", "d", " ", "e", " x == y"]);
        assert!(runs[1].bold && runs[3].code && runs[5].mark);
        assert_eq!(runs[7].tone.as_deref(), Some("warn"));
        assert_eq!(plain_text(r"\*\*not bold\*\*"), "**not bold**");
    }
}
