//! Python's `str` predicates and slicing, which the rules are written in: indices count characters, not bytes, and
//! `isalpha`, `isdigit`, `isupper` follow Python's Unicode definitions.

use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

/// `char.isalpha()`: letters (categories L*).
pub fn is_alpha(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphabetic();
    }
    matches!(
        c.general_category(),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
    )
}

/// `char.isdigit()`: decimal digits and the other digits (superscripts, circled digits).
pub fn is_digit(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_digit();
    }
    c.general_category() == GeneralCategory::DecimalNumber
        || (c.general_category() == GeneralCategory::OtherNumber && c.is_ascii_digit())
        || matches!(c, '²' | '³' | '¹' | '⁰'..='⁹' | '₀'..='₉' | '①'..='⑨')
}

/// `char.isalnum()`: a letter or any number.
pub fn is_alnum(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphanumeric();
    }
    is_alpha(c)
        || matches!(
            c.general_category(),
            GeneralCategory::DecimalNumber | GeneralCategory::LetterNumber | GeneralCategory::OtherNumber
        )
}

/// `char.isspace()`.
pub fn is_space(c: char) -> bool {
    c.is_whitespace() || matches!(c, '\u{1c}'..='\u{1f}')
}

fn cased(c: char) -> bool {
    c.is_uppercase() || c.is_lowercase() || c.general_category() == GeneralCategory::TitlecaseLetter
}

/// `str.isupper()`: at least one cased character, and none in lower case.
pub fn str_is_upper(s: &str) -> bool {
    let mut any = false;
    for c in s.chars() {
        if c.is_lowercase() || c.general_category() == GeneralCategory::TitlecaseLetter {
            return false;
        }
        any |= cased(c);
    }
    any
}

/// `str.islower()`.
pub fn str_is_lower(s: &str) -> bool {
    let mut any = false;
    for c in s.chars() {
        if c.is_uppercase() || c.general_category() == GeneralCategory::TitlecaseLetter {
            return false;
        }
        any |= cased(c);
    }
    any
}

/// `char.isupper()`.
pub fn is_upper(c: char) -> bool {
    c.is_uppercase()
}

pub fn str_is_alpha(s: &str) -> bool {
    !s.is_empty() && s.chars().all(is_alpha)
}

pub fn str_is_digit(s: &str) -> bool {
    !s.is_empty() && s.chars().all(is_digit)
}

/// `str.strip()`.
pub fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

pub fn lstrip(s: &str) -> &str {
    s.trim_start_matches(is_space)
}

pub fn rstrip(s: &str) -> &str {
    s.trim_end_matches(is_space)
}

pub fn lower(s: &str) -> String {
    s.to_lowercase()
}

pub fn upper(s: &str) -> String {
    s.to_uppercase()
}

/// `len(s)`.
pub fn len(s: &str) -> usize {
    s.chars().count()
}

/// The byte offset of character `i` (or the end).
pub fn byte_at(s: &str, i: usize) -> usize {
    s.char_indices().nth(i).map_or(s.len(), |(b, _)| b)
}

/// `s[a:b]` with character indices clamped as Python clamps them (no negative indices).
pub fn slice(s: &str, a: usize, b: usize) -> &str {
    if a >= b {
        return "";
    }
    let start = byte_at(s, a);
    let end = byte_at(s, b);
    if start >= end { "" } else { &s[start..end] }
}

/// `s[-n:]`.
pub fn last_chars(s: &str, n: usize) -> &str {
    let count = len(s);
    if n >= count { s } else { &s[byte_at(s, count - n)..] }
}

/// `s[:-n]` (or "" when n is the whole length or more).
pub fn drop_last(s: &str, n: usize) -> &str {
    let count = len(s);
    if n >= count { "" } else { &s[..byte_at(s, count - n)] }
}

/// `s[n:]`.
pub fn drop_first(s: &str, n: usize) -> &str {
    &s[byte_at(s, n)..]
}

/// `s[i]`, or None past the end.
pub fn char_at(s: &str, i: usize) -> Option<char> {
    s.chars().nth(i)
}

/// The character just before byte offset `b`.
pub fn char_before(s: &str, b: usize) -> Option<char> {
    s[..b].chars().next_back()
}

/// The character at byte offset `b`.
pub fn char_from(s: &str, b: usize) -> Option<char> {
    s[b..].chars().next()
}

/// The first character, as Python's `s[0]` (callers check the string is not empty).
pub fn first(s: &str) -> char {
    s.chars().next().unwrap_or('\0')
}
