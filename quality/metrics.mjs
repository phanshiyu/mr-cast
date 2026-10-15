// Per-fixture storyboard metrics. Usage: node metrics.mjs <workdir>   (JSON to <workdir>/metrics.json, table to stdout)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sceneDurationInFrames, wordCount, FPS } = await import(pathToFileURL(path.join(root, 'shared/timing.mjs')));
const { expandLineRefs } = await import(pathToFileURL(path.join(root, 'shared/focus.mjs')));

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
  for (const s of scenes) {
    mix[s.type] = (mix[s.type] ?? 0) + 1;
    words += wordCount(s.narration);
    frames += sceneDurationInFrames(s.narration, null);
    if (s.type === 'code') {
      codeScenes++;
      covered.add(s.hunkId);
      const n = highlighted(s, hunks[s.hunkId]);
      lines += n;
      maxLines = Math.max(maxLines, n);
    }
  }
  return {
    fixture: name, hasStoryboard: true, validation: status, scenes: scenes.length, sceneMix: mix,
    estSeconds: Math.round(frames / FPS), narrationWords: words, highlightedLines: lines, maxLinesInScene: maxLines,
    codeScenes, hunksCovered: [...covered].filter((id) => hunks[id]).length, hunksTotal: Object.keys(hunks).length,
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
} : null;

fs.writeFileSync(path.join(work, 'metrics.json'), `${JSON.stringify({ fixtures: rows, total }, null, 2)}\n`);

const mixStr = (m) => Object.entries(m).map(([t, n]) => `${t}:${n}`).join(' ');
const table = [['fixture', 'valid', 'scenes', 'secs', 'words', 'hl lines', 'max hl', 'code', 'hunks', 'mix']];
for (const r of rows) {
  table.push(r.hasStoryboard
    ? [r.fixture, r.validation, r.scenes, r.estSeconds, r.narrationWords, r.highlightedLines, r.maxLinesInScene, r.codeScenes, `${r.hunksCovered}/${r.hunksTotal}`, mixStr(r.sceneMix)]
    : [r.fixture, 'no storyboard']);
}
if (total) table.push(['TOTAL', `${total.validationPass}/${total.fixtures}`, total.scenes, total.estSeconds, total.narrationWords, total.highlightedLines, total.maxLinesInScene, total.codeScenes, `${total.hunksCovered}/${total.hunksTotal}`, mixStr(total.sceneMix)]);
const widths = table[0].map((_, i) => Math.max(...table.map((r) => String(r[i] ?? '').length)));
for (const r of table) console.log(r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd());
