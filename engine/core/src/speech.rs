//! Spoken text as the voice reads it: a port of shared/speech.mjs. Each written form the voice misreads is
//! rewritten to the words a person would say. JavaScript's lookbehinds that are not fixed-length are checked
//! by hand, on the text before a match, as the JS engine would.

use fancy_regex::{Captures, Regex};
use std::sync::OnceLock;

type Replace = fn(&Captures<str>) -> String;
type Behind = fn(&str) -> bool;

struct Form {
    re: Regex,
    /// Rejects a match when the text before it matches the JS lookbehind.
    behind: Option<Behind>,
    replace: Replace,
}

fn ends_with_re(re: &'static str) -> impl Fn(&str) -> bool {
    move |before: &str| Regex::new(re).unwrap().is_match(before).unwrap_or(false)
}

fn forms() -> &'static [Form] {
    static FORMS: OnceLock<Vec<Form>> = OnceLock::new();
    FORMS.get_or_init(|| {
        let f =
            |re: &str, behind: Option<Behind>, replace: Replace| Form { re: Regex::new(re).unwrap(), behind, replace };
        vec![
            f(r"(?i)\be\.g\.,?", None, |_| "for example,".into()),
            f(r"(?i)\bi\.e\.,?", None, |_| "that is,".into()),
            f(r"(?<![<-])\s*(?:-{1,2}>|→)\s*", None, |_| " to ".into()),
            f(r"([0-9])\s?ms\b", None, |c| format!("{} milliseconds", &c[1])),
            f(
                r"(?i)\b([0-9]{1,2}(?:\.[0-9]+)?)s\b(?!-|\s+of\b)",
                Some(|before| {
                    static WORD: OnceLock<Regex> = OnceLock::new();
                    let word = WORD.get_or_init(|| Regex::new(r"(?i)\b(?:the|and|or|early|late|mid)[\s-]+$").unwrap());
                    before.ends_with(|c: char| c.is_ascii_digit() || ",.$-".contains(c))
                        || word.is_match(before).unwrap_or(false)
                }),
                |c| format!("{} seconds", &c[1]),
            ),
            f(r"([A-Za-z0-9_])/(?:s|sec|second)\b", None, |c| format!("{} per second", &c[1])),
            f(r"([A-Za-z0-9_])/(?:min|minute)\b", None, |c| format!("{} per minute", &c[1])),
            f(r"([A-Za-z0-9_])/(?:h|hr|hour)\b", None, |c| format!("{} per hour", &c[1])),
            f(r"([A-Za-z0-9_])/day\b", None, |c| format!("{} per day", &c[1])),
            f(r"([0-9])\s?reqs?\b", None, |c| format!("{} requests", &c[1])),
            f(
                r"(?i)v([0-9]+(?:\.[0-9]+)+)(?![A-Za-z0-9_/]|\.[0-9])",
                Some(|before| {
                    before.ends_with(|c: char| c.is_ascii_alphanumeric() || "_/.".contains(c))
                        || ends_with_re(r"\bversion\s$")(before)
                }),
                |c| format!("version {}", c[1].split('.').collect::<Vec<_>>().join(" point ")),
            ),
            f(
                r"[0-9]+\.[0-9]+\.[0-9]+(?![A-Za-z0-9_]|\.[0-9])",
                Some(|before| before.ends_with(|c: char| c.is_ascii_alphanumeric() || "_.".contains(c))),
                |c| c[0].split('.').collect::<Vec<_>>().join(" point "),
            ),
        ]
    })
}

/// `String.prototype.replace` with a global regex, honouring the form's lookbehind.
fn replace_all(text: &str, form: &Form) -> String {
    let mut out = String::new();
    let mut last = 0;
    let mut pos = 0;
    while pos <= text.len() {
        let Ok(Some(c)) = form.re.captures_from_pos(text, pos) else { break };
        let m = c.get(0).unwrap();
        if form.behind.is_some_and(|b| b(&text[..m.start()])) {
            pos = m.start() + text[m.start()..].chars().next().map_or(1, char::len_utf8);
            continue;
        }
        out.push_str(&text[last..m.start()]);
        out.push_str(&(form.replace)(&c));
        last = m.end();
        pos = if m.end() == m.start() {
            m.end() + text[m.end()..].chars().next().map_or(1, char::len_utf8)
        } else {
            m.end()
        };
    }
    out.push_str(&text[last.min(text.len())..]);
    out
}

/// `text` with each written form the voice misreads replaced by its spoken words.
pub fn speech_text(written: &str) -> String {
    let mut out = written.to_string();
    for form in forms() {
        out = replace_all(&out, form);
    }
    if out == written {
        return out;
    }
    static TIDY: OnceLock<(Regex, Regex)> = OnceLock::new();
    let (comma, spaces) =
        TIDY.get_or_init(|| (Regex::new(r",(\s*[,.!?]|\s*$)").unwrap(), Regex::new(r" {2,}").unwrap()));
    let out = comma.replace_all(&out, "$1").into_owned();
    spaces.replace_all(&out, " ").into_owned()
}

#[cfg(test)]
mod tests {
    use super::speech_text;

    #[test]
    fn rewrites_forms() {
        assert_eq!(speech_text("wait 5ms, e.g. a → b"), "wait 5 milliseconds, for example, a to b");
        assert_eq!(speech_text("in the 90s and 5s later"), "in the 90s and 5s later");
        assert_eq!(speech_text("wait 5s now"), "wait 5 seconds now");
        assert_eq!(speech_text("v0.14 and 1.2.3"), "version 0 point 14 and 1 point 2 point 3");
        assert_eq!(speech_text("/v1/orders"), "/v1/orders");
        assert_eq!(speech_text("plain words"), "plain words");
    }
}
