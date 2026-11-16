//! Text -> the words to say and the punctuation marks between them (dizione/normalize.py).
//!
//! Everything that is not a plain word is turned into words here, by rule: numbers, money, dates, times,
//! telephone numbers, units, abbreviations, initialisms, symbols, chat spellings, versions, codes, web addresses
//! and file names. Emoticons and emoji are dropped. Each function mirrors the Python one of the same name; the
//! regular expressions are the Python ones, and Python's character offsets are kept where the rules count.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use unicode_normalization::UnicodeNormalization;

use crate::convert::{convert, from_text, is_arpabet};
use crate::py;
use crate::rx::{M, Re, re};
use crate::symbols::{Phones, p};
use crate::tables;

/// A word to say.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    /// Letters and apostrophes, lower case.
    pub text: String,
    /// Continues the previous word (a hyphenated compound, parts of one token).
    pub attach: bool,
    /// As written.
    pub raw: String,
    /// Read letter by letter.
    pub spell: bool,
    /// A pronunciation given inline by the user.
    pub phones: Option<Phones>,
}

impl Word {
    fn new(text: &str, raw: &str) -> Word {
        Word { text: text.to_string(), attach: false, raw: raw.to_string(), spell: false, phones: None }
    }

    fn spelled(text: &str, raw: &str) -> Word {
        Word { spell: true, ..Word::new(text, raw) }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Token {
    Word(Word),
    Punct(String),
}

// Private-use characters that carry decisions through the rewriting of the text.
const SPELL: char = '\u{E000}';
const END: char = '\u{E001}';
const INLINE: char = '\u{E003}';
const INLINE_BASE: u32 = 0xE100;
const FORMULA_SIGN: char = '\u{E004}';
const ANGLE_MARK: char = '\u{E005}';
const IS: char = '\u{E006}';

const PUNCTUATION: [&str; 12] = [",", ".", "?", "!", ";", ":", "\"", "'", "(", ")", "—", "…"];
const ONES: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const TENS: [&str; 8] = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [&str; 6] = ["thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTH_PATTERN: &str = "January|February|March|April|May|June|July|August|September|October|November|December\
                             |Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const DAY_PATTERN: &str =
    "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Thurs|Thur|Tues|Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const CURRENCY_CODES: &str = "USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY";
const ZONES: &str = "ET|CT|MT|PT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|GMT|UTC|BST|CET|CEST|IST|AEST|AEDT|JST";
const SIZES: &str = "XXXL|XXL|XXS|XL|XS|S|M|L";
const LENGTHS: &str = "mm|cm|km|m|ft|in|inch|inches|feet|foot|metres?|meters?|yards?|yd|px|pixels?";
const VERSIONED: &str = "version|ver|release|firmware|patch|kernel|build|python|node|nodejs|ios|ipados|macos|watchos|\
tvos|android|chrome|firefox|safari|java|php|ruby|rust|swift|kotlin|golang|django|rails|react|angular|vue|docker|\
kubernetes|ubuntu|debian|fedora|windows|linux|postgres|postgresql|mysql|redis|numpy|pytorch|tensorflow|cuda|\
xcode|gcc|clang|unity|minecraft|typescript|bluetooth|usb|hdmi|opengl|vulkan|directx|\
upgrade[ds]?|update[ds]?|downgrade[ds]?";
const HALF_DAY: &str = r"(?:\s?([AaPp])\.[Mm]\.?|\s?([AaPp])[Mm]\b)";
const SIGN: &str = r"[<>+*/^≤≥≠≈×÷±]";
const SPACED_SIGN: &str = r" [<>+*≤≥≠≈×÷±] ";
const NO_PHRASE: &str = r"(?![\w'’-]|\s+(?!(?:and|or|then|if|when|where|while|for|is|are|was|but|so|in|to)\b)[A-Za-z])";

fn set(words: &'static str) -> HashSet<&'static str> {
    words.split_whitespace().collect()
}

struct Sets {
    initialisms: HashSet<&'static str>,
    sounds: HashSet<&'static str>,
    clause_openers: HashSet<&'static str>,
    sentence_starters: HashSet<&'static str>,
    year_context: HashSet<&'static str>,
    cardinal_after: HashSet<&'static str>,
    labelled: HashSet<&'static str>,
    phone_words: HashSet<&'static str>,
    phone_links: HashSet<&'static str>,
    pin_words: HashSet<&'static str>,
    strong_words: HashSet<&'static str>,
    weak_words: HashSet<&'static str>,
    link_words: HashSet<&'static str>,
    not_counted: HashSet<&'static str>,
    numbered: HashSet<&'static str>,
    date_before: HashSet<&'static str>,
    ratio_words: HashSet<&'static str>,
    duration_words: HashSet<&'static str>,
    clock_words: HashSet<&'static str>,
    capital_words: HashSet<&'static str>,
    short_words: HashSet<&'static str>,
    leading_apostrophe: HashSet<&'static str>,
}

static SETS: LazyLock<Sets> = LazyLock::new(|| Sets {
    initialisms: set("US IT AI ID UN EU UK LA AD BC AM PM OS PE PA MA LED SAT RIP ER"),
    sounds: set("sh shh ss zz hm hmm mm tsk psst pfft hmph psh pssh"),
    clause_openers: set(
        "if elif while when whenever where whether that because since as and or but so then think thinks thought \
         know knows say says said suppose assume means implies hence thus therefore although though unless until \
         once else also clearly obviously indeed here now again first next finally similarly otherwise however \
         moreover",
    ),
    sentence_starters: set(
        "the he she it i we they this that there but and in on at a an if when what why how who my our you then so \
         now after before however",
    ),
    year_context: set(
        "in since by from until till before after during around circa of year early late mid summer winter spring \
         fall autumn class",
    ),
    cardinal_after: set(
        "war chapter part book volume act scene section phase type class level stage title article appendix world",
    ),
    labelled: set(
        "plan vitamin grade type option class section part team group exhibit appendix point model series hepatitis \
         level",
    ),
    phone_words: set("call dial ring phone telephone tel mobile cell fax hotline text sms whatsapp"),
    phone_links: set("to on at or us me him her them back"),
    pin_words: set("code pin extension ext passcode password zip postcode cvv cvc otp"),
    strong_words: set("number id reference ref serial account tracking booking confirmation"),
    weak_words: set(
        "order ticket invoice case claim policy receipt transaction parcel shipment container payment reservation \
         membership customer batch lot item job issue bug request",
    ),
    link_words: set("is was are were ends ending in with starts starting begins beginning"),
    not_counted: set(
        "is was has does goes ships arrives departs leaves shows needs blocks remains includes contains says reads \
         starts ends closes opens runs takes comes this his its us as yes plus minus less",
    ),
    numbered: set(
        "ref reference serial account order invoice tracking part model phone tel fax id room flight case ticket \
         policy licence license booking customer vat tax reg registration",
    ),
    date_before: set(
        "on dated due until till by since from before after for shipped delivered arriving arrives arrive arrived \
         expires expired ends ending starts starting begins beginning monday tuesday wednesday thursday friday \
         saturday sunday mon tue tues wed thu thur thurs fri sat sun",
    ),
    ratio_words: set("ratio ratios scale odds aspect mix split proportion"),
    duration_words: set("lasted took duration runtime recording video clip track lap pace length long"),
    clock_words: set(
        "window slot open opens opening hours shift session served service available booked appointment delivery \
         arrive arrives arriving",
    ),
    capital_words: set(
        "IN ON AT TO OF BY OR IS AS IF NO SO WE HE MY ME DO GO UP AN AM PM BE IT US THE AND FOR BUT NOT ALL",
    ),
    short_words: set("my to in on of go up no do me we us it is at by be so or an as if he hi ok"),
    leading_apostrophe: set("'em 'tis 'twas 'til 'cause 'bout 'round 'n"),
});

const CLASSIC_FRACTIONS: [i128; 11] = [2, 3, 4, 5, 6, 8, 10, 16, 32, 64, 100];

fn roman(raw: &str) -> Option<i128> {
    Some(match raw {
        "II" => 2,
        "III" => 3,
        "IV" => 4,
        "VI" => 6,
        "VII" => 7,
        "VIII" => 8,
        "IX" => 9,
        "XI" => 11,
        "XII" => 12,
        "XIII" => 13,
        "XIV" => 14,
        "XV" => 15,
        "XVI" => 16,
        "XVIII" => 18,
        "XX" => 20,
        _ => return None,
    })
}

fn month_number(key: &str) -> Option<usize> {
    MONTHS.iter().position(|m| py::lower(m)[..3] == *key).map(|i| i + 1)
}

fn day_name(key: &str) -> Option<&'static str> {
    Some(match key {
        "mon" => "Monday",
        "tue" => "Tuesday",
        "wed" => "Wednesday",
        "thu" => "Thursday",
        "fri" => "Friday",
        "sat" => "Saturday",
        "sun" => "Sunday",
        _ => return None,
    })
}

/// (one, many, cent, cents) for a currency sign or code.
fn currency(symbol: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match symbol {
        "$" | "USD" => ("dollar", "dollars", "cent", "cents"),
        "£" | "GBP" => ("pound", "pounds", "penny", "pence"),
        "€" | "EUR" => ("euro", "euros", "cent", "cents"),
        "¥" | "JPY" => ("yen", "yen", "", ""),
        "₹" | "INR" => ("rupee", "rupees", "paisa", "paise"),
        "CHF" => ("Swiss franc", "Swiss francs", "centime", "centimes"),
        "CAD" => ("Canadian dollar", "Canadian dollars", "cent", "cents"),
        "AUD" => ("Australian dollar", "Australian dollars", "cent", "cents"),
        _ => ("yuan", "yuan", "", ""),
    }
}

fn scale_letter(s: &str) -> Option<&'static str> {
    Some(match s {
        "k" => "thousand",
        "m" => "million",
        "b" | "bn" => "billion",
        "t" => "trillion",
        _ => return None,
    })
}

const SYMBOL_WORDS: [(char, &str); 19] = [
    ('&', "and"),
    ('@', "at"),
    ('+', "plus"),
    ('=', "equals"),
    ('%', "percent"),
    ('×', "times"),
    ('÷', "divided by"),
    ('±', "plus or minus"),
    ('©', "copyright"),
    ('§', "section"),
    ('°', "degrees"),
    ('≥', "greater than or equal to"),
    ('≤', "less than or equal to"),
    ('≠', "not equal to"),
    ('≈', "approximately"),
    ('∞', "infinity"),
    ('√', "square root of"),
    ('π', "pi"),
    ('\0', ""),
];

fn separator(piece: &str) -> &'static str {
    match piece {
        "." => "dot",
        "/" => "slash",
        "@" => "at",
        "-" => "dash",
        "_" => "underscore",
        ":" => "colon",
        "=" => "equals",
        "&" => "and",
        "+" => "plus",
        _ => "",
    }
}

const ACCENT_DECIDES: [(&str, &str); 8] = [
    ("résumé", "R EH1 Z AH0 M EY2"),
    ("resumé", "R EH1 Z AH0 M EY2"),
    ("exposé", "EH2 K S P OW0 Z EY1"),
    ("rosé", "R OW0 Z EY1"),
    ("pâté", "P AA0 T EY1"),
    ("maté", "M AA1 T EY2"),
    ("saké", "S AA1 K EY2"),
    ("lamé", "L AA0 M EY1"),
];

/// Python's `re.escape`.
fn py_escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if "()[]{}?*+-|^$\\.&~# \t\n\r\u{b}\u{c}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

// ---- the expressions --------------------------------------------------------

macro_rules! rx {
    ($name:ident, $pattern:expr) => {
        static $name: LazyLock<Re> = LazyLock::new(|| re(&$pattern));
    };
}

rx!(COMPARED, r"(?P<gap>[ \t]?)(?P<sign>>=|<=|!=|[<>≥≤≠])(?P=gap)");
rx!(VALUE_BEFORE, r"(?:(?<![\w.,])\d[\d.,]*%?|(?<![\w'’.-])[A-Za-z]|[)\]])$");
rx!(VALUE_AFTER, r"(?:[-+]?[$£€¥₹]?\d[\d.,]*%?(?!\w)|\.\d|[A-Za-z](?![\w'’])|[(\[])");
static LETTER_PLACES: LazyLock<Vec<Re>> = LazyLock::new(|| {
    [
        format!(r"(?<![\w'’.-])(?P<letter>[Aakur])(?={IS}?\s?[<>!=]?=)"),
        format!(r"[<>!=]?=\s?(?P<letter>[Aakur]){NO_PHRASE}"),
        format!(r"(?<![\w'’.-])(?P<letter>[Aakur])(?={IS}?{SIGN}(?:[\w($]|\.\d))"),
        format!(r"(?<=[\w){IS}]{SIGN})(?<![Ww]/)(?P<letter>[Aakur])(?![\w'’-])"),
        format!(r"(?<![\w'’.-])(?P<letter>[Aakur])(?={IS}?{SPACED_SIGN}(?:[A-Za-z]|\d[\d.,]*)(?![\w'’]))"),
        format!(r"(?<![\w'’.])(?:[A-Za-z]|\d[\d.,]*){IS}?{SPACED_SIGN}(?P<letter>[Aakur]){NO_PHRASE}"),
        r"(?<=\()(?P<letter>[Aakur])(?=\)|, )".to_string(),
        r"(?<=, )(?P<letter>[Aakur])(?=\))".to_string(),
        r"(?:(?<=\s)|^)(?P<letter>[akur])(?=\)\s)".to_string(),
    ]
    .iter()
    .map(|p| re(p))
    .collect()
});
rx!(
    ANGLES,
    format!(
        r"(?<![\w){END}{IS}])<[A-Za-z0-9/!?][^<>(){{}}+*;|\n]*>|(?<=[\w{END}{IS}])<[^<>(){{}}+*;|\n]{{1,80}}>(?![\w$])|</?[A-Za-z][\w-]+/?>"
    )
);
rx!(JOINED_COMPARISON, format!(r"(?<=[\w){END}{IS}])[<>](?=[\w({SPELL}]|\.\d| minus \d)"));
rx!(FIGURE_BEFORE, r"(?<![\w.,])\d[\d.,]*%?$");
rx!(FIGURE_AFTER, r"(?:\d[\d.,]*%?(?!\w)|\.\d| minus \d)");
rx!(LETTER_BEFORE, format!(r"(?:(?<![\w'’.])[A-Za-z]|[){END}])$"));
rx!(LETTER_AFTER, format!(r"(?:[A-Za-z](?![\w'’])|[({SPELL}])"));
rx!(EMOJI, "[\u{1F000}-\u{1FAFF}☀-➿\u{1F1E6}-\u{1F1FF}←-⇿⬀-⯿\u{FE0F}\u{200D}\u{20E3}]+");
rx!(
    EMOTICON,
    r#"(?<![A-Za-z0-9])(?:[:;=]['^-]?[DPpOo3|/\\*\]\[}{><]+|[)(\]\[][-^']?[:;=]|<3+|</3|\^_?\^|-_-|[oO]_[oO]|>_<|T_T|\\o/|:'[()])(?![A-Za-z0-9])|[:;]['^-]?[)(]+|(?<![A-Za-z0-9)])=['^-]?[)(]+|=['^-]?[)(]+(?![A-Za-z0-9(.$-])|(?<=[A-Za-z]{2})<3+(?![.,]?\d)"#
);
const AMOUNT: &str = r"(?P<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?P<fraction>\d+))?";
rx!(
    MONEY,
    format!(
        r"(?:(?<![\w.])(?P<minus>-)\s?)?(?P<symbol>[$£€¥₹]|(?<![A-Za-z])(?:{CURRENCY_CODES})(?![A-Za-z]))\s?(?P<inner>-)?{AMOUNT}(?:\s?(?P<scale>thousand|million|billion|trillion|bn|[kKmMbB])(?![A-Za-z]))?"
    )
);
fn sign_after() -> String {
    format!(r"[$£€¥₹](?![\w$£€¥₹])|(?:{CURRENCY_CODES})(?![A-Za-z])")
}
rx!(
    MONEY_AFTER,
    format!(
        r"(?:(?<![\w.])(?P<minus>-)\s?)?(?<![\w.,^])(?P<whole>\d{{1,3}}(?:,\d{{3}})+|[1-9]\d{{0,2}}(?: \d{{3}})+|\d+)(?:\.(?P<fraction>\d+))?\s?(?P<symbol>{})",
        sign_after()
    )
);
rx!(RANGE_BEFORE_SIGN, format!(r"(?<![\w.,-])(\d[\d,]*(?:\.\d+)?)-(?=\d[\d,]*(?:\.\d+)?\s?(?:{}))", sign_after()));
rx!(CONTINENTAL, r"(?<![\w.,])([1-9]\d{0,2}(?:\.\d{3})+),(\d{1,2})(?!\d|[.,]\d)");
rx!(COMMA_AFTER_SIGN, format!(r"((?:[$£€¥₹]|(?<![A-Za-z])(?:{CURRENCY_CODES}))\s?-?\d+),(\d{{1,2}})(?!\d|[.,]\d)"));
rx!(COMMA_BEFORE_SIGN, format!(r"(?<![\w.,])(\d+),(\d{{1,2}})(?=\s?(?:%|{}))", sign_after()));
rx!(
    FORMULA_END,
    r"(?<![\w$])(?<!\d\s)\$(?:(?=[^\s\d$.,;:!?)])[^$\n]{0,80}|(?=\d)[^$\n]{0,80}[=^_\\{}+*/<>][^$\n]{0,80}|(?=\s)[^$\n]{0,80}[=^_\\{}+*<>][^$\n]{0,80})\d\s?\$(?![\w$])"
);
rx!(VULGAR, r"(?<![\d.,/])(?:(\d+)\s?)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])");
rx!(
    ADDRESS,
    r#"(?P<url>(?:https?://|www\.)[^\s<>"']+)|(?P<mail>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(?P<file>(?<![\w@./-])(?P<folder>/?(?:[\w~-]+/)+)?(?P<stem>[\w-]+(?:\.[\w-]+)*)\.(?P<ending>[A-Za-z][A-Za-z0-9]{0,9})(?![\w-])(?P<path>/[^\s<>"']*)?)"#
);
rx!(DAY_RANGE, format!(r"\b({DAY_PATTERN}|{MONTH_PATTERN})\b(\.?)\s?[-–]\s?({DAY_PATTERN}|{MONTH_PATTERN})\b(\.?)"));
rx!(RATIO, r"(?<![\d:.,])(\d{1,3}):(\d{1,3}(?:,\d{3})+|\d+)(?![\d:]|[.,]\d)");
rx!(CODE, r"(?<![\w.,/-])(#)?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)(?![\w-]|[.,]\d)");
rx!(SLASHED, r"(?<![\w.,/-])(\d+(?:/\d+){2,})(?![\w/]|[.,]\d)");
rx!(
    GROUPED,
    r"(?<![\w.,:/#+-])(?P<plus>\+)?(?:(?P<lead>[A-Z]{2}) )?(?P<core>[A-Z0-9]*\d[A-Z0-9]*(?: [A-Z0-9]*\d[A-Z0-9]*)+)(?(<lead>)(?: (?P<trail>[A-Z]{2})(?![\w]))?)(?![\w]|[.,:/-]\d|\s?[%°])"
);
rx!(GLUED, r"(?<![\w'.])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+(?![\w']|\.\d)");
rx!(ACCENTED, format!(r"(?i)\b({})(s?)\b", ACCENT_DECIDES.map(|(w, _)| w).join("|")));

rx!(CLAUSE_SPLIT, r#"[.!?;…]\s|[()"]"#);
rx!(LETTERS, r"[A-Za-z]+");
rx!(WORD_AFTER, r"\s*([A-Za-z]+)");
rx!(FIRST_WORD, r"[A-Za-z']+");
rx!(DECIMAL_COMMA, r"\d+,\d{1,2}");
rx!(RUNS, r"[A-Za-z]+|\d+");
rx!(ADDRESS_PIECES, r"[A-Za-z]+|\d+|.");
rx!(CAMEL_PARTS, r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])");
rx!(URL_HEAD, r"^(?:https?://)?(?:www\.)?");
rx!(INLINE_BRACES, r"([A-Za-z']+)?\{([^{}]*)\}");
rx!(DIGIT_ANY, r"\d");
rx!(COMPARISON_ANY, r"[<>≥≤≠]|!=");
rx!(CLOCK_ZONE, format!(r"({CLOCK})\s({ZONES})\b"));
const CLOCK: &str = r"\d{1,2}:[0-5]\d(?:\s?[AaPp]\.?[Mm]\.?)?|\b\d{1,2}\s?[AaPp]\.?[Mm]\.?";

// ---- numbers as words -------------------------------------------------------

/// The value of a run of digits (ASCII, or other decimal digits).
fn int(text: &str) -> i128 {
    let mut n: i128 = 0;
    for c in text.chars() {
        if let Some(d) = digit_value(c) {
            n = n.saturating_mul(10).saturating_add(d as i128);
        }
    }
    n
}

fn digit_value(c: char) -> Option<u32> {
    if c.is_ascii_digit() {
        return c.to_digit(10);
    }
    // Other decimal digits (Nd) come in runs of ten, from their zero; superscripts are the other digits.
    match c {
        '¹' => return Some(1),
        '²' => return Some(2),
        '³' => return Some(3),
        '⁰' | '⁴'..='⁹' => return Some((c as u32 - '⁰' as u32) % 10),
        _ => {}
    }
    if !py::is_digit(c) {
        return None;
    }
    let mut zero = c as u32;
    while zero > 0 && (c as u32 - (zero - 1)) < 10 && char::from_u32(zero - 1).is_some_and(py::is_digit) {
        zero -= 1;
    }
    Some(c as u32 - zero)
}

/// `cardinal(int(text))` for a run of digits of any length.
fn cardinal_text(text: &str) -> String {
    let stripped = text.trim_start_matches('0');
    if stripped.chars().count() > 21 {
        return digits(stripped, "zero");
    }
    cardinal(int(text))
}

pub fn cardinal(number: i128) -> String {
    if number < 0 {
        return format!("minus {}", cardinal(-number));
    }
    if number < 20 {
        return ONES[number as usize].to_string();
    }
    if number < 100 {
        let (tens, ones) = (number / 10, number % 10);
        let mut s = TENS[tens as usize - 2].to_string();
        if ones != 0 {
            s.push(' ');
            s.push_str(ONES[ones as usize]);
        }
        return s;
    }
    if number < 1000 {
        let (hundreds, rest) = (number / 100, number % 100);
        let mut s = format!("{} hundred", ONES[hundreds as usize]);
        if rest != 0 {
            s.push(' ');
            s.push_str(&cardinal(rest));
        }
        return s;
    }
    if number >= 1000i128.pow(SCALES.len() as u32 + 1) {
        return digits(&number.to_string(), "zero");
    }
    let mut parts = Vec::new();
    let mut number = number;
    for power in (1..=SCALES.len()).rev() {
        let unit = 1000i128.pow(power as u32);
        let count = number / unit;
        number %= unit;
        if count != 0 {
            parts.push(format!("{} {}", cardinal(count), SCALES[power - 1]));
        }
    }
    if number != 0 {
        parts.push(cardinal(number));
    }
    parts.join(" ")
}

fn ordinal_words(words: String) -> String {
    let mut words: Vec<String> = words.split(' ').map(String::from).collect();
    let last = words.pop().unwrap();
    let ord = match last.as_str() {
        "one" => "first".to_string(),
        "two" => "second".into(),
        "three" => "third".into(),
        "five" => "fifth".into(),
        "eight" => "eighth".into(),
        "nine" => "ninth".into(),
        "twelve" => "twelfth".into(),
        _ if last.ends_with('y') => format!("{}ieth", &last[..last.len() - 1]),
        _ => format!("{last}th"),
    };
    words.push(ord);
    words.join(" ")
}

pub fn ordinal(number: i128) -> String {
    ordinal_words(cardinal(number))
}

pub fn digits(text: &str, zero: &str) -> String {
    text.chars()
        .filter(|&c| py::is_digit(c))
        .map(|c| match digit_value(c).unwrap_or(0) {
            0 => zero,
            d => ONES[d as usize],
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The way a year is said: 1984, 1905, 1900, 2005, 2026.
pub fn year(number: i128) -> String {
    if !(1000..=2999).contains(&number) {
        return cardinal(number);
    }
    let (high, low) = (number / 100, number % 100);
    if low == 0 {
        return if high % 10 == 0 { cardinal(number) } else { format!("{} hundred", cardinal(high)) };
    }
    if high == 20 && low < 10 {
        return format!("two thousand {}", ONES[low as usize]);
    }
    if low < 10 {
        format!("{} oh {}", cardinal(high), ONES[low as usize])
    } else {
        format!("{} {}", cardinal(high), cardinal(low))
    }
}

/// A number read two digits at a time, as model numbers are.
fn pairs(number: i128) -> String {
    let (high, low) = (number / 100, number % 100);
    if !(100..=9999).contains(&number) || (low == 0 && (high < 10 || high % 10 == 0)) {
        return cardinal(number);
    }
    if low == 0 {
        return format!("{} hundred", cardinal(high));
    }
    if low < 10 {
        format!("{} oh {}", cardinal(high), ONES[low as usize])
    } else {
        format!("{} {}", cardinal(high), cardinal(low))
    }
}

/// An unsigned number as written: 1,234, 3.14, 007.
pub fn number_words(text: &str) -> String {
    let plain = text.replace(',', "");
    let (whole, fraction) = plain.split_once('.').unwrap_or((&plain, ""));
    if !fraction.is_empty() {
        let head = if whole.is_empty() { String::new() } else { cardinal_text(whole) };
        return format!("{head} point {}", digits(fraction, "zero"));
    }
    let n = py::len(whole);
    if (n > 1 && whole.starts_with('0')) || n > 18 {
        return digits(whole, "zero");
    }
    cardinal_text(whole)
}

fn duration(hours: i128, minutes: i128, seconds: i128) -> String {
    let parts: Vec<String> = [(hours, "hour"), (minutes, "minute"), (seconds, "second")]
        .iter()
        .filter(|(count, _)| *count != 0)
        .map(|(count, name)| format!("{} {}{}", cardinal(*count), name, if *count == 1 { "" } else { "s" }))
        .collect();
    match parts.len() {
        0 => "zero seconds".into(),
        1 => parts[0].clone(),
        n => format!("{} and {}", parts[..n - 1].join(", "), parts[n - 1]),
    }
}

fn plural_of(words: &str) -> String {
    let (head, last) = words.rsplit_once(' ').map_or(("", words), |(h, l)| (h, l));
    let last = if let Some(stem) = last.strip_suffix('y') { format!("{stem}ies") } else { format!("{last}s") };
    if head.is_empty() { last } else { format!("{head} {last}") }
}

fn fraction_words(top: i128, bottom: i128, article: bool) -> String {
    let (one, many) = match bottom {
        2 => ("half".to_string(), "halves".to_string()),
        4 => ("quarter".into(), "quarters".into()),
        _ => (ordinal(bottom), format!("{}s", ordinal(bottom))),
    };
    if top != 1 {
        return format!("{} {many}", cardinal(top));
    }
    let lead = if article { if "aeiou".contains(py::first(&one)) { "an " } else { "a " } } else { "one " };
    format!("{lead}{one}")
}

fn version_part(part: &str) -> String {
    if py::len(part) > 2 { digits(part, "zero") } else { number_words(part) }
}

fn minor(part: &str) -> String {
    if part.starts_with('0') { digits(part, "oh") } else { cardinal_text(part) }
}

fn short_number(text: &str) -> bool {
    if text.starts_with('0') {
        return false;
    }
    py::len(text) <= 2 || py::drop_first(text, 1).chars().all(|c| c == '0') && py::len(text) > 1
}

fn spelled(letters: &str) -> String {
    format!("{SPELL}{letters}{END}")
}

/// The words just before byte offset `position` in the same clause, in lower case.
fn before_words(text: &str, position: usize, count: usize) -> Vec<String> {
    let window = py::last_chars(&text[..position], 80);
    let clause = CLAUSE_SPLIT.last_piece(window);
    let words: Vec<String> = LETTERS.findall(clause).into_iter().map(py::lower).collect();
    let skip = words.len().saturating_sub(count);
    words[skip..].to_vec()
}

fn identifier(text: &str, position: usize) -> Option<&'static str> {
    let words = before_words(text, position, 4);
    let s = &*SETS;
    let last = words.last()?.as_str();
    let n = words.len();
    if s.phone_words.contains(last)
        || (s.phone_links.contains(last)
            && words[n.saturating_sub(3)..n - 1].iter().any(|w| s.phone_words.contains(w.as_str())))
    {
        return Some("phone");
    }
    let mut index = n - 1;
    while index > 0 && s.link_words.contains(words[index].as_str()) {
        index -= 1;
    }
    for (kind, group) in
        [("phone", &s.phone_words), ("pin", &s.pin_words), ("strong", &s.strong_words), ("weak", &s.weak_words)]
    {
        if group.contains(words[index].as_str()) {
            return Some(kind);
        }
    }
    if last == "enter" { Some("enter") } else { None }
}

fn decimal_comma(text: &str) -> String {
    if DECIMAL_COMMA.full_match(text) { text.replace(',', ".") } else { text.to_string() }
}

fn address_digits(text: &str) -> String {
    let n = py::len(text);
    if n <= 2 && !(n == 2 && text.starts_with('0')) {
        return cardinal_text(text);
    }
    if n == 4 && (1900..=2099).contains(&int(text)) {
        return year(int(text));
    }
    digits(text, "zero")
}

fn plain_letter(c: char) -> String {
    if c.is_ascii() || !py::is_alpha(c) {
        return c.to_string();
    }
    let forms = [
        ('ß', "ss"),
        ('æ', "ae"),
        ('Æ', "Ae"),
        ('œ', "oe"),
        ('Œ', "Oe"),
        ('ø', "o"),
        ('Ø', "O"),
        ('đ', "d"),
        ('ł', "l"),
        ('Ł', "L"),
    ];
    if let Some((_, s)) = forms.iter().find(|(k, _)| *k == c) {
        return s.to_string();
    }
    let base: String = c.to_string().nfkd().filter(|x| !unicode_normalization::char::is_combining_mark(*x)).collect();
    if base.is_ascii() && py::str_is_alpha(&base) { base } else { c.to_string() }
}

/// `text` with the angle brackets that enclose something replaced by a mark, one for one, the inner ones first.
fn without_angles(text: &str) -> String {
    let mut text = text.to_string();
    while text.contains('<') && text.contains('>') {
        let marked = ANGLES.sub(&text, |m| {
            let inner = py::slice(m.all(), 1, py::len(m.all()) - 1);
            format!("{ANGLE_MARK}{inner}{ANGLE_MARK}")
        });
        if marked == text {
            break;
        }
        text = marked;
    }
    text
}

/// The character index of byte offset `b` in `s`.
fn char_index(s: &str, b: usize) -> usize {
    s[..b].chars().count()
}

/// A word just after the text: `re.match(r"[A-Za-z']+", following)` lower-cased.
fn first_word_lower(following: &str) -> Option<String> {
    FIRST_WORD.at_start(following).map(|m| py::lower(m.all()))
}

// ---- the normaliser -----------------------------------------------------------

pub struct Normalizer {
    abbreviations: HashMap<String, (String, String)>,
    units: HashMap<String, (String, String)>,
    exact_units: HashMap<String, (String, String)>,
    chat: HashMap<String, String>,
    replies: HashSet<String>,
    endings: HashMap<String, String>,
    unit: Re,
    area: Re,
    area_plain: Re,
    unit_after: Re,
    dot_times_follow: Re,
    symbols: Re,
}

/// One call's state: the inline pronunciations and what the text says about its dates.
struct Pass<'a> {
    n: &'a Normalizer,
    is_word: &'a dyn Fn(&str) -> bool,
    inline: RefCell<Vec<(String, Phones)>>,
    day_first: Cell<bool>,
    dated: Cell<bool>,
}

impl Default for Normalizer {
    fn default() -> Self {
        Self::new()
    }
}

impl Normalizer {
    pub fn new() -> Normalizer {
        let abbreviations = tables::rows(tables::ABBREVIATIONS)
            .into_iter()
            .map(|(_, c)| (c[0].clone(), (c[1].clone(), c[2].clone())))
            .collect();
        let (mut units, mut exact_units) = (HashMap::new(), HashMap::new());
        for (_, c) in tables::rows(tables::UNITS) {
            if c.len() > 3 && c[3] == "exact" {
                exact_units.insert(c[0].clone(), (c[1].clone(), c[2].clone()));
            } else {
                units.insert(py::lower(&c[0]), (c[1].clone(), c[2].clone()));
            }
        }
        let (mut chat, mut replies) = (HashMap::new(), HashSet::new());
        for (_, c) in tables::rows(tables::CHAT) {
            chat.insert(c[0].clone(), c.get(1).cloned().unwrap_or_else(|| "-".into()));
            if c.len() > 2 {
                replies.insert(c[0].clone());
            }
        }
        let endings = tables::mapping(tables::ENDINGS);
        let mut names: Vec<String> =
            units.keys().chain(exact_units.keys()).map(|u| py_escape(u)).collect::<HashSet<_>>().into_iter().collect();
        names.sort_by(|a, b| py::len(b).cmp(&py::len(a)).then(a.cmp(b)));
        let unit_names = names.join("|");
        let unit = re(&format!(
            r"(?i)(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?:[-–](\d[\d,]*(?:\.\d+)?))?\s?({unit_names})(?![A-Za-z])(\.(?=\s+(?-i:[a-z])))?"
        ));
        let area = re(r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(km|cm|mm|m|ft|mi|yd|in)([²³])");
        let area_plain = re(r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(km|cm|mm|m|ft)([23])(?![\w])");
        let unit_after = re(&format!(r"(?i)\s?(?:{unit_names})(?![A-Za-z])"));
        let dot_times_follow = re(&format!(r"(?i)\s?(?:%|percent|million|billion|{unit_names})(?![A-Za-z])"));
        let class: String =
            SYMBOL_WORDS.iter().filter(|(c, _)| *c != '\0').map(|(c, _)| py_escape(&c.to_string())).collect();
        let symbols = re(&format!("[{class}]"));
        Normalizer {
            abbreviations,
            units,
            exact_units,
            chat,
            replies,
            endings,
            unit,
            area,
            area_plain,
            unit_after,
            dot_times_follow,
            symbols,
        }
    }

    /// The words and punctuation marks of `text`. `is_word(spelling)` says whether the dictionary knows a spelling.
    pub fn tokens(&self, text: &str, is_word: &dyn Fn(&str) -> bool) -> Vec<Token> {
        let pass = Pass {
            n: self,
            is_word,
            inline: RefCell::new(Vec::new()),
            day_first: Cell::new(false),
            dated: Cell::new(false),
        };
        pass.tokens(text)
    }
}

impl Pass<'_> {
    fn is_word(&self, w: &str) -> bool {
        (self.is_word)(w)
    }

    fn amount(&self, symbol: &str, whole: &str, fraction: Option<&str>, scale: Option<&str>) -> String {
        let (one, many, cent, cents) = currency(symbol);
        if let Some(scale) = scale {
            let lower = py::lower(scale);
            let scale = scale_letter(&lower).map(String::from).unwrap_or(lower);
            let value = match fraction {
                Some(f) => format!("{whole}.{f}"),
                None => whole.to_string(),
            };
            return format!("{} {scale} {many}", number_words(&value));
        }
        if let Some(f) = fraction
            && (py::len(f) > 2 || cent.is_empty())
        {
            return format!("{} {many}", number_words(&format!("{whole}.{f}")));
        }
        let amount = int(whole);
        let frac = fraction.unwrap_or("0");
        let padded = format!("{frac:0<2}");
        let change = int(&padded);
        let mut parts = Vec::new();
        if amount != 0 || change == 0 {
            parts.push(format!("{} {}", cardinal(amount), if amount == 1 { one } else { many }));
        }
        if change != 0 && !cent.is_empty() {
            parts.push(format!("{} {}", cardinal(change), if change == 1 { cent } else { cents }));
        }
        parts.join(" and ")
    }

    fn continental(m: &M) -> String {
        let groups: Vec<&str> = m.g(1).split('.').collect();
        if groups.len() == 4 && groups.iter().all(|g| int(g) <= 255) {
            return m.all().to_string();
        }
        format!("{}.{}", groups.join(","), m.g(2))
    }

    fn money(&self, m: &M) -> String {
        let whole = m.n("whole").replace([',', ' '], "");
        let words = self.amount(m.n("symbol"), &whole, m.name("fraction"), m.name("scale"));
        let minus = m.name("minus").is_some_and(|s| !s.is_empty()) || m.name("inner").is_some_and(|s| !s.is_empty());
        format!("{}{words} ", if minus { " minus " } else { " " })
    }

    fn half_day(m: &M, dotted: Option<&str>, plain: Option<&str>) -> String {
        let letter = match dotted.or(plain) {
            Some(l) if !l.is_empty() => l,
            _ => return String::new(),
        };
        let following = py::lstrip(m.after());
        let first = first_word_lower(following);
        let closes = dotted.is_some()
            && m.all().ends_with('.')
            && (following.is_empty()
                || (py::is_upper(py::first(following))
                    && first.is_some_and(|w| SETS.sentence_starters.contains(w.as_str()))));
        format!("{SPELL}{}M{END}{} ", py::upper(letter), if closes { " ." } else { "" })
    }

    fn time(&self, m: &M) -> String {
        let (hour, minute) = (int(m.g(1)), int(m.g(2)));
        let second = m.group(3);
        let half = m.group(4).or(m.group(5));
        let before = before_words(m.text, m.start(), 3);
        if let Some(s) = second
            && half.is_none()
            && before.last().map(String::as_str) != Some("at")
        {
            return format!(" {} ", duration(hour, minute, int(s)));
        }
        if hour > 24 && second.is_none() && half.is_none() {
            let after = WORD_AFTER.at_start(m.after()).map(|a| py::lower(a.g(1)));
            if before.iter().any(|w| SETS.duration_words.contains(w.as_str()))
                || after.is_some_and(|a| SETS.duration_words.contains(a.as_str()))
            {
                return format!(" {} ", duration(0, hour, minute));
            }
            return format!(" {} {}{} ", cardinal(hour), if minute < 10 { "oh " } else { "" }, cardinal(minute));
        }
        if hour > 24 {
            return m.all().to_string();
        }
        let mut words = cardinal(hour);
        if minute == 0 {
            if half.is_some() {
            } else if hour == 0 {
                words = "midnight".into();
            } else if hour > 12 {
                words.push_str(" hundred");
            } else {
                words.push_str(" o'clock");
            }
        } else {
            words.push_str(if minute < 10 { " oh " } else { " " });
            words.push_str(&cardinal(minute));
        }
        if let Some(s) = second
            && int(s) != 0
        {
            let s = int(s);
            words.push_str(&format!(" and {}{}", cardinal(s), if s == 1 { " second" } else { " seconds" }));
        }
        format!(" {words} {}", Self::half_day(m, m.group(4), m.group(5)))
    }

    fn dot_times(&self, m: &M) -> String {
        let following = m.after();
        let before = before_words(m.text, m.start(), 4);
        if int(m.g(1)) > 23
            || int(m.g(4)) > 23
            || !before.iter().any(|w| SETS.clock_words.contains(w.as_str()))
            || self.n.dot_times_follow.at_start(following).is_some()
        {
            return m.all().to_string();
        }
        format!("{}:{}{}{}:{}", m.g(1), m.g(2), m.g(3), m.g(4), m.g(5))
    }

    fn ratio(&self, m: &M) -> String {
        let (first, second) = (m.g(1), m.g(2));
        if py::len(first) <= 2 && py::len(second) == 2 && "012345".contains(py::first(second)) {
            let after = WORD_AFTER.at_start(m.after()).map(|a| py::lower(a.g(1)));
            if !(before_words(m.text, m.start(), 3).iter().any(|w| SETS.ratio_words.contains(w.as_str()))
                || after.is_some_and(|a| SETS.ratio_words.contains(a.as_str())))
            {
                return m.all().to_string();
            }
        }
        format!(" {} to {} ", number_words(first), number_words(second))
    }

    fn date(&self, month: i128, day: i128, year_text: Option<&str>, the: bool) -> Option<String> {
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        let name = MONTHS[month as usize - 1];
        let mut words =
            if the { format!("the {} of {name}", ordinal(day)) } else { format!("{name} {}", ordinal(day)) };
        if let Some(y) = year_text.filter(|y| !y.is_empty()) {
            words.push(' ');
            if py::len(y) == 4 {
                words.push_str(&year(int(y)));
            } else {
                words.push_str(&format!("{}{}", if int(y) < 10 { "oh " } else { "" }, cardinal(int(y))));
            }
        }
        Some(format!(" {words} "))
    }

    fn slash_date(&self, m: &M) -> String {
        let (mut first, mut second) = (int(m.g(1)), int(m.g(2)));
        if (first > 12 && 12 >= second) || (self.day_first.get() && second <= 12) {
            std::mem::swap(&mut first, &mut second);
        }
        self.date(first, second, m.group(3), false).unwrap_or_else(|| m.all().to_string())
    }

    fn dot_date(&self, m: &M) -> String {
        let (mut day, mut month) = (int(m.g(1)), int(m.g(2)));
        if month > 12 && 12 >= day {
            std::mem::swap(&mut day, &mut month);
        }
        self.date(month, day, m.group(3), false).unwrap_or_else(|| m.all().to_string())
    }

    fn day_month(&self, m: &M) -> String {
        let month = m.g(2);
        let number = month_number(&py::lower(month)[..3]).unwrap() as i128;
        match self.date(number, int(m.g(1)), m.group(4), true) {
            None => m.all().to_string(),
            Some(spoken) => {
                let stop = m.group(3).is_some_and(|s| !s.is_empty()) && MONTHS.contains(&month);
                format!("{spoken}{}", if stop { ". " } else { "" })
            }
        }
    }

    fn days_of_month(&self, m: &M) -> String {
        let month_first = py::is_alpha(py::first(m.g(1)));
        let (month, first, second) = if month_first { (m.g(1), m.g(2), m.g(3)) } else { (m.g(3), m.g(1), m.g(2)) };
        let (first, second) = (int(first), int(second));
        if !((1..=31).contains(&first) && (1..=31).contains(&second)) {
            return m.all().to_string();
        }
        let name = MONTHS[month_number(&py::lower(month)[..3]).unwrap() - 1];
        let words = if month_first {
            format!("{name} {} to {}", ordinal(first), ordinal(second))
        } else {
            format!("the {} to the {} of {name}", ordinal(first), ordinal(second))
        };
        let y = match m.group(4) {
            Some(y) if !y.is_empty() => format!(" {}", year(int(y))),
            _ => String::new(),
        };
        format!(" {words}{y} ")
    }

    fn day_range(&self, m: &M) -> String {
        let mut names = Vec::new();
        for name in [m.g(1), m.g(3)] {
            let key = py::lower(name);
            names.push(if let Some((_, words)) = self.n.abbreviations.get(&key) {
                words.clone()
            } else {
                day_name(&key).map(String::from).unwrap_or_else(|| name.to_string())
            });
        }
        let following = py::lstrip(m.after());
        let first = first_word_lower(following);
        let ends = m.group(4).is_some_and(|s| !s.is_empty())
            && (following.is_empty()
                || (py::is_upper(py::first(following))
                    && first.is_some_and(|w| SETS.sentence_starters.contains(w.as_str()))));
        format!("{} to {}{}", names[0], names[1], if ends { " ." } else { "" })
    }

    fn short_date(&self, m: &M) -> Option<String> {
        let (first_text, second_text) = (m.g(1), m.g(2));
        if py::len(first_text) > 2 || py::len(second_text) > 2 {
            return None;
        }
        let (mut first, mut second) = (int(first_text), int(second_text));
        let before = before_words(m.text, m.start(), 4);
        if (1..=12).contains(&first) && (20..=49).contains(&second) && before.iter().any(|w| w == "card") {
            return Some(format!(" {} {} ", MONTHS[first as usize - 1], year(2000 + second)));
        }
        let last = before.last().map(String::as_str).unwrap_or("");
        let classic = first < second && CLASSIC_FRACTIONS.contains(&second);
        let zero = (py::len(first_text) == 2 && first_text.starts_with('0'))
            || (py::len(second_text) == 2 && second_text.starts_with('0'));
        if !(zero
            || ((12 < first && first <= 31) && second <= 12 && (first, second) != (24, 7))
            || (SETS.date_before.contains(last) && (!classic || last == "on"))
            || (self.dated.get() && !classic && first != second))
        {
            return None;
        }
        if first > 12 || (self.day_first.get() && second <= 12) {
            std::mem::swap(&mut first, &mut second);
        }
        self.date(first, second, None, false)
    }

    fn fraction(&self, m: &M) -> String {
        if let Some(spoken) = self.short_date(m) {
            return spoken;
        }
        let (top, bottom) = (int(m.g(1)), int(m.g(2)));
        if (top, bottom) == (24, 7) || top == bottom {
            return format!(" {} {} ", cardinal_text(m.g(1)), cardinal_text(m.g(2)));
        }
        if !(0 < top && top < 100) || !(1 < bottom && bottom <= 100) {
            return format!(" {} over {} ", cardinal_text(m.g(1)), cardinal_text(m.g(2)));
        }
        format!(" {} ", fraction_words(top, bottom, false))
    }

    fn mixed_fraction(&self, m: &M) -> String {
        let (top, bottom) = (int(m.g(2)), int(m.g(3)));
        if !(0 < top && top < bottom) {
            return m.all().to_string();
        }
        format!(" {} and {} ", number_words(m.g(1)), fraction_words(top, bottom, true))
    }

    fn vulgar(m: &M) -> String {
        let normal: String = m.g(2).nfkc().collect();
        let (top, bottom) = normal.split_once('⁄').unwrap_or(("1", "2"));
        let (top, bottom) = (int(top), int(bottom));
        match m.group(1) {
            None => format!(" {top}/{bottom} "),
            Some(whole) => format!(" {} and {} ", cardinal_text(whole), fraction_words(top, bottom, true)),
        }
    }

    fn phone(m: &M) -> String {
        let groups: Vec<String> = m
            .groups()
            .into_iter()
            .flatten()
            .filter(|g| !g.is_empty())
            .map(|g| if g == "800" { "eight hundred".to_string() } else { digits(g, "oh") })
            .collect();
        format!(" {} ", groups.join(", "))
    }

    fn unit_names(&self, unit: &str) -> Option<&(String, String)> {
        self.n.exact_units.get(unit).or_else(|| self.n.units.get(&py::lower(unit)))
    }

    fn measure(&self, m: &M) -> String {
        let unit = m.g(3);
        let next = py::char_from(m.text, m.end_of(3).unwrap());
        let names = self.unit_names(unit);
        if names.is_none() || (py::len(unit) == 1 && matches!(next, Some('-' | '\'' | '/'))) {
            return m.all().to_string();
        }
        let (one, many) = names.unwrap();
        let value = decimal_comma(m.g(1));
        if let Some(upper) = m.group(2).filter(|u| !u.is_empty()) {
            let upper = decimal_comma(upper);
            return format!(" {} to {} {many} ", number_words(&value), number_words(&upper));
        }
        format!(" {} {} ", number_words(&value), if value == "1" || value == "1.0" { one } else { many })
    }

    fn square(&self, m: &M) -> String {
        let unit = m.g(2);
        let inch = ("inch".to_string(), "inches".to_string());
        let (one, many) =
            if unit == "in" { &inch } else { self.n.exact_units.get(unit).or_else(|| self.n.units.get(unit)).unwrap() };
        let kind = if "²2".contains(m.g(3)) { "square" } else { "cubic" };
        let value = decimal_comma(m.g(1));
        format!(" {} {kind} {} ", number_words(&value), if value == "1" || value == "1.0" { one } else { many })
    }

    fn counted(&self, text: &str, end: usize) -> bool {
        let Some(after) = WORD_AFTER.at_start(&text[end..]) else { return false };
        let word = py::lower(after.g(1));
        if ["people", "men", "women", "children", "feet", "miles"].contains(&word.as_str()) {
            return true;
        }
        py::len(&word) > 3
            && word.ends_with('s')
            && !word.ends_with("ss")
            && !SETS.not_counted.contains(word.as_str())
            && self.is_word(py::drop_last(&word, 1))
    }

    fn number(&self, m: &M, text: &str) -> String {
        static COUNTED_END: LazyLock<Re> = LazyLock::new(|| re(r"(?:[^s]s|people|men|women|children|feet|miles)$"));
        static MODEL: LazyLock<Re> = LazyLock::new(|| re(r"(?<![A-Za-z])([A-Z]{2,5}) $"));
        let value = m.all();
        let plain = value.replace(',', "");
        if !plain.contains('.') && !value.contains(',') && !plain.starts_with('0') && py::len(&plain) > 2 {
            let kind = identifier(text, m.start());
            let limit = match kind {
                Some("phone") | Some("pin") => 3,
                Some("strong") | Some("enter") => 4,
                Some("weak") => 5,
                _ => 7,
            };
            let n = py::len(&plain);
            if n >= limit
                && !(kind.is_none() && plain.ends_with("000"))
                && !(kind == Some("enter") && n == 4 && (1900..=2099).contains(&int(&plain)))
                && !(matches!(kind, None | Some("phone") | Some("weak")) && self.counted(text, m.end()))
            {
                return format!(" {} ", digits(&plain, if kind == Some("phone") { "oh" } else { "zero" }));
            }
        }
        if !plain.contains('.') && !value.contains(',') && py::len(&plain) == 4 && !plain.starts_with('0') {
            let number = int(&plain);
            let head = &text[..m.start()];
            let before = LETTERS.findall(py::last_chars(head, 24));
            let after = WORD_AFTER.at_start(m.after());
            let counted = after.is_some_and(|a| COUNTED_END.is_match(&py::lower(a.g(1))));
            let dated = before.last().is_some_and(|b| {
                let lower = py::lower(b);
                SETS.year_context.contains(lower.as_str()) || month_number(py::slice(&lower, 0, 3)).is_some()
            });
            if let Some(model) = MODEL.search(head)
                && !SETS.capital_words.contains(model.g(1))
                && !counted
            {
                return format!(" {} ", pairs(number));
            }
            if (1100..=1999).contains(&number) || ((2000..=2099).contains(&number) && (dated || !counted)) {
                return format!(" {} ", year(number));
            }
        }
        format!(" {} ", number_words(value))
    }

    fn reads_as_word(&self, letters: &str) -> bool {
        let lower = py::lower(letters);
        if py::len(&lower) < 3 || !self.is_word(&lower) {
            return false;
        }
        py::len(&lower) > 3 || ["s", "es", "ed", "ing"].iter().any(|e| self.is_word(&format!("{lower}{e}")))
    }

    fn alnum(group: &str, zero: &str) -> String {
        RUNS.findall(group)
            .into_iter()
            .map(|run| if py::str_is_digit(run) { digits(run, zero) } else { spelled(run) })
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn digit_groups(groups: &[&str], zero: &str) -> String {
        if groups.iter().all(|g| short_number(g) && py::len(g) <= 2) {
            return groups.iter().map(|g| cardinal_text(g)).collect::<Vec<_>>().join(" , ");
        }
        groups.iter().map(|g| digits(g, zero)).collect::<Vec<_>>().join(" , ")
    }

    fn code_words(&self, groups: &[&str], m: &M) -> Option<String> {
        static DIGITS_LETTERS: LazyLock<Re> = LazyLock::new(|| re(r"\d+[A-Za-z]+"));
        static ORDINAL_PLURAL: LazyLock<Re> = LazyLock::new(|| re(r"\d+(?:s|st|nd|rd|th)"));
        let token = groups.join("-");
        if !token.chars().any(py::is_digit) {
            return None;
        }
        let kinds: Vec<char> = groups
            .iter()
            .map(|g| {
                if py::str_is_digit(g) {
                    'd'
                } else if g.chars().any(py::is_digit) {
                    'm'
                } else if py::str_is_upper(g) {
                    'u'
                } else {
                    'l'
                }
            })
            .collect();
        if kinds.iter().all(|k| *k == 'd') {
            if groups.len() == 2 {
                let years = groups.iter().all(|g| py::len(g) == 4 && (1000..=2100).contains(&int(g)));
                if !(m.group(1).is_some()
                    || groups.iter().any(|g| py::len(g) > 1 && g.starts_with('0'))
                    || (groups.iter().map(|g| py::len(g)).min().unwrap() >= 4 && !years)
                    || matches!(identifier(m.text, m.start()), Some("strong") | Some("pin")))
                {
                    return None;
                }
            }
            return Some(Self::digit_groups(groups, "zero"));
        }
        if groups.len() == 2 && kinds[1] == 'd' && "ul".contains(kinds[0]) {
            let (letters, number) = (groups[0], groups[1]);
            if (kinds[0] == 'l' && py::len(letters) > 1) || self.reads_as_word(letters) {
                return None;
            }
            if short_number(number) {
                return Some(format!("{} {}", spelled(letters), cardinal_text(number)));
            }
            return Some(format!("{} , {}", spelled(letters), digits(number, "zero")));
        }
        if groups.len() == 2
            && kinds[0] == 'd'
            && (kinds[1] == 'l' || py::len(groups[1]) == 1 || DIGITS_LETTERS.full_match(groups[1]))
        {
            return None;
        }
        if kinds
            .iter()
            .zip(groups)
            .any(|(k, g)| (*k == 'l' && py::len(g) > 2) || (*k == 'm' && ORDINAL_PLURAL.full_match(g)))
        {
            return None;
        }
        if !token.chars().any(py::is_upper) && (kinds.contains(&'l') || kinds.contains(&'m')) {
            return None;
        }
        let mut parts = Vec::new();
        for (kind, group) in kinds.iter().zip(groups) {
            parts.push(match kind {
                'd' => digits(group, "zero"),
                'm' => Self::alnum(group, "zero"),
                _ if py::len(group) > 3 && self.is_word(&py::lower(group)) => group.to_string(),
                _ => {
                    if py::len(group) <= 5 {
                        spelled(group)
                    } else {
                        group.to_string()
                    }
                }
            });
        }
        Some(parts.join(" , "))
    }

    fn code(&self, m: &M) -> String {
        let groups: Vec<&str> = m.g(2).split('-').collect();
        match self.code_words(&groups, m) {
            None => m.all().to_string(),
            Some(words) => format!("{}{words} ", if m.group(1).is_some() { " number " } else { " " }),
        }
    }

    fn grouped(&self, m: &M) -> String {
        let text = m.text;
        let plus = m.name("plus");
        let mut lead = m.name("lead");
        let mut trail = m.name("trail");
        let core: Vec<&str> = m.n("core").split(' ').collect();
        let (mut head, mut tail) = (String::new(), String::new());
        if let Some(l) = lead
            && SETS.capital_words.contains(l)
        {
            head = format!("{l} ");
            tail = trail.map(|t| format!(" {t}")).unwrap_or_default();
            lead = None;
            trail = None;
        }
        let kind = identifier(text, m.start());
        let pure = core.iter().all(|part| py::str_is_digit(part));
        if pure && plus.is_none() && lead.is_none() {
            let following = m.after();
            let amount = self.counted(text, m.end()) || self.n.unit_after.at_start(following).is_some();
            if kind.is_none()
                && py::first(core[0]) != '0'
                && py::len(core[0]) <= 3
                && core[1..].iter().all(|part| py::len(part) == 3)
                && (*core.last().unwrap() == "000" || (amount && core.len() > 2))
            {
                return format!("{head}{}{tail}", core.join(","));
            }
            if !(kind.is_some()
                || (py::len(core[0]) > 1 && py::first(core[0]) == '0')
                || (core.len() > 2 && core.iter().any(|part| py::len(part) > 2)))
            {
                return m.all().to_string();
            }
        } else if !pure && lead.is_none() && plus.is_none() && kind.is_none() {
            return m.all().to_string();
        }
        let total: usize = core.iter().map(|part| py::len(part)).sum();
        let zero = if plus.is_some() || kind == Some("phone") || (pure && py::first(core[0]) == '0' && total >= 10) {
            "oh"
        } else {
            "zero"
        };
        let mut spoken = if pure {
            Self::digit_groups(&core, zero)
        } else {
            core.iter()
                .map(|part| if py::str_is_digit(part) { digits(part, zero) } else { Self::alnum(part, zero) })
                .collect::<Vec<_>>()
                .join(" , ")
        };
        if let Some(l) = lead {
            spoken = format!("{} , {spoken}", spelled(l));
        }
        if let Some(t) = trail {
            spoken = format!("{spoken} , {}", spelled(t));
        }
        format!("{head}{}{spoken} {tail}", if plus.is_some() { " plus " } else { " " })
    }

    fn glued(&self, m: &M) -> String {
        let mut out = Vec::new();
        for run in RUNS.findall(m.all()) {
            if py::str_is_digit(run) {
                out.push(if short_number(run) { cardinal_text(run) } else { digits(run, "zero") });
            } else if py::len(run) == 1 || ((py::str_is_upper(run) || py::len(run) <= 3) && !self.reads_as_word(run)) {
                out.push(spelled(run));
            } else {
                out.push(run.to_string());
            }
        }
        format!(" {} ", out.join(" "))
    }

    fn address_part(&self, part: &str) -> String {
        let lower = py::lower(part);
        let n = py::len(part);
        if n > 1 && self.is_word(&lower) && (n > 2 || SETS.short_words.contains(lower.as_str())) {
            return part.to_string();
        }
        if n <= 3 { spelled(part) } else { part.to_string() }
    }

    fn spoken_address(&self, core: &str) -> String {
        let pieces = ADDRESS_PIECES.findall(core);
        let mail = core.contains('@');
        let mut host = false;
        let mut out: Vec<String> = Vec::new();
        for (index, piece) in pieces.iter().enumerate() {
            let following = pieces.get(index + 1).copied().unwrap_or("");
            if *piece == "@" {
                host = true;
            }
            if py::str_is_digit(piece) {
                out.push(address_digits(piece));
            } else if !py::str_is_alpha(piece) {
                out.push(separator(piece).to_string());
            } else if index > 0
                && pieces[index - 1] == "."
                && (host || !mail)
                && (["", "/", ":", "?", "#"].contains(&following)
                    || (py::len(piece) <= 3
                        && (self.n.endings.contains_key(&py::lower(piece)) || !self.is_word(&py::lower(piece)))))
            {
                let lower = py::lower(piece);
                out.push(if self.n.endings.get(&lower).map(String::as_str) == Some("word") {
                    lower
                } else {
                    spelled(piece)
                });
            } else {
                let mut letters = String::new();
                for part in CAMEL_PARTS.findall(piece) {
                    let spoken = self.address_part(part);
                    if spoken.starts_with(SPELL) {
                        letters.push_str(part);
                        continue;
                    }
                    if !letters.is_empty() {
                        out.push(spelled(&letters));
                        letters.clear();
                    }
                    out.push(spoken);
                }
                if !letters.is_empty() {
                    out.push(spelled(&letters));
                }
            }
        }
        out.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ")
    }

    fn address(&self, m: &M) -> String {
        let whole = m.all();
        let text = whole.trim_end_matches(['.', ',', ';', ':', '!', '?', ')']);
        let tail = &whole[text.len()..];
        if m.name("file").is_some() {
            let ending = m.n("ending");
            let known = self.n.endings.contains_key(&py::lower(ending));
            let marked = m.name("folder").is_some() || m.name("path").is_some() || m.n("stem").contains('_');
            if !(known
                || (marked
                    && py::len(ending) <= 5
                    && (py::str_is_lower(ending) || py::str_is_upper(ending))
                    && !self.is_word(&py::lower(ending))))
            {
                return whole.to_string();
            }
        }
        let core = URL_HEAD.sub(text, |_| String::new());
        let core = core.trim_end_matches('/');
        format!(" {} {tail}", self.spoken_address(core))
    }

    fn chat_form(&self, m: &M) -> String {
        let Some(said) = self.n.chat.get(&py::lower(m.all())) else { return m.all().to_string() };
        if said == "-" {
            return " ".into();
        }
        let parts: Vec<String> = said
            .split_whitespace()
            .map(|part| match part.strip_prefix('*') {
                Some(letters) => spelled(letters),
                None => part.to_string(),
            })
            .collect();
        format!(" {} ", parts.join(" "))
    }

    fn inline(&self, m: &M) -> String {
        let symbols: Vec<String> = m.g(2).split(py::is_space).filter(|s| !s.is_empty()).map(String::from).collect();
        if symbols.is_empty() || symbols.iter().all(|s| py::len(s) == 1 && s.is_ascii()) {
            return m.all().to_string();
        }
        let phones = if is_arpabet(&symbols) { convert("", &symbols, None) } else { from_text(&symbols.join(" ")) };
        let Ok(phones) = phones else { return m.all().to_string() };
        let mut inline = self.inline.borrow_mut();
        inline.push((m.group(1).unwrap_or("").to_string(), phones));
        let mark = char::from_u32(INLINE_BASE + inline.len() as u32 - 1).unwrap();
        format!(" {INLINE}{mark}{INLINE} ")
    }

    fn dotted(&self, m: &M, text: &str) -> String {
        let letters = m.all().replace('.', "");
        let key = py::lower(&letters);
        let following = py::lstrip(&text[m.end()..]);
        let words = match key.as_str() {
            "eg" => "for example".to_string(),
            "ie" => "that is".to_string(),
            _ => spelled(&py::upper(&letters)),
        };
        let first = first_word_lower(following);
        let ends = following.is_empty()
            || (py::is_upper(py::first(following))
                && first.is_some_and(|w| SETS.sentence_starters.contains(w.as_str())));
        format!(" {words}{} ", if ends && m.all().ends_with('.') { " ." } else { "" })
    }

    fn abbreviation(&self, m: &M, text: &str) -> String {
        static NEXT_WORD: LazyLock<Re> = LazyLock::new(|| re(r"\s*([A-Za-z]+|\d)"));
        static CAPITAL_BEFORE: LazyLock<Re> = LazyLock::new(|| re(r"[A-Z][a-z]+\s+$"));
        static PREVIOUS: LazyLock<Re> = LazyLock::new(|| re(r"([A-Za-z]+)\.?\s+$"));
        let (token, stop) = (m.g(1), m.g(2));
        let stop = !stop.is_empty();
        let key = py::lower(token);
        let following = &text[m.end()..];
        let next_word = NEXT_WORD.at_start(following).map(|n| n.g(1).to_string());
        let capital_next = next_word.as_deref().is_some_and(|w| py::is_upper(py::first(w)));
        let capital_before = CAPITAL_BEFORE.is_match(&text[..m.start()]);
        let token_upper_first = py::is_upper(py::first(token));
        if (key == "st" || key == "dr") && token_upper_first {
            if capital_next && (stop || key == "dr") {
                return if key == "st" { " saint " } else { " doctor " }.into();
            }
            if capital_before && stop {
                return format!(
                    "{}{}",
                    if key == "st" { " street" } else { " drive" },
                    if py::strip(following).is_empty() { " ." } else { " " }
                );
            }
            return m.all().to_string();
        }
        let Some((when, words)) = self.n.abbreviations.get(&key) else { return m.all().to_string() };
        let mut words = words.clone();
        let number_next = next_word.as_deref().is_some_and(py::str_is_digit);
        if when == "title" {
            if !(token_upper_first && (capital_next || stop)) {
                return m.all().to_string();
            }
        } else if when == "number" {
            let previous = PREVIOUS.search(&text[..m.start()]).map(|p| py::lower(p.g(1)));
            if !(stop && (number_next || (key == "no" && previous.is_some_and(|p| SETS.numbered.contains(p.as_str())))))
            {
                return m.all().to_string();
            }
        } else if !stop
            || (when == "small" && py::str_is_upper(token))
            || ["mar", "sun", "sat", "jan", "dec", "max", "min", "est", "no"].contains(&key.as_str())
                && !token_upper_first
                && !number_next
                && !(["max", "min", "est"].contains(&key.as_str())
                    && next_word.as_deref().is_some_and(|w| py::first(w).is_lowercase()))
        {
            // "max. load" and "est. time" are the abbreviation, "he sat." is not
            return m.all().to_string();
        }
        if key == "est" && !number_next {
            words = "estimated".into();
        }
        let ends = when != "title"
            && (py::strip(following).is_empty()
                || (capital_next
                    && SETS.sentence_starters.contains(py::lower(next_word.as_deref().unwrap()).as_str())));
        format!(" {words}{} ", if ends { " ." } else { "" })
    }

    // -- the passes --

    fn rewrite(&self, text: &str) -> String {
        static EN_DASH_RANGE: LazyLock<Re> = LazyLock::new(|| re(r"(?<=\d)–(?=\d)"));
        static ELLIPSIS: LazyLock<Re> = LazyLock::new(|| re(r"\.{3,}"));
        static MINUS_SPACED: LazyLock<Re> = LazyLock::new(|| re(r"(?<=\d)\s-\s(?=\d[\d.,]*\s?=)"));
        static MINUS_JOINED: LazyLock<Re> = LazyLock::new(|| re(r"(?<![\d.,/-])(\d[\d.,]*)-(?=\d[\d.,]*=)"));
        static DASHES: LazyLock<Re> = LazyLock::new(|| re(r"-{2,}|\s-\s"));
        static WITHOUT: LazyLock<Re> = LazyLock::new(|| re(r"(?i)\bw/o\b"));
        static WITH: LazyLock<Re> = LazyLock::new(|| re(r"(?i)\bw/(?=\s|$)"));
        static NA: LazyLock<Re> = LazyLock::new(|| re(r"(?i)\bn/a\b"));
        let mut text = VULGAR.sub(text, Self::vulgar);
        text = self.n.area.sub(&text, |m| self.square(m));
        text = text.replace('²', " squared ").replace('³', " cubed ");
        text = text.nfkc().collect::<String>().replace('⁄', "/").replace('−', " minus ");
        if !text.is_ascii() {
            text = ACCENTED.sub(&text, |m| {
                let said = ACCENT_DECIDES.iter().find(|(w, _)| *w == py::lower(m.g(1))).unwrap().1;
                format!("{{{said}{}}}", if m.g(2).is_empty() { "" } else { " Z" })
            });
            text = text.chars().map(plain_letter).collect();
        }
        text = EN_DASH_RANGE.sub_str(&text, "-");
        text = DAY_RANGE.sub(&text, |m| self.day_range(m));
        for (old, new) in [
            ('‘', "'"),
            ('’', "'"),
            ('‚', "'"),
            ('‛', "'"),
            ('`', "'"),
            ('´', "'"),
            ('“', "\""),
            ('”', "\""),
            ('„', "\""),
            ('‟', "\""),
            ('«', "\""),
            ('»', "\""),
            ('–', "—"),
            ('―', "—"),
            ('[', "("),
            (']', ")"),
        ] {
            text = text.replace(old, new);
        }
        self.inline.borrow_mut().clear();
        text = INLINE_BRACES.sub(&text, |m| self.inline(m));
        text = text.replace('{', "(").replace('}', ")");
        text = ADDRESS.sub(&text, |m| self.address(m));
        text = text.replace('→', " to ");
        text = EMOJI.sub_str(&text, " ");
        text = EMOTICON.sub_str(&text, " ");
        text = ELLIPSIS.sub_str(&text, "…");
        text = MINUS_SPACED.sub_str(&text, " minus ");
        text = MINUS_JOINED.sub_str(&text, r"\1 minus ");
        text = DASHES.sub_str(&text, "—");
        text = WITHOUT.sub_str(&text, " without ");
        text = WITH.sub_str(&text, " with ");
        text = NA.sub_str(&text, " not applicable ");
        text = text.replace("'n'", " 'n ");
        if COMPARISON_ANY.is_match(&text) {
            text = self.mark_comparisons(&text);
        }
        if DIGIT_ANY.is_match(&text) {
            text = self.figures(&text);
        }
        self.signs(&text)
    }

    fn figures(&self, text: &str) -> String {
        macro_rules! sub {
            ($text:expr, $pattern:expr, $f:expr) => {{
                static R: LazyLock<Re> = LazyLock::new(|| re(&$pattern));
                R.sub(&$text, $f)
            }};
        }
        macro_rules! sub_str {
            ($text:expr, $pattern:expr, $rep:expr) => {{
                static R: LazyLock<Re> = LazyLock::new(|| re(&$pattern));
                R.sub_str(&$text, $rep)
            }};
        }
        let mut text = FORMULA_END.sub(text, |m| format!("{}{FORMULA_SIGN}", py::drop_last(m.all(), 1)));
        text = CONTINENTAL.sub(&text, Self::continental);
        text = COMMA_AFTER_SIGN.sub_str(&text, r"\1.\2");
        text = COMMA_BEFORE_SIGN.sub_str(&text, r"\1.\2");
        text = MONEY.sub(&text, |m| self.money(m));
        text = RANGE_BEFORE_SIGN.sub_str(&text, r"\1 to ");
        text = MONEY_AFTER.sub(&text, |m| self.money(m));
        text = sub!(text, r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?¢", |m: &M| format!(
            " {} {} ",
            number_words(m.g(1)),
            if m.g(1) == "1" { "cent" } else { "cents" }
        ));

        // times of day, lengths of time, ratios
        text = CLOCK_ZONE.sub(&text, |m| format!("{} {}", m.g(1), spelled(m.g(2))));
        text = sub_str!(text, r"(?<![\d.,:])(\d{1,2})\.([0-5]\d)(?=\s?[AaPp]\.?[Mm]\b)", r"\1:\2");
        text = sub!(
            text,
            r"(?<![\d.,:])(\d{1,2})\.(00|15|30|45)(\s?(?:to|until|till|and|[-—])\s?)(\d{1,2})\.(00|15|30|45)(?!\d|\.\d)",
            |m: &M| self.dot_times(m)
        );
        text = sub_str!(text, format!(r"({CLOCK})\s?[-—]\s?(?=\d{{1,2}}(?::[0-5]\d|\s?[AaPp]\.?[Mm]\b))"), r"\1 to ");
        text = RATIO.sub(&text, |m| self.ratio(m));
        text = sub!(text, format!(r"(?<![\d:])(\d{{1,2}}):([0-5]\d)(?::([0-5]\d))?{HALF_DAY}?(?![\d:])"), |m: &M| self
            .time(m));
        text = sub!(text, format!(r"(?<![\d.:,])(\d{{1,2}}){HALF_DAY}(?![A-Za-z])"), |m: &M| format!(
            " {} {}",
            cardinal(int(m.g(1))),
            Self::half_day(m, m.group(2), m.group(3))
        ));

        // dates
        static SEEN: LazyLock<Re> =
            LazyLock::new(|| re(r"(?<![\d/.])(\d{1,2})/(\d{1,2})(?:/(?:\d{4}|\d{2}))?(?![\d/])"));
        static DATED: LazyLock<Re> = LazyLock::new(|| re(r"(?<![\d/])\d{1,2}/\d{1,2}/(?:\d{4}|\d{2})(?![\d/])"));
        let seen: Vec<(i128, i128)> =
            SEEN.iter(&text).iter().map(|m| (int(m.g(1)), int(m.g(2)))).filter(|pair| *pair != (24, 7)).collect();
        self.day_first
            .set(seen.iter().any(|(a, b)| *a > 12 && 12 >= *b) && !seen.iter().any(|(a, b)| *b > 12 && 12 >= *a));
        self.dated.set(DATED.is_match(&text));
        text = sub!(text, r"(?<![\d-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d-])", |m: &M| self
            .date(int(m.g(2)), int(m.g(3)), m.group(1), false)
            .unwrap_or_else(|| m.all().to_string()));
        text = sub!(text, r"(?<![\d/])(\d{4})/(\d{1,2})/(\d{1,2})(?![\d/])", |m: &M| self
            .date(int(m.g(2)), int(m.g(3)), m.group(1), false)
            .unwrap_or_else(|| m.all().to_string()));
        text = sub!(text, r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d|\.\d)", |m: &M| self.dot_date(m));
        text = sub!(text, r"(?<![\d/])(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?![\d/])", |m: &M| self.slash_date(m));
        text = sub!(
            text,
            format!(
                r"\b({MONTH_PATTERN})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\s?[-—]\s?(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?(?![\d:])"
            ),
            |m: &M| self.days_of_month(m)
        );
        text = sub!(
            text,
            format!(
                r"(?<![\d.,/:-])(\d{{1,2}})(?:st|nd|rd|th)?\s?[-—]\s?(\d{{1,2}})(?:st|nd|rd|th)?\s+({MONTH_PATTERN})\b(?:,?\s+(\d{{4}}))?"
            ),
            |m: &M| self.days_of_month(m)
        );
        text = sub!(
            text,
            format!(r"\b({MONTH_PATTERN})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?(?![\d:])"),
            |m: &M| {
                let number = month_number(&py::lower(m.g(1))[..3]).unwrap() as i128;
                self.date(number, int(m.g(2)), m.group(3), false).unwrap_or_else(|| m.all().to_string())
            }
        );
        text = sub!(
            text,
            format!(
                r"(?<![\d.,/:-])(\d{{1,2}})(?:st|nd|rd|th)?\s+({MONTH_PATTERN})\b(\.(?=\s+[a-z\d]))?(?:,?\s+(\d{{4}}))?"
            ),
            |m: &M| self.day_month(m)
        );

        // telephone numbers, versions, codes
        text = sub!(text, r"(?<![\d-])(?:\+?(1)[-.\s])?\(?(\d{3})\)?[-.\s](\d{3})[-.\s](\d{4})(?![\d-])", Self::phone);
        text = sub!(text, r"(?<![\w.,-])(\d{3})-(\d{4})(?![\w-])", Self::phone);
        text = sub!(text, r"(?<![\w.])([vV])?(\d+(?:\.\d+){2,})(?:-(\d+)(?![\w-]|\.\d))?(?![\w])", |m: &M| {
            let v = m.group(1).map(|v| format!("{} ", spelled(v))).unwrap_or_default();
            let parts: Vec<String> = m.g(2).split('.').map(version_part).collect();
            let dash = m.group(3).map(|d| format!(" dash {}", number_words(d))).unwrap_or_default();
            format!(" {v}{}{dash} ", parts.join(" point "))
        });
        text = sub!(text, r"(?<![\w.])([vV])(\d+)\.(\d{2,3})(?!\d|\.\d|\w)", |m: &M| format!(
            " {} {} point {} ",
            spelled(m.g(1)),
            cardinal_text(m.g(2)),
            minor(m.g(3))
        ));
        text = sub!(
            text,
            format!(
                r"(?i)\b({VERSIONED})(\.?\s(?:(?:from|to)\s)?)(\d+)\.(\d{{2,3}})(?:(\s(?:to|or|and)\s)(\d+)\.(\d{{2,3}}))?(?!\d|\.\d|\s?%|\s(?:percent|million|billion)\b)"
            ),
            |m: &M| {
                let second = if m.group(5).is_some() {
                    format!("{}{} point {}", m.g(5), cardinal_text(m.g(6)), minor(m.g(7)))
                } else {
                    String::new()
                };
                format!("{}{}{} point {}{second} ", m.g(1), m.g(2), cardinal_text(m.g(3)), minor(m.g(4)))
            }
        );
        text = CODE.sub(&text, |m| self.code(m));
        text = SLASHED.sub(&text, |m| {
            let groups: Vec<&str> = m.g(1).split('/').collect();
            format!(" {} ", Self::digit_groups(&groups, "zero"))
        });
        text = GROUPED.sub(&text, |m| self.grouped(m));

        text = sub_str!(text, r"(?<![\w.])-(?=\d)", " minus ");
        text = sub_str!(text, format!(r"(?:(?<=\d)\s?[xX×]|×)\s?(?=\d[\d.,]*\s?(?:{LENGTHS})\b)"), " by ");
        text = sub_str!(text, r"(?<=\d)\s[xX×]\s(?=\d)", " times ");
        text = sub!(text, r"(?<![\w/'])[A-Za-z0-9/]*[0-9/][A-Za-z0-9/]*(?![\w/'])", |m: &M| self.chat_form(m));
        text = sub!(text, r"(?<![\w.])'?(\d{2}|\d{4})'?s\b", |m: &M| {
            let g = m.g(1);
            let words = if py::len(g) == 4 { year(int(g)) } else { cardinal(int(g)) };
            format!(" {} ", plural_of(&words))
        });
        text = sub!(text, r"(?<![\w.])(\d+)(?:st|nd|rd|th)\b", |m: &M| format!(
            " {} ",
            ordinal_words(cardinal_text(m.g(1)))
        ));
        text = sub!(text, r"(?<![\w.])(144|240|360|480|540|576|720|900|1080|1440|2160|4320)([pi])\b", |m: &M| format!(
            " {} {} ",
            pairs(int(m.g(1))),
            spelled(m.g(2))
        ));
        text = sub!(text, r"(\d[\d,]*(?:\.\d+)?)\s?%", |m: &M| format!(" {} percent ", number_words(m.g(1))));
        text = self.n.area_plain.sub(&text, |m| self.square(m));
        text = self.n.unit.sub(&text, |m| self.measure(m));
        text = sub!(text, r"(?<![\d/.,-])(\d+) (\d)/(2|3|4|5|6|8|10|16)(?![\d/]|\.\d)", |m: &M| self.mixed_fraction(m));
        text = sub!(text, r"(?<![\d/.])(\d+)/(\d+)(?![\d/]|\.\d)", |m: &M| self.fraction(m));
        text = sub!(text, r"(?<![\w.,-])(\d{4})[-–](\d{4})(?![\w.,-])", |m: &M| format!(
            " {} to {} ",
            year(int(m.g(1))),
            year(int(m.g(2)))
        ));
        text = sub!(text, r"(?<![\w.,-])(\d+)[-–](\d+)(?![\w-]|[.,]\d)", |m: &M| format!(
            " {} to {} ",
            number_words(m.g(1)),
            number_words(m.g(2))
        ));
        text = sub!(text, r"(?<![\w.])(\d+)x\b", |m: &M| format!(" {} times ", number_words(m.g(1))));
        text = sub_str!(text, r"(?<=\d)\^(?=\d)", " to the power of ");
        text
    }

    fn named_letters(text: &str) -> String {
        if !"=<>+*/^()≤≥≠≈×÷±".chars().any(|c| text.contains(c)) {
            return text.to_string();
        }
        let plain = without_angles(text);
        let mut places = HashSet::new();
        for pattern in LETTER_PLACES.iter() {
            for m in pattern.iter(&plain) {
                places.insert(char_index(&plain, m.name_start("letter").unwrap()));
            }
        }
        if places.is_empty() {
            return text.to_string();
        }
        text.chars()
            .enumerate()
            .map(|(i, c)| if places.contains(&i) { format!("{SPELL}{}{END}", c.to_uppercase()) } else { c.to_string() })
            .collect()
    }

    fn mark_comparisons(&self, text: &str) -> String {
        static WORD_END: LazyLock<Re> = LazyLock::new(|| re(r"[A-Za-z']+$"));
        let plain = without_angles(text);
        let plain_chars: Vec<char> = plain.chars().collect();
        COMPARED.sub(text, |m| {
            let start_c = char_index(text, m.start());
            let end_c = char_index(text, m.end());
            let sign_c = char_index(text, m.name_start("sign").unwrap());
            let before: String = plain_chars[..start_c].iter().collect();
            let after: String = plain_chars[end_c..].iter().collect();
            let value = VALUE_BEFORE.search(&before);
            if plain_chars[sign_c] != py::first(m.n("sign"))
                || value.is_none()
                || VALUE_AFTER.at_start(&after).is_none()
            {
                return m.all().to_string();
            }
            let value = value.unwrap();
            let chars: Vec<char> = before.chars().collect();
            let mut start = char_index(&before, value.start()) as isize;
            if value.all() == ")" || value.all() == "]" {
                let mut depth = 0;
                while start >= 0 {
                    let c = chars[start as usize];
                    depth += (c == ')' || c == ']') as i32 - (c == '(' || c == '[') as i32;
                    if depth == 0 {
                        break;
                    }
                    start -= 1;
                }
                while start > 0 {
                    let c = chars[start as usize - 1];
                    if !(py::is_alnum(c) || c == '_' || c == '.') {
                        break;
                    }
                    start -= 1;
                }
            }
            let head: String = chars[..start.max(0) as usize].iter().collect();
            if let Some(word) = WORD_END.search(py::rstrip(&head))
                && !SETS.clause_openers.contains(py::lower(word.all()).as_str())
            {
                return m.all().to_string();
            }
            format!("{IS}{}", m.all())
        })
    }

    fn compared(m: &M, words: &str) -> String {
        let marked = m.all().starts_with(IS) || m.before().trim_end_matches(' ').ends_with(IS);
        format!(" {}{words} ", if marked { "is " } else { "" })
    }

    fn joined_comparisons(&self, text: &str) -> String {
        let plain: Vec<char> = without_angles(text).chars().collect();
        JOINED_COMPARISON.sub(text, |m| {
            let before = m.before().trim_end_matches(IS);
            let after = m.after();
            if plain[char_index(text, m.start())] != py::first(m.all()) {
                return m.all().to_string();
            }
            if !(FIGURE_BEFORE.is_match(before)
                || FIGURE_AFTER.at_start(after).is_some()
                || (LETTER_BEFORE.is_match(before) && LETTER_AFTER.at_start(after).is_some()))
            {
                return m.all().to_string();
            }
            Self::compared(m, if m.all() == "<" { "less than" } else { "greater than" })
        })
    }

    fn signs(&self, text: &str) -> String {
        macro_rules! sub {
            ($text:expr, $pattern:expr, $f:expr) => {{
                static R: LazyLock<Re> = LazyLock::new(|| re(&$pattern));
                R.sub(&$text, $f)
            }};
        }
        macro_rules! sub_str {
            ($text:expr, $pattern:expr, $rep:expr) => {{
                static R: LazyLock<Re> = LazyLock::new(|| re(&$pattern));
                R.sub_str(&$text, $rep)
            }};
        }
        let mut text = Self::named_letters(text);
        if text.contains('<') || text.contains('>') {
            text = self.joined_comparisons(&text);
        }
        text = sub!(text, format!(r"(?<![\w-])({SIZES})-({SIZES})(?![\w-])"), |m: &M| format!(
            " {} to {} ",
            spelled(m.g(1)),
            spelled(m.g(2))
        ));
        text = sub_str!(text, r"#(?=\d)", " number ");
        text = sub_str!(text, r"#(?=[A-Z]{1,4}-?\d)", " number ");
        text = sub_str!(text, r"#(?=[A-Za-z])", " hashtag ");
        text = sub_str!(text, r"~(?=\s?\d)", " about ");
        text = sub!(text, format!(r"(?<=[\w\s{END}{IS}])(>=|<=|!=)(?=[\w\s{SPELL}])"), |m: &M| {
            let words = match m.g(1) {
                ">=" => "greater than or equal to",
                "<=" => "less than or equal to",
                _ => "not equal to",
            };
            Self::compared(m, words)
        });
        text = sub!(text, r"(?<=\d) Ti\b", |_m: &M| format!(" {}", spelled("TI")));
        text = sub_str!(text, r"\b([Rr])ef\.\s?[Nn]o\.(?=\s)", r"\1eference number");
        if text.contains('.') {
            let current = text.clone();
            text = sub!(text, r"\b((?:[A-Za-z]\.){2,})", |m: &M| self.dotted(m, &current));
        }
        let current = text.clone();
        text = sub!(text, r"\b([A-Za-z]{1,6})\b(\.?)(?![A-Za-z'’])", |m: &M| self.abbreviation(m, &current));
        if DIGIT_ANY.is_match(&text) {
            text = GLUED.sub(&text, |m| self.glued(m));
            let current = text.clone();
            text = sub!(text, r"(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|(?<![\w.])\.\d+", |m: &M| self
                .number(m, &current));
        }
        text = sub_str!(text, r"(?<=[A-Za-z])/(?=[A-Za-z])", " ");
        text = sub!(text, format!(r"(?<=\d){IS}?\s?[<>]\s?(?=\d)|(?<=\s)[<>](?=\s)"), |m: &M| Self::compared(
            m,
            if m.all().contains('<') { "less than" } else { "greater than" }
        ));
        text = self.n.symbols.sub(&text, |m| {
            let c = py::first(m.all());
            let words = SYMBOL_WORDS.iter().find(|(k, _)| *k == c).unwrap().1;
            if "≥≤≠".contains(c) { Self::compared(m, words) } else { format!(" {words} ") }
        });
        text.replace(IS, "")
    }

    // -- words --

    fn unstretched(word: &str) -> Vec<String> {
        static TRIPLE: LazyLock<Re> = LazyLock::new(|| re(r"(.)\1\1"));
        static RUN: LazyLock<Re> = LazyLock::new(|| re(r"(.)\1{2,}"));
        static LIKED: LazyLock<Re> = LazyLock::new(|| re(r"([lfsz])\1\1+$"));
        static FINAL_RUN: LazyLock<Re> = LazyLock::new(|| re(r"(.)\1{2,}$"));
        if !TRIPLE.is_match(word) {
            return Vec::new();
        }
        let cut = |double_inside: bool, double_final: bool| {
            RUN.sub(word, |m| {
                let last = m.end() == word.len();
                let n = if if last { double_final } else { double_inside } { 2 } else { 1 };
                m.g(1).repeat(n)
            })
        };
        let liked = LIKED.is_match(word) || word.chars().all(|c| c == 'm') || FINAL_RUN.sub_str(word, r"\1") == "to";
        let mut out: Vec<String> = Vec::new();
        for candidate in [cut(true, liked), cut(true, !liked), cut(false, liked), cut(false, !liked)] {
            if !out.contains(&candidate) {
                out.push(candidate);
            }
        }
        out
    }

    fn chat_words(chat: &str, raw: &str) -> Vec<Word> {
        if chat == "-" {
            return Vec::new();
        }
        chat.split_whitespace()
            .map(|part| match part.strip_prefix('*') {
                Some(letters) => Word::spelled(&py::lower(letters), raw),
                None => Word::new(&py::lower(part), part),
            })
            .collect()
    }

    fn reply(out: &[Token], place: usize) -> bool {
        let mut marks = Vec::new();
        for step in [-1isize, 1] {
            let mut index = place as isize + step;
            while index >= 0
                && (index as usize) < out.len()
                && matches!(&out[index as usize], Token::Punct(m) if "\"'()".contains(m.as_str()))
            {
                index += step;
            }
            if index < 0 || index as usize >= out.len() {
                marks.push(String::new());
                continue;
            }
            match &out[index as usize] {
                Token::Word(_) => return false,
                Token::Punct(mark) => {
                    marks.push(mark.clone());
                    let beyond = index + step;
                    if mark == ","
                        && beyond >= 0
                        && (beyond as usize) < out.len()
                        && let Token::Word(w) = &out[beyond as usize]
                        && py::len(&w.text) == 1
                        && w.text != "i"
                    {
                        return false;
                    }
                }
            }
        }
        marks != [",", ","]
    }

    fn word_tokens(&self, raw: &str, all_caps: bool, previous: &str, following: bool, fresh: bool) -> Vec<Word> {
        static CAPITALS: LazyLock<Re> = LazyLock::new(|| re(r"[a-z]+(?:[A-Z][a-z]+)*[A-Z]{2,}(?:'s)?"));
        static PARTS: LazyLock<Re> = LazyLock::new(|| re(r"[A-Z]?[a-z']+|[A-Z]+(?![a-z])"));
        let lower = py::lower(raw);
        if let Some(chat) = self.n.chat.get(&lower)
            && (py::len(raw) > 1 || py::str_is_lower(raw))
            && !self.n.replies.contains(&lower)
        {
            return Self::chat_words(chat, raw);
        }
        if let Some(number) = roman(raw)
            && !previous.is_empty()
            && py::is_upper(py::first(previous))
        {
            let words = if SETS.cardinal_after.contains(py::lower(previous).as_str()) {
                cardinal(number)
            } else {
                format!("the {}", ordinal(number))
            };
            return words.split(' ').map(|w| Word::new(w, raw)).collect();
        }
        let letters = raw.replace('\'', "");
        let possessive = lower.ends_with("'s");
        let stem = if possessive { py::drop_last(raw, 2) } else { raw };
        if py::len(stem) == 1 && py::str_is_alpha(stem) {
            let label = stem == "A"
                && !previous.is_empty()
                && (!following || (!fresh && SETS.labelled.contains(py::lower(previous).as_str())));
            if ["a", "A", "I", "i"].contains(&stem) && !possessive && !label {
                return vec![Word::new(&py::lower(stem), raw)];
            }
            return vec![Word::spelled(&lower, raw)];
        }
        let distinct: HashSet<char> = lower.chars().collect();
        if py::len(stem) > 2
            && "SsZz".contains(py::first(stem))
            && distinct.len() == 1
            && (all_caps || !py::str_is_upper(stem))
        {
            let phone = p(&py::first(&lower).to_string());
            return vec![Word { phones: Some(vec![(phone, 0)]), ..Word::new(&lower, raw) }];
        }
        if py::str_is_upper(stem)
            && py::str_is_alpha(stem)
            && (2..=5).contains(&py::len(stem))
            && (!all_caps || !self.is_word(&py::lower(stem)))
            && (SETS.initialisms.contains(stem) || !self.is_word(&py::lower(stem)))
        {
            return vec![Word::spelled(&lower, raw)];
        }
        if !py::str_is_alpha(&letters) {
            return Vec::new();
        }
        let capitals = CAPITALS.full_match(raw);
        if capitals || !self.is_word(&lower) {
            if !capitals {
                for candidate in Self::unstretched(&lower) {
                    if self.is_word(&candidate) {
                        return vec![Word::new(&candidate, raw)];
                    }
                }
            }
            let parts = PARTS.findall(raw);
            if parts.len() > 1 && parts.concat() == raw {
                let mut out: Vec<Word> = Vec::new();
                for part in parts {
                    let upper = py::str_is_upper(part);
                    let named = capitals && upper && SETS.initialisms.contains(part);
                    let spell = py::len(part) == 1 || named || (upper && !self.is_word(&py::lower(part)));
                    if capitals && out.last().is_some_and(|w| w.spell) && (spell || part == "'s") {
                        let last = out.last_mut().unwrap();
                        last.text.push_str(&py::lower(part));
                        last.raw.push_str(part);
                    } else {
                        let attach = !out.is_empty();
                        out.push(Word { attach, spell, ..Word::new(&py::lower(part), part) });
                    }
                }
                return out;
            }
        }
        vec![Word::new(&lower, raw)]
    }

    fn tokens(&self, text: &str) -> Vec<Token> {
        static RUNS2: LazyLock<Re> = LazyLock::new(|| re(r"[A-Za-z]{2,}"));
        static PATTERN: LazyLock<Re> = LazyLock::new(|| {
            re(&format!(r"{SPELL}([A-Za-z ]+){END}|{INLINE}(.){INLINE}|('?[A-Za-z]+(?:'[A-Za-z]+)*)|(\d+)|(-)|(\S)"))
        });
        static NEXT_LETTER: LazyLock<Re> = LazyLock::new(|| re(r"\s*[A-Za-z]"));
        static HISS_AFTER: LazyLock<Re> = LazyLock::new(|| re(r#"[.!?…,;:—"')]*(?:\s|$)"#));
        static REPLY_AFTER: LazyLock<Re> = LazyLock::new(|| re(r#"(?:[.?…,;—]*["']?(?:\s|$)|!+["']?\s*$)"#));
        let text = self.rewrite(text);
        let text = text.as_str();
        let runs = RUNS2.findall(text);
        let upper = runs.iter().filter(|r| py::str_is_upper(r)).count();
        let all_caps = runs.len() >= 3 && upper as f64 >= 0.6 * runs.len() as f64;
        let mut out: Vec<Token> = Vec::new();
        let mut attach = false;
        let mut previous = String::new();
        let mut fresh = true;
        let mut short = Vec::new();
        let mut replies = Vec::new();
        let inline = self.inline.borrow();
        for m in PATTERN.iter(text) {
            let before = py::char_before(text, m.start()).unwrap_or(' ');
            let next_char = py::char_from(text, m.end());
            if m.group(5).is_some() {
                attach = matches!(out.last(), Some(Token::Word(_)))
                    && !py::is_space(before)
                    && next_char.is_some_and(py::is_alnum);
                continue;
            }
            let mut new: Vec<Word> = Vec::new();
            if let Some(spelled) = m.group(1) {
                new = vec![Word::spelled(&py::lower(&spelled.replace(' ', "")), spelled)];
            } else if let Some(mark) = m.group(2) {
                let (written, phones) = &inline[py::first(mark) as usize - INLINE_BASE as usize];
                new = vec![Word { phones: Some(phones.clone()), ..Word::new(&py::lower(written), written) }];
            } else if let Some(word) = m.group(3) {
                let mut word = word;
                if word.starts_with('\'') && !SETS.leading_apostrophe.contains(py::lower(word).as_str()) {
                    out.push(Token::Punct("'".into()));
                    word = &word[1..];
                } else if word.starts_with('\'') && !self.is_word(&py::lower(word)) {
                    word = &word[1..];
                }
                new = self.word_tokens(word, all_caps, &previous, NEXT_LETTER.at_start(m.after()).is_some(), fresh);
                previous = word.to_string();
                if ["Ss", "ss", "Zz", "zz"].contains(&word)
                    && new.len() == 1
                    && (py::is_space(before) || "\"'(".contains(before))
                    && HISS_AFTER.at_start(m.after()).is_some()
                {
                    short.push(out.len());
                }
                if self.n.replies.contains(&py::lower(word))
                    && (py::len(word) > 1 || py::str_is_lower(word))
                    && new.len() == 1
                    && (py::is_space(before) || "\"'".contains(before))
                    && REPLY_AFTER.at_start(m.after()).is_some()
                {
                    replies.push(out.len());
                }
            } else if let Some(number) = m.group(4) {
                new = number_words(number).split(' ').filter(|w| !w.is_empty()).map(|w| Word::new(w, number)).collect();
            } else if let Some(other) = m.group(6)
                && PUNCTUATION.contains(&other)
            {
                if !(other == "'" && py::is_alnum(before) && next_char.is_some_and(py::is_alnum)) {
                    out.push(Token::Punct(other.to_string()));
                }
                if ".!?;…".contains(other) {
                    fresh = true;
                }
                attach = false;
                continue;
            }
            if attach && let Some(first) = new.first_mut() {
                first.attach = true;
            }
            fresh = fresh && new.is_empty();
            out.extend(new.into_iter().map(Token::Word));
            attach = false;
        }
        let quote = |t: &Token| matches!(t, Token::Punct(m) if "\"'()".contains(m.as_str()));
        for place in short {
            let (mut first, mut last) = (place, place + 1);
            while first > 0 && (matches!(out[first - 1], Token::Word(_)) || quote(&out[first - 1])) {
                first -= 1;
            }
            while last < out.len() && (matches!(out[last], Token::Word(_)) || quote(&out[last])) {
                last += 1;
            }
            let all_sounds = out[first..last].iter().all(|t| match t {
                Token::Word(w) => {
                    SETS.sounds.contains(w.text.as_str())
                        || (w.phones.is_some() && w.text.chars().collect::<HashSet<_>>().len() == 1)
                }
                Token::Punct(_) => true,
            });
            if all_sounds && let Token::Word(w) = &mut out[place] {
                w.phones = Some(vec![(p(&py::first(&w.text).to_string()), 0)]);
            }
        }
        for &place in replies.iter().rev() {
            if Self::reply(&out, place) {
                let raw = match &out[place] {
                    Token::Word(w) => w.raw.clone(),
                    Token::Punct(_) => unreachable!(),
                };
                let words = Self::chat_words(&self.n.chat[&py::lower(&raw)], &raw);
                out.splice(place..place + 1, words.into_iter().map(Token::Word));
            }
        }
        out
    }
}
