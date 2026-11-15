// Aggregates <workdir>/<video>/critic.json into per-video and overall understanding numbers (ADR 0037).
// Usage: node understanding.mjs <workdir>   (JSON to <workdir>/understanding.json, table to stdout)
import fs from 'node:fs';
import path from 'node:path';

const GRADES = ['correct', 'partly', 'wrong', 'not_shown'];
const QUESTIONS = ['why', 'case', 'approach', 'parts', 'proof', 'check'];
const IDS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];

const work = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(work)) {
  console.error('usage: node understanding.mjs <workdir>');
  process.exit(1);
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const summarise = (name, c) => {
  const counts = Object.fromEntries(GRADES.map((g) => [g, 0]));
  for (const a of Array.isArray(c.answers) ? c.answers : []) {
    if (IDS.includes(a?.id) && a.grade in counts) counts[a.grade]++;
  }
  const answered = GRADES.reduce((s, g) => s + counts[g], 0);
  const q = { well: 0, weakly: 0, not: 0 };
  for (const k of QUESTIONS) if (c.questions?.[k] in q) q[c.questions[k]]++;
  return {
    video: name,
    ...counts,
    graded: answered,
    score: counts.correct + counts.partly / 2,
    outOf: IDS.length,
    contradicted: Array.isArray(c.contradicted) ? c.contradicted.length : 0,
    questions: q,
    ease: num(c.ease),
    confident: num(c.confident),
  };
};

const rows = [];
for (const d of fs
  .readdirSync(work, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const file = path.join(work, d.name, 'critic.json');
  if (!fs.existsSync(file)) continue;
  let c;
  try {
    c = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(`${d.name}: critic.json is not valid JSON, skipped`);
    continue;
  }
  if (!c || typeof c !== 'object' || !Array.isArray(c.answers)) {
    console.error(`${d.name}: critic.json has no answers list, skipped`);
    continue;
  }
  rows.push(summarise(d.name, c));
}

const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const overall = {
  videos: rows.length,
  ...Object.fromEntries(GRADES.map((g) => [g, sum((r) => r[g])])),
  score: sum((r) => r.score),
  outOf: sum((r) => r.outOf),
  contradicted: sum((r) => r.contradicted),
  questions: {
    well: sum((r) => r.questions.well),
    weakly: sum((r) => r.questions.weakly),
    not: sum((r) => r.questions.not),
  },
  ease: mean(rows.map((r) => r.ease).filter((x) => x !== null)),
  confident: mean(rows.map((r) => r.confident).filter((x) => x !== null)),
};
fs.writeFileSync(path.join(work, 'understanding.json'), `${JSON.stringify({ videos: rows, overall }, null, 2)}\n`);

const fmt = (x) => (x === null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const line = (name, r) => [
  name,
  `${r.correct}/${r.partly}/${r.wrong}/${r.not_shown}`,
  `${fmt(r.score)}/${r.outOf}`,
  r.contradicted,
  `${r.questions.well}/${r.questions.weakly}/${r.questions.not}`,
  fmt(r.ease),
  fmt(r.confident),
];
const table = [['video', 'c/p/w/ns', 'score', 'contradicted', 'well/weakly/not', 'ease', 'confident']];
for (const r of rows) table.push(line(r.video, r));
table.push(line('OVERALL', overall));
const widths = table[0].map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
for (const r of table)
  console.log(
    r
      .map((c, i) => String(c).padEnd(widths[i]))
      .join('  ')
      .trimEnd(),
  );
if (!rows.length) console.log('(no critic.json files found)');
