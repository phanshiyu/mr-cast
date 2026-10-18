// Per phase, arm and fixture: accuracy, evidence, seeded bug found, and effort from the reviewer transcripts,
// as mean [min-max] over runs. Writes <results>/report.json and prints tables.
// Usage: node report.mjs <results-dir>
// Reads writers.tsv (A runs), runsB.tsv, runsC.tsv, grade-map.tsv (anonymous answer file to run), the graders'
// grades.json next to each answer file, and <results>/<phase>/<run>/transcript.json.
import fs from 'node:fs';
import path from 'node:path';

const res = path.resolve(process.argv[2] ?? '');
const tsv = (f) => {
  const p = path.join(res, f);
  if (!fs.existsSync(p)) return [];
  const [head, ...rows] = fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('\t'));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};
const runs = [
  ...tsv('writers.tsv').map((r) => ({ phase: 'A', run: r.id, fixture: r.fixture, arm: r.arm })),
  ...tsv('runsB.tsv').map((r) => ({ phase: 'B', run: r.id, fixture: r.fixture, arm: r.arm })),
  ...tsv('runsC.tsv').map((r) => ({ phase: 'C', run: r.id, fixture: r.fixture, arm: r.arm })),
];
const grades = new Map();
for (const m of tsv('grade-map.tsv')) {
  const gfile = path.join(path.dirname(m.file), 'grades.json');
  if (!fs.existsSync(gfile)) continue;
  const g = JSON.parse(fs.readFileSync(gfile, 'utf8')).find((x) => path.basename(x.file) === path.basename(m.file));
  if (g) grades.set(`${m.phase}/${m.run}`, g);
}
for (const r of runs) {
  const t = path.join(res, r.phase, r.run, 'transcript.json');
  r.t = fs.existsSync(t) ? JSON.parse(fs.readFileSync(t, 'utf8')) : null;
  r.g = grades.get(`${r.phase}/${r.run}`) ?? null;
  if (r.g) {
    const a = r.g.answers ?? [];
    r.accuracy = a.reduce((s, x) => s + x.correct, 0) / a.length;
    r.evidence = a.some((x) => typeof x.evidence === 'number')
      ? a.reduce((s, x) => s + (x.evidence ?? 0), 0) / a.length
      : null;
    r.bug = typeof r.g.bug_found === 'number' ? r.g.bug_found : null;
    r.falseDefects = r.g.false_defects ?? null;
    r.ease = r.g.ease ?? null;
  }
}
const stat = (xs) => {
  const v = xs.filter((x) => typeof x === 'number');
  if (!v.length) return '-';
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const f = (x) => (Math.abs(x) >= 100 ? Math.round(x).toString() : x.toFixed(2).replace(/\.?0+$/, ''));
  return v.length === 1 ? f(mean) : `${f(mean)} [${f(Math.min(...v))}-${f(Math.max(...v))}]`;
};
const cols = {
  A: [
    ['acc', (r) => r.accuracy],
    ['ease', (r) => r.ease],
    ['calls', (r) => r.t?.toolCalls],
    ['scenes', (r) => r.t?.scenesViewed],
    ['secs', (r) => r.t?.wallSeconds],
  ],
  B: [
    ['acc', (r) => r.accuracy],
    ['evid', (r) => r.evidence],
    ['bug', (r) => r.bug],
    ['falseDef', (r) => r.falseDefects],
    ['calls', (r) => r.t?.toolCalls],
    ['repoFiles', (r) => r.t?.repoFilesOpened.length],
    ['scenes', (r) => r.t?.scenesViewed],
    ['readChars', (r) => r.t?.toolResultChars],
    ['peakCtx', (r) => r.t?.tokens.peakContext],
    ['outTok', (r) => r.t?.tokens.output],
    ['secs', (r) => r.t?.wallSeconds],
    ['ease', (r) => r.ease],
  ],
};
cols.C = cols.B;
const out = {};
for (const phase of ['A', 'B', 'C']) {
  const rs = runs.filter((r) => r.phase === phase);
  if (!rs.length) continue;
  const groups = new Map();
  for (const r of rs)
    for (const key of [`${r.arm} ${r.fixture}`, `${r.arm} ALL`]) groups.set(key, [...(groups.get(key) ?? []), r]);
  const table = [['arm fixture', 'n', ...cols[phase].map(([n]) => n)]];
  for (const key of [...groups.keys()].sort((a, b) => a.endsWith('ALL') - b.endsWith('ALL') || a.localeCompare(b))) {
    const g = groups.get(key);
    table.push([key, String(g.length), ...cols[phase].map(([, fn]) => stat(g.map(fn)))]);
  }
  out[phase] = { table, runs: rs.map(({ t, g, ...r }) => ({ ...r, transcript: t, grade: g })) };
  console.log(`\nPhase ${phase}`);
  const w = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  for (const row of table) console.log(row.map((c, i) => c.padEnd(w[i])).join('  '));
}
fs.writeFileSync(path.join(res, 'report.json'), `${JSON.stringify(out, null, 2)}\n`);
