//! The port against the Python package: every sentence of tests/fixtures/phonemes.json gives the same tokens
//! (ids and stress, written as symbols with stress marks) as dizione 8cd889e did. The sentences are the narration of
//! every example storyboard, split as tiny-voca splits it, dizione's own test sentences, and generated figures,
//! dates, money, versions and identifiers. Needs the phonemizer data the model ships: set DIZIONE_DATA to its
//! directory (`mr-cast voices --sample` downloads it into ~/.cache/mr-cast/tiny-voca/<revision>/phonemizer).

use std::path::PathBuf;

fn data() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("DIZIONE_DATA")?);
    dir.join("lexicon.tsv").exists().then_some(dir)
}

#[test]
fn matches_the_python_package() {
    let Some(dir) = data() else {
        eprintln!("skipped: set DIZIONE_DATA to the phonemizer data directory");
        return;
    };
    let p = dizione::Phonemizer::load(&dir).unwrap();
    let cases: Vec<(String, Option<String>)> = serde_json::from_str(include_str!("fixtures/phonemes.json")).unwrap();
    assert!(cases.len() >= 5000);
    let mut wrong = Vec::new();
    for (text, want) in &cases {
        let got = p.phonemize(text).ok().map(|r| r.to_string());
        if &got != want {
            wrong.push(format!("{text:?}\n  python: {want:?}\n  rust:   {got:?}"));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} of {} differ:\n{}",
        wrong.len(),
        cases.len(),
        wrong.iter().take(40).cloned().collect::<Vec<_>>().join("\n")
    );
}
