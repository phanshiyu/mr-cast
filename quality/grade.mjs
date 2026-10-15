// Aggregates <workdir>/<fixture>/grades.json into per-fixture and overall accuracy and ease.
// Usage: node grade.mjs <workdir>   (JSON to <workdir>/grades-summary.json, table to stdout)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const keysDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'keys');

const work = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(work)) {
  console.error('usage: node grade.mjs <workdir>');
  process.exit(1);
}

const rows = [];
for (const d of fs.readdirSync(work, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const file = path.join(work, d.name, 'grades.json');
  if (!fs.existsSync(file)) continue;
  let g;
  try { g = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { console.error(`${d.name}: grades.json is not valid JSON, skipped`); continue; }
  const answers = Array.isArray(g.answers) ? g.answers.filter((a) => typeof a.correct === 'number') : [];
  const key = path.join(keysDir, `${d.name}.json`);
  const expected = fs.existsSync(key) ? JSON.parse(fs.readFileSync(key, 'utf8')).questions.length : 5;
  const points = answers.reduce((s, a) => s + a.correct, 0);
  rows.push({
    fixture: d.name, graded: answers.length, expected, points,
    accuracy: answers.length ? points / expected : null,
    ease: typeof g.ease === 'number' ? g.ease : null,
    confusingScene: g.confusing_scene ?? null,
    wrong: answers.filter((a) => a.correct < 1).map((a) => `${a.id}=${a.correct}`),
  });
}

const accs = rows.filter((r) => r.accuracy !== null);
const eases = rows.filter((r) => r.ease !== null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const overall = {
  fixturesGraded: rows.length,
  accuracy: mean(accs.map((r) => r.accuracy)),
  pointsTotal: rows.reduce((s, r) => s + r.points, 0),
  questionsTotal: rows.reduce((s, r) => s + r.expected, 0),
  ease: mean(eases.map((r) => r.ease)),
};
fs.writeFileSync(path.join(work, 'grades-summary.json'), `${JSON.stringify({ fixtures: rows, overall }, null, 2)}\n`);

const pct = (x) => (x === null ? '-' : `${(x * 100).toFixed(0)}%`);
const fmt = (x) => (x === null ? '-' : x.toFixed(2));
const table = [['fixture', 'points', 'accuracy', 'ease', 'missed', 'most confusing scene']];
for (const r of rows) table.push([r.fixture, `${r.points}/${r.expected}`, pct(r.accuracy), r.ease ?? '-', r.wrong.join(' ') || '-', r.confusingScene ?? '-']);
table.push(['OVERALL', `${overall.pointsTotal}/${overall.questionsTotal}`, pct(overall.accuracy), fmt(overall.ease), '', '']);
const widths = table[0].map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
for (const r of table) console.log(r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd());
if (!rows.length) console.log('(no grades.json files found)');
