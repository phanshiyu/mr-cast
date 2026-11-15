import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreOnScreen, coreOnScreenLine } from '../shared/brief.mjs';
import { shownHunkLines } from '../shared/shown-hunks.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatOutline, formatValidation } from '../bin/lib/summary.mjs';

const row = (type, n, text) => ({
  type,
  oldLine: type === 'add' ? null : n,
  newLine: type === 'del' ? null : n,
  text,
});
const hunk = (id, file, lines) => ({
  id,
  file,
  oldFile: null,
  status: 'modified',
  language: 'javascript',
  header: '',
  startLine: 1,
  oldStartLine: 1,
  endLine: lines.length,
  additions: lines.filter((l) => l.type === 'add').length,
  deletions: lines.filter((l) => l.type === 'del').length,
  beforeCode: '',
  afterCode: '',
  lines,
});
// Ten added lines, numbered 1 to 10, and a second hunk of three.
const hunks = {
  h1: hunk(
    'h1',
    'src/refs.js',
    Array.from({ length: 10 }, (_, i) => row('add', i + 1, `const a${i + 1} = ${i};`)),
  ),
  h2: hunk('h2', 'src/page.js', [row('del', 1, 'old();'), row('add', 1, 'now();'), row('context', 2, 'same();')]),
  h3: hunk('h3', 'src/other.js', [row('add', 1, 'x();'), row('add', 2, 'y();')]),
};
const brief = {
  parts: [
    { name: 'Finding refs', weight: 'core', hunks: ['h1'] },
    { name: 'The page', weight: 'core', hunks: ['h2', 'h3', 'h3'] },
    { name: 'Docs', weight: 'routine', hunks: [] },
  ],
};
const flow = (code) => ({
  type: 'flow',
  narration: 'A request goes in.',
  steps: [{ actor: 'Client', action: 'sends it', code }],
});
const compare = (...cells) => ({ type: 'compare', narration: 'Before and after.', rows: [{ cells }] });

test('a flow stop counts the changed lines of its range, and a compare hunk cell those it reads', () => {
  const shown = shownHunkLines(
    [
      flow({ hunk: 'h1', lines: '3-6', light: '4' }),
      compare({ hunk: 'h2', side: 'old', lines: '1-2' }, { hunk: 'h2', side: 'new', lines: '1-2' }),
    ],
    hunks,
  );
  assert.deepEqual([...shown.get('h1')], [2, 3, 4, 5]);
  assert.deepEqual([...shown.get('h2')].sort(), [0, 1], 'the context line is not a changed line');
  assert.equal(shown.has('h3'), false);
});

test('a code scene counts all of its hunk without a layout, and a tests scene or reading item counts none', () => {
  const shown = shownHunkLines(
    [
      { type: 'code', hunkId: 'h3', narration: 'x' },
      { type: 'tests', tests: [{ hunkId: 'h1' }] },
      { type: 'reading', items: [{ hunkId: 'h1' }] },
    ],
    hunks,
  );
  assert.deepEqual([...shown.keys()], ['h3']);
  assert.equal(shown.get('h3').size, 2);
  // A layout's own answer replaces it.
  assert.deepEqual(
    [...shownHunkLines([{ type: 'code', hunkId: 'h1', narration: 'x' }], hunks, new Map([[0, [1, 2]]])).get('h1')],
    [1, 2],
  );
});

test('each core part says how many of its changed lines are on screen, once per hunk', () => {
  const lines = shownHunkLines(
    [flow({ hunk: 'h1', lines: '1-4' }), { type: 'code', hunkId: 'h3', narration: 'x' }],
    hunks,
  );
  const core = coreOnScreen(brief, hunks, lines);
  assert.deepEqual(core, [
    { name: 'Finding refs', shown: 4, total: 10 },
    { name: 'The page', shown: 2, total: 4 },
  ]);
  assert.equal(coreOnScreenLine(core), 'core on screen: Finding refs 4 of 10 changed lines · The page 2 of 4');
  assert.equal(coreOnScreenLine([]), '');
});

test('validate counts the lines a code scene frames, and validate and outline print the line after the brief line', async () => {
  const sb = {
    title: 'T',
    brief: { ...brief, why: { text: 'Because.', source: 'code' } },
    scenes: [
      {
        type: 'code',
        hunkId: 'h1',
        narration: 'The first lines.',
        steps: [{ lines: '1-3', say: 'The first three.' }],
      },
    ],
  };
  const result = await validateStoryboard(sb, hunks, { mode: 'diff' });
  assert.deepEqual(result.core, [
    { name: 'Finding refs', shown: 3, total: 10 },
    { name: 'The page', shown: 0, total: 4 },
  ]);
  const lines = formatValidation(result, { storyboard: sb, hunks, seconds: 5 });
  const at = lines.findIndex((l) => l.startsWith('brief:'));
  assert.equal(lines[at + 1], 'core on screen: Finding refs 3 of 10 changed lines · The page 0 of 4');
  const outline = formatOutline({
    storyboard: sb,
    hunks,
    coverage: result.coverage,
    core: result.core,
    seconds: 5,
    voiced: false,
  }).split('\n');
  assert.equal(outline[outline.findIndex((l) => l.startsWith('brief:')) + 1], lines[at + 1]);
  const none = await validateStoryboard({ ...sb, brief: undefined }, hunks, { mode: 'diff' });
  assert.equal(none.core, undefined);
  assert.equal((await validateStoryboard(sb, hunks, { mode: 'explain' })).core, undefined);
});

const snippet = (id, file, from, to) => ({
  ...hunk(
    id,
    file,
    Array.from({ length: to - from + 1 }, (_, i) => row('context', from + i, `line ${from + i};`)),
  ),
  status: 'source',
  startLine: from,
  endLine: to,
});

test('a code scene on a snippet counts the hunk lines its file lines overlap, as shown', async () => {
  const snippets = { ...hunks, s1: snippet('s1', 'src/refs.js', 4, 8), s2: snippet('s2', 'src/other-file.js', 1, 10) };
  const scene = { type: 'code', hunkId: 's1', narration: 'The refs code.' };
  const shown = shownHunkLines([scene], snippets);
  assert.deepEqual(
    [...shown.get('h1')].sort((a, b) => a - b),
    [3, 4, 5, 6, 7],
  );
  assert.equal(shown.has('s1'), false);
  assert.equal(shownHunkLines([{ ...scene, hunkId: 's2' }], snippets).size, 0);
  // Only the lines a frame has on screen count.
  const part = shownHunkLines([scene], snippets, new Map([[0, [0, 1]]]));
  assert.deepEqual(
    [...part.get('h1')].sort((a, b) => a - b),
    [3, 4],
  );

  const sb = {
    title: 'T',
    brief: { ...brief, why: { text: 'Because.', source: 'code' } },
    scenes: [scene],
  };
  const result = await validateStoryboard(sb, snippets, { mode: 'diff' });
  assert.deepEqual(result.core, [
    { name: 'Finding refs', shown: 5, total: 10 },
    { name: 'The page', shown: 0, total: 4 },
  ]);
  assert.equal(result.coverage.shown, 1);
  const unshown = result.warnings.filter((w) => /a core part, but no scene shows/.test(w));
  assert.equal(unshown.length, 1);
  assert.match(unshown[0], /"The page"/);
});
