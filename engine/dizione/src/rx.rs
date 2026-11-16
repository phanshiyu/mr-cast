//! Python's `re` calls over fancy-regex: `sub` with a function, `search`, `match` (anchored at the start),
//! `fullmatch`, `findall` and `split`. Offsets are bytes; callers that need Python's character offsets convert.

use fancy_regex::{Captures, Regex};

pub struct Re {
    re: Regex,
    anchored: Regex,
    full: Regex,
}

/// A pattern written for Python's `re`; panics on one fancy-regex cannot compile (the tests compile them all).
pub fn re(pattern: &str) -> Re {
    let build = |p: String| {
        fancy_regex::RegexBuilder::new(&p).backtrack_limit(10_000_000).build().unwrap_or_else(|e| panic!("{p}: {e}"))
    };
    Re {
        re: build(pattern.to_string()),
        anchored: build(format!(r"\A(?:{pattern})")),
        full: build(format!(r"\A(?:{pattern})\z")),
    }
}

/// A match: its groups by number or name, with byte offsets into the text it was found in.
pub struct M<'t> {
    pub caps: Captures<'t>,
    pub text: &'t str,
}

impl<'t> M<'t> {
    pub fn group(&self, i: usize) -> Option<&'t str> {
        self.caps.get(i).map(|m| m.as_str())
    }

    /// The group, or "" when it did not take part.
    pub fn g(&self, i: usize) -> &'t str {
        self.group(i).unwrap_or("")
    }

    pub fn name(&self, name: &str) -> Option<&'t str> {
        self.caps.name(name).map(|m| m.as_str())
    }

    pub fn n(&self, name: &str) -> &'t str {
        self.name(name).unwrap_or("")
    }

    pub fn all(&self) -> &'t str {
        self.caps.get(0).unwrap().as_str()
    }

    pub fn start(&self) -> usize {
        self.caps.get(0).unwrap().start()
    }

    pub fn end(&self) -> usize {
        self.caps.get(0).unwrap().end()
    }

    pub fn end_of(&self, i: usize) -> Option<usize> {
        self.caps.get(i).map(|m| m.end())
    }

    pub fn name_start(&self, name: &str) -> Option<usize> {
        self.caps.name(name).map(|m| m.start())
    }

    /// The text before the match.
    pub fn before(&self) -> &'t str {
        &self.text[..self.start()]
    }

    /// The text after the match.
    pub fn after(&self) -> &'t str {
        &self.text[self.end()..]
    }

    /// Every group from 1, as Python's `match.groups()`.
    pub fn groups(&self) -> Vec<Option<&'t str>> {
        (1..self.caps.len()).map(|i| self.group(i)).collect()
    }
}

impl Re {
    /// `re.sub(pattern, f, text)`.
    pub fn sub(&self, text: &str, mut f: impl FnMut(&M) -> String) -> String {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for caps in self.re.captures_iter(text) {
            let caps = caps.unwrap_or_else(|e| panic!("{}: {e}", self.re.as_str()));
            let m = M { caps, text };
            out.push_str(&text[last..m.start()]);
            out.push_str(&f(&m));
            last = m.end();
        }
        out.push_str(&text[last..]);
        out
    }

    /// `re.sub` with a replacement string that names groups as `\1`.
    pub fn sub_str(&self, text: &str, replacement: &str) -> String {
        self.sub(text, |m| {
            let mut out = String::new();
            let mut chars = replacement.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\\'
                    && let Some(d) = chars.peek().and_then(|d| d.to_digit(10))
                {
                    chars.next();
                    out.push_str(m.g(d as usize));
                } else {
                    out.push(c);
                }
            }
            out
        })
    }

    pub fn search<'t>(&self, text: &'t str) -> Option<M<'t>> {
        self.re.captures(text).unwrap_or_else(|e| panic!("{e}")).map(|caps| M { caps, text })
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.re.is_match(text).unwrap_or_else(|e| panic!("{e}"))
    }

    /// `re.match`: anchored at the start of `text`.
    pub fn at_start<'t>(&self, text: &'t str) -> Option<M<'t>> {
        self.anchored.captures(text).unwrap_or_else(|e| panic!("{e}")).map(|caps| M { caps, text })
    }

    pub fn full_match(&self, text: &str) -> bool {
        self.full.is_match(text).unwrap_or_else(|e| panic!("{e}"))
    }

    /// Every match.
    pub fn iter<'t>(&self, text: &'t str) -> Vec<M<'t>> {
        self.re.captures_iter(text).map(|c| M { caps: c.unwrap_or_else(|e| panic!("{e}")), text }).collect()
    }

    /// `re.findall` for a pattern without groups.
    pub fn findall<'t>(&self, text: &'t str) -> Vec<&'t str> {
        self.re.find_iter(text).map(|m| m.unwrap_or_else(|e| panic!("{e}")).as_str()).collect()
    }

    /// The last piece of `re.split(pattern, text)`.
    pub fn last_piece<'t>(&self, text: &'t str) -> &'t str {
        let end = self.re.find_iter(text).filter_map(|m| m.ok()).last().map_or(0, |m| m.end());
        &text[end..]
    }
}
