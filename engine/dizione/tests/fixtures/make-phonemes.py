# Writes phonemes.json: [text, tokens or null] for each sentence, from the real dizione Python package.
#
#   python -m venv /tmp/dz && /tmp/dz/bin/pip install numpy git+https://github.com/n4ze3m/dizione@8cd889e
#   DIZIONE_DATA=<the model's phonemizer/ directory> /tmp/dz/bin/python -I make-phonemes.py <repo root> <dizione checkout>
#
# The sentences: the narration of every example storyboard (shared/timing.mjs spokenTexts, which is what mr-cast
# speaks), split as tiny-voca splits it; dizione's tests/data/tricky_sentences.txt and the strings of its test file;
# generated figures, money, dates, versions, identifiers; and made-up words, signs, brackets and Unicode.
import ast, json, os, random, re, subprocess, sys

ROOT, DIZIONE = sys.argv[1], sys.argv[2]
_SPACE = re.compile("[\\s" + chr(0xFEFF) + "]+")
_SENTENCE_END = re.compile(r"""(?:(?<=[.!?…])|(?<=[.!?…]["')\]]))\s+(?=["'(\[]?[A-Z0-9])""")
_NOT_AN_END = re.compile(r"(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$",
                         re.IGNORECASE | re.ASCII)
_CLAUSE_END = re.compile(r"(?<=[,;:—])\s+")
_TEXT_END = re.compile("[\\s" + chr(0xFEFF) + "]+$")
_CLOSING = "\"'”’)]»"

def sentences(text):
    parts, current = [], ""
    for piece in _SENTENCE_END.split(_SPACE.sub(" ", text).strip()):
        current = f"{current} {piece}" if current else piece
        if not _NOT_AN_END.search(current):
            parts.append(current)
            current = ""
    if current:
        parts.append(current)
    return [part for part in parts if any(char.isalnum() for char in part)]

def finished(text):
    body = _TEXT_END.sub("", text)
    if not body:
        return text
    last = _SPACE.split(body)[-1]
    if any(char.isalnum() for char in last):
        marked = last.rstrip(_CLOSING)[-1:] in tuple(".!?…,;:")
    else:
        marked = any(char in ".!?…" for char in last) or last in (",", ";", ":")
    return text if marked else body + "."

def shorter(text):
    pieces = _CLAUSE_END.split(text)
    if len(pieces) > 1:
        return pieces
    words = text.split(" ")
    if len(words) < 2:
        return []
    half = (len(words) + 1) // 2
    return [" ".join(words[:half]), " ".join(words[half:])]

NODE = """
import fs from 'node:fs'; import path from 'node:path';
const { spokenTexts } = await import(path.resolve(process.argv[1], 'shared/timing.mjs'));
const out = new Set();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name === 'storyboard.json')
    for (const s of JSON.parse(fs.readFileSync(p, 'utf8')).scenes ?? []) for (const t of spokenTexts(s))
      if (typeof t === 'string' && t.trim()) out.add(t.trim()); } };
walk(path.join(process.argv[1], 'examples'));
console.log(JSON.stringify([...out].sort()));
"""
examples = json.loads(subprocess.run(["node", "--input-type=module", "-e", NODE, ROOT], capture_output=True, text=True, check=True).stdout)
corpus = [s for text in examples for s in sentences(finished(text))]
for line in open(os.path.join(DIZIONE, "tests/data/tricky_sentences.txt"), encoding="utf-8"):
    if line.startswith("TEXT:"):
        corpus.append(line[5:].strip())
for node in ast.walk(ast.parse(open(os.path.join(DIZIONE, "tests/test_dizione.py"), encoding="utf-8").read())):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        s = node.value.strip()
        if s and len(s) < 300 and "\n" not in s and any(c.isalnum() for c in s):
            corpus.append(s)
rng = random.Random(46)
def num():
    k = rng.choice([1, 1, 2, 2, 3, 4, 5, 6, 7, 9, 12])
    return str(rng.randrange(10 ** (k - 1) if k > 1 else 0, 10 ** k))
def commas(n):
    return f"{int(n):,}"
templates = [
    lambda: f"It costs ${num()}.{rng.randrange(100):02d} today.",
    lambda: f"We raised ${num()}{rng.choice(['k', 'M', 'm', 'B', 'bn', ' million', ' billion', ''])} last year.",
    lambda: f"The fee is {rng.choice(['£', '€', '¥', '₹', 'USD ', 'EUR ', 'GBP '])}{commas(num())}.",
    lambda: f"That is {num()} {rng.choice(['€', 'EUR', '$'])} per month.",
    lambda: f"About {commas(num())} people came.",
    lambda: f"The value is {num()}.{num()} and rising.",
    lambda: f"Set the timeout to {num()} {rng.choice(['ms', 's', 'seconds', 'minutes', 'MB', 'GB', 'KB', 'km', 'kg', 'px', '%', 'percent'])}.",
    lambda: f"It grew {num()}% in {rng.randrange(1900, 2100)}.",
    lambda: f"Meet me at {rng.randrange(1, 13)}:{rng.randrange(60):02d} {rng.choice(['am', 'pm', 'AM', 'PM', 'a.m.', 'p.m.', ''])}.",
    lambda: f"The release is on {rng.randrange(1, 13)}/{rng.randrange(1, 29)}/{rng.randrange(1990, 2040)}.",
    lambda: f"It shipped on {rng.randrange(1990, 2040)}-{rng.randrange(1, 13):02d}-{rng.randrange(1, 29):02d}.",
    lambda: f"See you on {rng.choice(['January', 'March', 'Sept', 'Dec', 'July'])} {rng.randrange(1, 32)}, {rng.randrange(1900, 2100)}.",
    lambda: f"Upgrade to {rng.choice(['v', 'version ', 'Node ', 'Python ', 'React ', ''])}{rng.randrange(0, 30)}.{rng.randrange(0, 40)}.{rng.randrange(0, 20)} first.",
    lambda: f"Install Python 3.{rng.randrange(0, 14)} or later.",
    lambda: f"Call {rng.randrange(200, 999)}-{rng.randrange(200, 999)}-{rng.randrange(1000, 9999)} now.",
    lambda: f"Your order number is {num()}{num()}.",
    lambda: f"Ticket {rng.choice(['AB', 'JIRA', 'MR', 'X'])}-{num()} is open.",
    lambda: f"The {rng.randrange(1, 200)}{rng.choice(['st', 'nd', 'rd', 'th'])} try worked.",
    lambda: f"Add {rng.randrange(1, 10)}/{rng.choice([2, 3, 4, 8, 16])} cup of sugar.",
    lambda: f"The ratio is {rng.randrange(1, 30)}:{rng.randrange(1, 30)} here.",
    lambda: f"In the {rng.choice(['1990s', '80s', '2020s', "'90s"])} it changed.",
    lambda: f"Then {rng.choice(['x', 'n', 'count', 'a', 'b', 'k'])} {rng.choice(['>', '<', '>=', '<=', '!=', '=', '=='])} {num()} holds.",
    lambda: f"Open {rng.choice(['src/index.ts', 'README.md', 'bin/lib/voice.mjs', 'package.json', 'Cargo.toml', 'shared/timing.mjs', 'config.yaml', 'main.rs'])} first.",
    lambda: f"Visit {rng.choice(['https://example.com/docs', 'www.github.com', 'huggingface.co/n4ze3m', 'api.stripe.com/v1/charges'])} for details.",
    lambda: f"Email {rng.choice(['jane.doe@example.com', 'ops@acme.io', 'support@mr-cast.dev'])} today.",
    lambda: f"The function {rng.choice(['parseProgress', 'ensureVoiceover', 'getUserById', 'fetchJSON', 'XMLHttpRequest', 'useEffect', 'toString', 'iOS', 'macOS'])} returns early.",
    lambda: f"Rename {rng.choice(['user_id', 'max_retries', 'HTTP_PROXY', 'snake_case_name', '__init__', 'kebab-case-name', 'v2-api'])} please.",
    lambda: f"The {rng.choice(['API', 'CLI', 'JSON', 'HTTP', 'SQL', 'CPU', 'GPU', 'URL', 'UI', 'CI', 'PR', 'MR', 'SHA', 'AAC', 'MP4', 'WAV', 'ONNX', 'NASA', 'SCUBA'])} layer {rng.choice(['fails', 'waits', 'retries'])}.",
    lambda: f"Dr. {rng.choice(['Smith', 'Patel', 'Lee'])} met Mr. {rng.choice(['Jones', 'Brown'])} on {rng.choice(['St.', 'Main St.', 'Elm Dr.'])} at noon.",
    lambda: f"{rng.choice(['lol', 'brb', 'idk', 'gr8', 'b4', 'thx', 'k', 'u', 'ur', 'pls'])} {rng.choice(['see you', 'that works', 'ok'])} {rng.choice([':)', ':-(', ';)', '<3', '🙂', '🚀', 'xD', ''])}",
    lambda: f"It read {num()} records and wrote {num()} of them.",
    lambda: f"I {rng.choice(['read', 'live', 'lead', 'record', 'present', 'object', 'close', 'wind', 'tear', 'bow'])} the {rng.choice(['book', 'show', 'pipe', 'file', 'gift', 'door'])} {rng.choice(['yesterday', 'now', 'every day', 'again'])}.",
    lambda: f"Temperature dropped to -{num()}°C overnight.",
    lambda: f"A {rng.randrange(2, 99)}x speedup, from {num()}ms to {num()}ms.",
    lambda: f"Sizes S-XL, page {rng.randrange(1, 400)}, section §{rng.randrange(1, 40)}, item #{num()}.",
    lambda: f"Use RTX {rng.choice(['4070', '3090'])} Ti and ISO {rng.choice(['9001', '27001'])} at 1080p.",
    lambda: f"The SHA {''.join(rng.choice('0123456789abcdef') for _ in range(7))} broke the build.",
    lambda: f"Between {rng.randrange(1900, 2000)}-{rng.randrange(2000, 2030)} and {num()}-{num()} we saw it.",
    lambda: f"Pi is about 3.14159, e is 2.718, and ½ of {num()} is small.",
    lambda: f"WAIT, THE {rng.choice(['SERVER', 'BUILD', 'TEST'])} IS {rng.choice(['DOWN', 'RED', 'FLAKY'])} AGAIN!",
    lambda: f"Sooo {rng.choice(['goooood', 'coooool', 'niiice', 'yesss'])}, {rng.choice(['heyyy', 'hmm', 'shh', 'psst'])}!",
    lambda: f"Say {{K UW1 B ER0 N EH1 T IY0 Z}} or {{h ə l ˈoʊ}} or {{name}} here.",
    lambda: f"Run `npm i -g @shiyuphan/mr-cast` then `mr-cast play --port {rng.randrange(1000, 9999)}`.",
]
for _ in range(3400):
    corpus.append(rng.choice(templates)())
rng = random.Random(4646)
C, V = "bcdfghjklmnprstvwxz", "aeiouy"
def pseudo():
    return "".join(rng.choice(C) + rng.choice(V) + (rng.choice(C) if rng.random() < .5 else "") for _ in range(rng.randrange(1, 4)))
lex = [l.split("\t")[0] for l in open(os.path.join(os.environ['DIZIONE_DATA'], 'lexicon.tsv'), encoding='utf-8')]
out = []
for _ in range(700):
    out.append(f"The {pseudo()} {rng.choice(['service','queue','module'])} calls {pseudo().capitalize()} and {pseudo()}s.")
for _ in range(700):
    ws = rng.sample(lex, rng.randrange(3, 9))
    out.append(" ".join(ws).capitalize() + rng.choice([".", "?", "!", ",", "", "…", ";"]))
signs = ["a=10", "b>a", "x<5", "p<.05", "k = k + 1", "f(a, b)", "(a)", "a) first", "67 > 66", "n >= 2", "for n > 4", "if b>a then",
         "<b>bold</b>", "Vec<u64>", "map<int, int>", "x ≥ 0", "y ≠ z", "2^10", "3 × 4 m", "10-3=7", "$x = 2$", "→ next", "50/50", "24/7",
         "1 000 000 people", "+44 20 7946 0958", "IN 2019 150", "Wi-Fi", "COVID-19", "pre-2020", "B-12", "AB-4471-Z", "#A7-4419",
         "café", "naïve résumé", "Zoë and Björk", "straße", "日本語 text", "🙂 ok 🚀🚀", "e.g. this", "i.e. that", "U.S. law", "p.m. Then",
         "Sss!", "zzz", "Hmm, ss, tsk", "k, thanks", "the value of k", "see you there, k?", "iPhone", "YouTube", "JavaScript", "macOS's",
         "soooo goooood", "NASA's", "API's", "C++", "C#", "F#", ".NET", "node_modules", "~/projects", "a/b testing", "w/o sugar", "n/a",
         "Mon.-Fri.", "Jan-Mar", "3-17 November", "November 3-17, 2026", "22 February", "5 Jan. 2026", "14/03", "08/27 card", "1/2 cup",
         "2 1/2", "½ cup", "1½ hours", "3.5%", "1,5 kg", "€12,50", "1.299,50 €", "750 000 $", "5-10 €", "-5°C", "10 m²", "3 m3",
         "2:03:45", "48:12 long", "9.30 to 11.30 opening hours", "7.30 pm", "noon at 12:00", "0:00", "16:9 ratio", "1:25,000",
         "RTX 4070 Ti", "ISO 9001", "1080p", "4K", "PS5", "X7K", "14C", "the 1990s", "'90s", "1st", "22nd", "Chapter IV", "World War II",
         "Henry VIII", "Plan A.", "vitamin A", "A dog", "I read it", "I will read it", "have you read", "a live show", "they live here",
         "lead pipe", "lead the team", "wind blows", "wind the clock", "tear in the eye", "tear the paper", "bow to the king", "take a bow"]
for _ in range(900):
    k = rng.randrange(1, 4)
    out.append(" ".join(rng.choice(signs) for _ in range(k)) + rng.choice([".", "", "?", "!"]))
for s in signs:
    out.append(s); out.append(f"Then {s} again.")
corpus += out

import dizione
from dizione.engine import Phonemizer
phonemizer = Phonemizer()
seen, fixtures = set(), []
for text in corpus:
    if text in seen:
        continue
    seen.add(text)
    try:
        fixtures.append([text, str(dizione.symbols.tokenize(phonemizer.pieces(text)))])
    except ValueError:
        fixtures.append([text, None])
json.dump(fixtures, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "phonemes.json"), "w"), ensure_ascii=False, indent=0)
print(len(fixtures))
