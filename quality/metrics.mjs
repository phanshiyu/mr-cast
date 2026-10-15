// Per-fixture storyboard metrics. Usage: node metrics.mjs <workdir>   (JSON to <workdir>/metrics.json, table to stdout)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sceneDurationInFrames, spokenTexts, wordCount, FPS } = await import(pathToFileURL(path.join(root, 'shared/timing.mjs')));
const { expandLineRefs } = await import(pathToFileURL(path.join(root, 'shared/focus.mjs')));
const { isTestFile } = await import(pathToFileURL(path.join(root, 'shared/test-files.mjs')));

const work = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(work)) {
  console.error('usage: node metrics.mjs <workdir>');
  process.exit(1);
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

function changedLines(hunk) {
  return hunk.lines.filter((l) => l.type !== 'context').length;
}

function highlighted(scene, hunk) {
  if (!hunk) return 0;
  const after = scene.focusLinesAfter ?? [];
  const before = scene.focusLinesBefore ?? [];
  if (!after.length && !before.length) return changedLines(hunk);
  return expandLineRefs(after).size + expandLineRefs(before).size;
}

function measure(name, dir) {
  const repo = path.join(dir, 'repo', '.mr-cast');
  const sb = readJson(path.join(repo, 'storyboard.json'));
  const hunks = readJson(path.join(repo, 'hunks.json')) ?? {};
  if (!sb) return { fixture: name, hasStoryboard: false };
  const status = fs.existsSync(path.join(dir, 'validate.status')) ? fs.readFileSync(path.join(dir, 'validate.status'), 'utf8').trim() : 'unknown';
  const scenes = sb.scenes ?? [];
  const mix = {};
  let words = 0, lines = 0, maxLines = 0, codeScenes = 0, frames = 0;
  const covered = new Set();
  const testsScene = { present: false, cases: 0, gaps: 0 };
  for (const s of scenes) {
    mix[s.type] = (mix[s.type] ?? 0) + 1;
    words += spokenTexts(s).reduce((n, text) => n + wordCount(text), 0);
    frames += sceneDurationInFrames(s, null);
    if (s.type === 'code') {
      codeScenes++;
      covered.add(s.hunkId);
      const n = highlighted(s, hunks[s.hunkId]);
      lines += n;
      maxLines = Math.max(maxLines, n);
    }
    if (s.type === 'tests') {
      testsScene.present = true;
      testsScene.cases += s.cases?.length ?? 0;
      testsScene.gaps += s.gaps?.length ?? 0;
      // validate counts a case's linked hunk as shown, so the coverage columns do too.
      for (const c of s.cases ?? []) if (c.hunkId) covered.add(c.hunkId);
    }
  }
  const all = Object.values(hunks);
  const shown = all.filter((h) => covered.has(h.id));
  const lineSum = (hs) => hs.reduce((n, h) => n + changedLines(h), 0);
  const tests = all.filter((h) => isTestFile(h.file));
  return {
    fixture: name, hasStoryboard: true, validation: status, scenes: scenes.length, sceneMix: mix,
    estSeconds: Math.round(frames / FPS), narrationWords: words, highlightedLines: lines, maxLinesInScene: maxLines,
    codeScenes, hunksCovered: shown.length, hunksTotal: all.length,
    linesCovered: lineSum(shown), linesTotal: lineSum(all),
    testHunksShown: tests.filter((h) => covered.has(h.id)).length, testHunksTotal: tests.length,
    testsScene,
  };
}

const rows = fs.readdirSync(work, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(work, d.name, 'repo')))
  .map((d) => measure(d.name, path.join(work, d.name)))
  .sort((a, b) => a.fixture.localeCompare(b.fixture));

const have = rows.filter((r) => r.hasStoryboard);
const sum = (k) => have.reduce((a, r) => a + r[k], 0);
const mixTotal = {};
for (const r of have) for (const [t, n] of Object.entries(r.sceneMix)) mixTotal[t] = (mixTotal[t] ?? 0) + n;
const total = have.length ? {
  validationPass: have.filter((r) => r.validation === 'pass').length, fixtures: have.length,
  scenes: sum('scenes'), sceneMix: mixTotal, estSeconds: sum('estSeconds'), narrationWords: sum('narrationWords'),
  highlightedLines: sum('highlightedLines'), maxLinesInScene: Math.max(...have.map((r) => r.maxLinesInScene)),
  codeScenes: sum('codeScenes'), hunksCovered: sum('hunksCovered'), hunksTotal: sum('hunksTotal'),
  linesCovered: sum('linesCovered'), linesTotal: sum('linesTotal'),
  testHunksShown: sum('testHunksShown'), testHunksTotal: sum('testHunksTotal'),
  testsScene: {
    present: have.filter((r) => r.testsScene.present).length,
    cases: have.reduce((a, r) => a + r.testsScene.cases, 0),
    gaps: have.reduce((a, r) => a + r.testsScene.gaps, 0),
  },
} : null;

fs.writeFileSync(path.join(work, 'metrics.json'), `${JSON.stringify({ fixtures: rows, total }, null, 2)}\n`);

const mixStr = (m) => Object.entries(m).map(([t, n]) => `${t}:${n}`).join(' ');
// Share of changed lines that sit in shown hunks, so one big unshown hunk outweighs several small ones.
const linePct = (r) => (r.linesTotal ? `${Math.round((100 * r.linesCovered) / r.linesTotal)}%` : '-');
const testCol = (r) => (r.testHunksTotal ? `${r.testHunksShown}/${r.testHunksTotal}` : '-');
// "yes 4c/2g": has a tests scene with 4 cases and 2 gaps. The total row counts fixtures with one instead.
const testsSceneCol = ({ testsScene: t, fixtures }) => {
  const counts = `${t.cases}c/${t.gaps}g`;
  if (fixtures) return `${t.present}/${fixtures} ${counts}`;
  return t.present ? `yes ${counts}` : 'no';
};
const table = [['fixture', 'valid', 'scenes', 'secs', 'words', 'hl lines', 'max hl', 'code', 'hunks', 'lines shown', 'tests', 'tests scene', 'mix']];
for (const r of rows) {
  table.push(r.hasStoryboard
    ? [r.fixture, r.validation, r.scenes, r.estSeconds, r.narrationWords, r.highlightedLines, r.maxLinesInScene, r.codeScenes, `${r.hunksCovered}/${r.hunksTotal}`, linePct(r), testCol(r), testsSceneCol(r), mixStr(r.sceneMix)]
    : [r.fixture, 'no storyboard']);
}
if (total) table.push(['TOTAL', `${total.validationPass}/${total.fixtures}`, total.scenes, total.estSeconds, total.narrationWords, total.highlightedLines, total.maxLinesInScene, total.codeScenes, `${total.hunksCovered}/${total.hunksTotal}`, linePct(total), testCol(total), testsSceneCol(total), mixStr(total.sceneMix)]);
const widths = table[0].map((_, i) => Math.max(...table.map((r) => String(r[i] ?? '').length)));
for (const r of table) console.log(r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd());
