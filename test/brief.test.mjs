import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatOutline } from '../bin/lib/summary.mjs';
import { briefLine, guideMarkdown } from '../shared/brief.mjs';
import { readingOrder } from '../shared/reading.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hunk = (id, file, texts, start = 1) => ({
  id,
  file,
  oldFile: null,
  status: 'modified',
  language: 'javascript',
  header: '',
  startLine: start,
  oldStartLine: start,
  endLine: start + texts.length - 1,
  additions: texts.length,
  deletions: 0,
  beforeCode: '',
  afterCode: '',
  lines: texts.map((text, i) => ({ type: 'add', oldLine: null, newLine: start + i, text })),
});
const filler = (n, text) => Array.from({ length: n }, (_, i) => `  ${text}(${i});`);
const hunks = {
  h1: hunk('h1', 'src/limiter.js', ['export function checkLimit(ip) {', ...filler(8, 'count'), '}'], 10),
  h2: hunk('h2', 'src/server.js', ['app.use(rateLimit);', ...filler(5, 'route')], 40),
  h3: hunk('h3', 'test/limiter.test.js', ["test('limits', () => {", ...filler(3, 'expect'), '});'], 1),
  h4: hunk('h4', 'README.md', ['Orders are limited to twenty a minute.'], 7),
};
// The limiter replaces a line, so a code scene on h1 shows both the before and the after of the case.
hunks.h1.lines[0] = { ...hunks.h1.lines[0], type: 'del', oldLine: 10, newLine: null };
// What `extract` writes beside hunks.json (docs/adr/0037-reviewer-brief.md, section 1).
const map = {
  commits: [{ sha: '7376000', subject: 'Limit orders', body: 'Bots were placing thousands of orders a minute.' }],
  files: [
    { path: 'src/limiter.js', kind: 'source', status: 'new', added: 10, removed: 0, hunks: ['h1'] },
    { path: 'src/server.js', kind: 'source', status: 'modified', added: 6, removed: 0, hunks: ['h2'] },
    { path: 'test/limiter.test.js', kind: 'tests', status: 'new', added: 5, removed: 0, hunks: ['h3'] },
    { path: 'README.md', kind: 'docs', status: 'modified', added: 1, removed: 0, hunks: ['h4'] },
  ],
  tests: [{ path: 'test/limiter.test.js', covers: ['src/limiter.js'] }],
  untestedSource: ['src/server.js'],
  usedElsewhere: [],
};
const brief = (over = {}) => ({
  why: { text: 'Bots placed thousands of orders a minute.', source: 'commit 7376000' },
  case: {
    before: 'The twenty-first order in a minute was accepted.',
    after: 'It is refused with a 429.',
    cite: ['h1', 'test/limiter.test.js:2'],
  },
  approach: {
    text: 'Count orders per address in a minute.',
    decisions: [{ text: 'The count is per server', source: 'commit 7376000' }],
  },
  parts: [
    { name: 'The limiter', weight: 'core', does: 'Counts orders per address', hunks: ['h1'] },
    {
      name: 'Wiring',
      weight: 'support',
      does: 'Runs the limiter before an order is saved',
      after: ['The limiter'],
      hunks: ['h2'],
    },
    { name: 'Tests and docs', weight: 'routine', hunks: ['h3', 'h4'] },
  ],
  proof: {
    tested: ['A twenty-first order is refused (test/limiter.test.js)'],
    untested: ['Two servers'],
    cite: ['h3'],
  },
  check: [
    {
      file: 'src/server.js',
      line: '40-41',
      what: 'the limiter runs before the order is saved',
      why: 'a refused order must not be saved',
    },
  ],
  ask: ['Why per server and not shared?'],
  ...over,
});
const text = (answers, over = {}) => ({
  type: 'text',
  headline: 'Orders are limited',
  answers,
  narration: 'The branch limits orders per minute.',
  ...over,
});
const code = (id = 'h1', over = {}) => ({
  type: 'code',
  hunkId: id,
  narration: 'The limiter counts each order.',
  answers: ['case'],
  ...over,
});
const ALL = ['why', 'case', 'approach', 'parts', 'proof', 'check'];
const scenes = [text(ALL), code('h1'), code('h2')];
const board = (over = {}) => ({ title: 'Rate limit', scenes, brief: brief(), ...over });
const check = (sb, meta = { map }) => validateStoryboard(sb, hunks, meta);
const warningsOf = async (sb, meta) => (await check(sb, meta)).warnings.filter((w) => /brief|answers/.test(w));

test('a complete brief that every scene supports gives no warning', async () => {
  const result = await check(board());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('a branch storyboard with no brief is warned, an explanation or a quick video is not', async () => {
  const sb = { title: 'Rate limit', scenes };
  assert.match((await warningsOf(sb))[0], /^brief: a video of a branch answers six questions/);
  assert.deepEqual(await warningsOf(sb, { mode: 'explain' }), []);
  assert.deepEqual(await warningsOf(sb, { quick: true }), []);
  assert.deepEqual(await warningsOf(board(), { quick: true }), []);
});

test('a question with no answer is named, and "unknown" is an answer', async () => {
  const sb = board({ brief: brief({ proof: undefined, check: [], why: { source: 'unknown' }, case: 'unknown' }) });
  const warnings = await warningsOf(sb, {});
  assert.equal(warnings.length, 2);
  assert.equal(
    warnings[0],
    'brief.proof: no answer; answer it, or write "unknown" where nothing says, and put the question in "ask"',
  );
  assert.equal(
    warnings[1],
    'brief.check: no places to open first; list what could break, or say in "ask" that nothing looks risky',
  );
  assert.equal(
    briefLine(sb.brief),
    'brief: why unknown · case unknown · approach ✓ 1 decision (1 stated) · parts 3, core 1 · proof ✗ · check ✗ · ask 1',
  );
});

test('a question no scene answers is named', async () => {
  const sb = board({ scenes: [text(['why', 'case', 'approach']), code('h1', { answers: undefined }), code('h2')] });
  assert.deepEqual(await warningsOf(sb), [
    'brief.parts: no scene tells it; add "answers": ["parts"] to the scene that does, or add a scene for it',
    'brief.proof: no scene tells it; add "answers": ["proof"] to the scene that does, or add a scene for it',
    'brief.check: no scene tells it; add "answers": ["check"] to the scene that does, or add a scene for it',
  ]);
  const odd = board({ scenes: [text([...ALL, 'prove'])] });
  assert.match((await warningsOf(odd))[0], /^scenes\[0\]\.answers: must list some of why, case.*did you mean/s);
});

test('a cite, a source sha, a part hunk and a check line that point at nothing are named', async () => {
  const sb = board({
    brief: brief({
      why: { text: 'Bots.', source: 'commit abc1234' },
      case: { before: 'a', after: 'b', cite: ['h99', 'src/nowhere.js:3', '9999999', 'src/limiter.js:2-3', 'nonsense'] },
      parts: [
        { name: 'The limiter', weight: 'core', does: 'Counts orders per address', hunks: ['h1', 'h77'] },
        { name: 'Wiring', weight: 'support', does: 'Runs the limiter before an order is saved', hunks: ['h2'] },
        { name: 'Tests and docs', weight: 'routine', hunks: ['h3', 'h4'] },
      ],
      check: [{ file: 'src/ghost.js', line: 3, what: 'x', why: 'y' }],
    }),
  });
  const warnings = await warningsOf(sb);
  assert.deepEqual(warnings, [
    'brief.case.cite[0]: "h99" is not a hunk id in hunks.json, a path:line, or a short commit sha',
    'brief.case.cite[1]: "src/nowhere.js:3" names src/nowhere.js, which is not a file of the diff',
    'brief.case.cite[2]: "9999999" is not a commit of this branch',
    'brief.case.cite[4]: "nonsense" is not a hunk id in hunks.json, a path:line, or a short commit sha',
    'brief.why.source: "abc1234" is not a commit of this branch',
    'brief.parts[0].hunks[1]: "h77" is not in hunks.json',
    'brief.check[0]: src/ghost.js:3 names src/ghost.js, which is not a file of the diff',
  ]);
});

test('a check line past the end of a file on disk is named', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-brief-root-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/old.js'), 'a\nb\nc\n');
    const sb = board({
      brief: brief({
        check: [
          { file: 'src/old.js', line: '2-3', what: 'x', why: 'y' },
          { file: 'src/old.js', line: 90, what: 'x', why: 'y' },
        ],
      }),
    });
    assert.deepEqual(await warningsOf(sb, { map, root }), [
      'brief.check[1]: src/old.js:90 names line 90, but src/old.js has 4 lines',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hunks of source or test files in no part, and not skipped, are named; so are modified source files no part holds', async () => {
  const sb = board({
    brief: brief({
      parts: [{ name: 'The limiter', weight: 'core', does: 'Counts orders per address', hunks: ['h1'] }],
    }),
    skipped: [{ hunkId: 'h3', reason: 'only a smoke test' }],
  });
  assert.deepEqual(await warningsOf(sb), [
    'brief.parts: 1 hunk of source or test files in no part and not in "skipped": h2 (src/server.js); put each in a part, or skip it with a reason',
    'brief.parts: modified source file no part holds: src/server.js; changed behaviour of existing code is what a reviewer misses, so put it in a part',
  ]);
  // Without a map there is no kind of file to go by, so these checks wait.
  assert.deepEqual(await warningsOf(sb, {}), []);
});

test('the map as extract writes it, files by kind with file, hunkIds and adds, gives the same warnings', async () => {
  const written = {
    commits: map.commits,
    description: null,
    files: {
      source: [
        { file: 'src/server.js', kind: 'source', status: 'modified', additions: 6, deletions: 0, hunkIds: ['h2'] },
        { file: 'src/limiter.js', kind: 'source', status: 'new', additions: 10, deletions: 0, hunkIds: ['h1'] },
      ],
      tests: [
        { file: 'test/limiter.test.js', kind: 'tests', status: 'new', additions: 5, deletions: 0, hunkIds: ['h3'] },
      ],
      docs: [{ file: 'README.md', kind: 'docs', status: 'modified', additions: 1, deletions: 0, hunkIds: ['h4'] }],
      config: [],
      routine: [],
    },
    tests: [{ file: 'test/limiter.test.js', covers: ['src/limiter.js'], adds: ['limits'] }],
    untested: ['src/server.js'],
    usedElsewhere: { method: 'git grep -w', names: [], omitted: 0, stopped: false },
  };
  const sb = board({
    brief: brief({
      parts: [{ name: 'The limiter', weight: 'core', does: 'Counts orders per address', hunks: ['h1'] }],
      proof: { tested: [], untested: [] },
    }),
    skipped: [{ hunkId: 'h3', reason: 'only a smoke test' }],
  });
  assert.deepEqual(await warningsOf(sb, { map: written }), await warningsOf(sb, { map }));
  assert.equal((await warningsOf(sb, { map: written })).length > 2, true);
});

test('a core part that no scene shows or cites is named', async () => {
  const sb = board({ scenes: [text(ALL), code('h2')] });
  assert.deepEqual(await warningsOf(sb, {}), [
    'brief.parts[0] ("The limiter"): a core part, but no scene shows or cites any of its hunks; show one in a code scene, a flow stop\'s "code" or a compare cell, or list one in a reading scene\'s items',
  ]);
  const cited = board({ scenes: [text(ALL, { from: ['h1'] })] });
  assert.deepEqual(await warningsOf(cited, {}), []);
});

test('proof.tested empty while tests changed, and a why inferred while a commit body exists, are named', async () => {
  const sb = board({
    brief: brief({
      proof: { tested: [], untested: ['Everything'] },
      why: { text: 'Probably bots.', source: 'inferred' },
    }),
  });
  assert.deepEqual(await warningsOf(sb), [
    'brief.proof.tested: empty, but this branch changes 1 test file (test/limiter.test.js); say what they show',
    'brief.why.source: "inferred", but a commit body is in map.json; read it, and cite it as "description" or "commit <sha>"',
  ]);
  const described = await warningsOf(board({ brief: brief({ why: { source: 'unknown' } }) }), {
    map: { ...map, commits: [{ sha: '7376000', subject: 's', body: '' }], description: 'Stops bots.' },
  });
  assert.match(described[0], /^brief\.why\.source: "unknown", but the description is in map\.json/);
});

test('a malformed brief is an error, since nothing can read it', async () => {
  const { errors } = await check(
    board({ brief: { why: 'because', parts: [{ name: 'x', weight: 'big', hunks: [] }] } }),
  );
  assert.deepEqual(errors, [
    'brief.why: must be { text, source }',
    'brief.parts[0].weight: must be one of core, support, routine',
  ]);
});

const long = hunk(
  'm1',
  'src/big.js',
  Array.from({ length: 120 }, (_, i) => `const row${i} = ${i};`),
);
const seen = (sb) =>
  validateStoryboard(sb, { ...hunks, m1: long }, {}).then((r) => r.warnings.filter((w) => /never shows/.test(w)));

test('a code scene whose hunk outgrows the frame names the lines never seen', async () => {
  const sb = { title: 'Big', scenes: [code('m1', { answers: undefined })] };
  const [warning] = await seen(sb);
  assert.match(
    warning,
    /^scenes\[0\]: the frame draws \d+ lines at once, and no step's lines bring src\/big\.js lines 1-\d+, \d+-120 into view, so the video never shows them; a step's lines must fit in \d+ to be seen whole, so split a longer step, add a step for these lines, or split the hunk$/,
  );
  const steps = Array.from({ length: 10 }, (_, k) => ({ lines: `${k * 12 + 1}-${k * 12 + 12}`, say: 'A part.' }));
  assert.deepEqual(await seen({ title: 'Big', scenes: [code('m1', { steps })] }), []);
  // A small hunk is wholly in view, and a focus the writer chose crops the rest on purpose.
  assert.deepEqual(await seen({ title: 'Big', scenes: [code('h1')] }), []);
  assert.deepEqual(
    await seen({ title: 'Big', scenes: [code('m1', { steps: [{ lines: '50-52', say: 'Here.' }] })] }),
    [],
  );
});

test('lines within the frame of a step are not warned, nor the context rows kept around it', async () => {
  const frame = Number(/draws (\d+) lines/.exec((await seen({ title: 'Big', scenes: [code('m1')] }))[0])[1]);
  const step = (from, count) => ({ lines: `${from}-${from + count - 1}`, say: 'A part.' });
  // A step that fills the frame is seen whole, and the rows the crop keeps around it are not the writer's to show.
  assert.deepEqual(await seen({ title: 'Big', scenes: [code('m1', { steps: [step(50, frame - 2)] })] }), []);
  // One longer than the frame loses its edges, and the warning says so, with the frame's size.
  const [over] = await seen({ title: 'Big', scenes: [code('m1', { steps: [step(50, frame + 6)] })] });
  assert.match(over, new RegExp(`the frame draws ${frame} lines at once`));
  assert.match(over, /src\/big\.js lines? 50/);
});

test('the brief line of a full brief matches the ADR', () => {
  assert.equal(
    briefLine(brief({ proof: undefined, why: { text: 'x', source: 'commit 7376000' }, parts: brief().parts })),
    'brief: why ✓ (commit 7376000) · case ✓ · approach ✓ 1 decision (1 stated) · parts 3, core 1 · proof ✗ · check 1 · ask 1',
  );
});

test('a reading scene in a plain branch video draws brief.check when it has no items', async () => {
  const reading = { type: 'reading', answers: ['check'], narration: 'Open these first.' };
  const sb = board({ scenes: [text(ALL), code('h1'), code('h2'), reading] });
  const result = await check(sb);
  assert.deepEqual([result.errors, result.warnings], [[], []]);
  const order = readingOrder(sb, hunks);
  assert.deepEqual(
    order.readFirst.map((i) => [i.number, i.where, i.check]),
    [[1, 'src/server.js:40-41', 'the limiter runs before the order is saved']],
  );
  const bare = await check({ ...sb, brief: brief({ check: [] }) });
  assert.match(
    bare.errors[0],
    /^scenes\[3\]\.items: left out, the scene draws brief\.check, which is empty or missing/,
  );
  // Items of its own are still read as before, in any video.
  const own = { ...reading, items: [{ hunkId: 'h2', check: 'the limiter runs first' }] };
  assert.deepEqual((await check({ ...sb, scenes: [text(ALL), code('h1'), code('h2'), own] })).errors, []);
});

test('guide.md names the six answers, the parts with their files and what to open first', () => {
  const md = guideMarkdown(board(), hunks, { branch: 'feature/limit', base: 'main' });
  assert.equal(
    md,
    [
      '# Guide to this change: Rate limit',
      '',
      'This is `feature/limit` against `main`.',
      '',
      '## Why does this change exist?',
      '',
      'Bots placed thousands of orders a minute. (Source: commit 7376000.)',
      '',
      '## What happens on one case?',
      '',
      'Before: The twenty-first order in a minute was accepted.',
      '',
      'After: It is refused with a 429.',
      '',
      'See: h1, test/limiter.test.js:2',
      '',
      '## What is the idea, and what did the author decide?',
      '',
      'Count orders per address in a minute.',
      '',
      'Decisions:',
      '- The author says (commit 7376000): The count is per server',
      '',
      '## What are the parts?',
      '',
      '- **The limiter** (main part): Counts orders per address',
      '  Files: `src/limiter.js`',
      '- **Wiring** (supporting part): Runs the limiter before an order is saved',
      '  After: The limiter',
      '  Files: `src/server.js`',
      '- **Tests and docs** (routine, skim it): `test/limiter.test.js`, `README.md`',
      '',
      '## How do we know it works?',
      '',
      'Tested:',
      '- A twenty-first order is refused (test/limiter.test.js)',
      '',
      'Not tested:',
      '- Two servers',
      '',
      '## What to look at first',
      '',
      '- `src/server.js:40-41`  the limiter runs before the order is saved',
      '  a refused order must not be saved',
      '',
      '## Questions for the author',
      '',
      '- Why per server and not shared?',
      '',
    ].join('\n'),
  );
});

test('validate prints the brief line and writes guide.md, outline prints the line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-brief-'));
  try {
    const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
    write('hunks.json', hunks);
    write('map.json', map);
    write('meta.json', { mode: 'diff', branch: 'feature/limit', base: 'main' });
    write('storyboard.json', board({ brief: brief({ proof: undefined }) }));
    const env = {
      ...process.env,
      MR_CAST_NO_UPDATE_CHECK: '1',
      MR_CAST_PROCS_SCAN: '0',
      XDG_CONFIG_HOME: path.join(dir, 'config'),
      XDG_CACHE_HOME: path.join(dir, 'cache'),
      XDG_STATE_HOME: path.join(dir, 'state'),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    };
    const run = (cmd) =>
      spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), cmd, '--dir', dir], { encoding: 'utf8', env });
    const validated = run('validate');
    assert.equal(validated.status, 0, validated.stderr);
    const lines = validated.stdout.trim().split('\n');
    assert.ok(
      lines.includes(
        'brief: why ✓ (commit 7376000) · case ✓ · approach ✓ 1 decision (1 stated) · parts 3, core 1 · proof ✗ · check 1 · ask 1',
      ),
      validated.stdout,
    );
    assert.match(lines.at(-2), /wrote .*guide\.md/);
    assert.match(lines.at(-1), /^✓ storyboard ok/);
    assert.match(fs.readFileSync(path.join(dir, 'guide.md'), 'utf8'), /^# Guide to this change: Rate limit\n/);
    assert.match(
      fs.readFileSync(path.join(dir, 'guide.md'), 'utf8'),
      /## How do we know it works\?\n\nNot answered yet\./,
    );
    assert.match(run('outline').stdout, /\nbrief: why ✓ .* · ask 1\n?/);
    // A storyboard without a brief has no guide, and a guide mr-cast did not write is left alone.
    write('storyboard.json', { title: 'Rate limit', scenes });
    run('validate');
    assert.equal(fs.existsSync(path.join(dir, 'guide.md')), false);
    fs.writeFileSync(path.join(dir, 'guide.md'), 'mine\n');
    write('storyboard.json', board());
    const kept = run('validate');
    assert.match(kept.stderr, /kept .*guide\.md, which mr-cast did not write/);
    assert.equal(fs.readFileSync(path.join(dir, 'guide.md'), 'utf8'), 'mine\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const cell = (hunk, side, lines) => ({ hunk, side, lines });
const compareOf = (...cells) => ({
  type: 'compare',
  answers: ['case'],
  narration: 'Before and after.',
  rows: cells.map(([a, b]) => ({ label: 'Row', cells: [a, b] })),
});
const flowOf = (hunk) => ({
  type: 'flow',
  answers: ['case'],
  narration: 'One order.',
  steps: [{ actor: 'limiter', action: 'counts', code: { hunk, lines: '11-12' } }],
});

test('lines of a hunk read in a compare cell or a flow stop count as showing the hunk', async () => {
  const others = [text(ALL), code('h2')];
  const inCompare = board({
    scenes: [...others, compareOf([cell('h1', 'old', '10'), cell('h1', 'new', '11-12')])],
  });
  assert.deepEqual(await warningsOf(inCompare, {}), []);
  const inFlow = board({ scenes: [...others, flowOf('h1')] });
  assert.deepEqual(await warningsOf(inFlow, {}), []);
  // The coverage line counts them too, tests included.
  const result = await check(
    board({ scenes: [...others, compareOf([cell('h1', 'old', '10'), cell('h3', 'new', '1-2')]), flowOf('h1')] }),
  );
  assert.deepEqual([result.errors, result.warnings], [[], []]);
  assert.equal(result.coverage.shown, 3);
  assert.deepEqual(result.coverage.tests, { shown: 1, total: 1 });
});

test('a test hunk in a compare cell or a flow stop is a test shown on screen', async () => {
  const named = { ...map, tests: [{ path: 'test/limiter.test.js', covers: ['src/limiter.js'], adds: ['limits'] }] };
  const sb = (extra) => board({ scenes: [text(ALL, { narration: 'No test is named here.' }), code('h1'), ...extra] });
  const warns = async (extra) => (await check(sb(extra), { map: named })).warnings.filter((w) => /^tests:/.test(w));
  assert.equal((await warns([code('h2')])).length, 1);
  assert.deepEqual(await warns([compareOf([cell('h3', 'old', '1'), cell('h3', 'new', '1-2')])]), []);
  assert.deepEqual(await warns([flowOf('h3')]), []);
});

test('outline reads a reading scene with no items, which draws the brief check list', () => {
  const reading = { type: 'reading', answers: ['check'], narration: 'Open these first.' };
  const storyboard = board({ scenes: [text(ALL), code('h1'), code('h2'), reading] });
  const out = formatOutline({ storyboard, hunks, coverage: null, seconds: 30, voiced: false });
  assert.match(out, /1 place to open first, from the brief/);
});

const withDecisions = (decisions) => brief({ approach: { text: 'Count orders per address.', decisions } });

test('a decision with source "code" and no cite is warned, and so is a commit that is not the branch\'s', async () => {
  const sb = board({
    brief: withDecisions([
      { text: 'The count is per server', source: 'code' },
      { text: 'Refuse, never queue', source: 'code', cite: ['h2', 'src/ghost.js:3'] },
      { text: 'Keys expire', source: 'commit 9999999' },
      { text: 'Stated', source: 'commit 7376000' },
    ]),
  });
  assert.deepEqual(await warningsOf(sb), [
    'brief.approach.decisions[0]: source "code" but no cite; name the hunk id or path:line where the choice shows',
    'brief.approach.decisions[1].cite[1]: "src/ghost.js:3" names src/ghost.js, which is not a file of the diff',
    'brief.approach.decisions[2].source: "9999999" is not a commit of this branch',
  ]);
});

test('a decision of the wrong shape is an error, and a plain string is read as "mine"', async () => {
  const bad = await check(board({ brief: withDecisions([{ text: 'x' }, 3]) }));
  assert.deepEqual(
    bad.errors.filter((e) => e.startsWith('brief.approach')),
    [
      'brief.approach.decisions[0].source: required, "description", "code", "mine" or "commit <sha>"',
      'brief.approach.decisions[1]: must be { text, source, cite? } or a string',
    ],
  );
  assert.equal(
    briefLine(withDecisions(['a', { text: 'b', source: 'description' }, { text: 'c', source: 'code', cite: ['h1'] }])),
    'brief: why ✓ (commit 7376000) · case ✓ · approach ✓ 3 decisions (1 stated, 1 code, 1 mine) · parts 3, core 1 · proof ✓ 1 tested, 1 untested · check 1 · ask 1',
  );
});

test('every decision "mine" while the commits state something is warned, one that is stated is not', async () => {
  const mine = await warningsOf(board({ brief: withDecisions(['One way', { text: 'Two', source: 'mine' }]) }));
  assert.equal(mine.length, 1);
  assert.match(
    mine[0],
    /^brief\.approach\.decisions: every decision is "mine", but a commit body is in map\.json; the commits or description may state choices, so read them/,
  );
  assert.deepEqual(
    await warningsOf(board({ brief: withDecisions(['One way', { text: 'Two', source: 'description' }]) })),
    [],
  );
  // With nothing written by the author, a writer's own observation is all there is.
  assert.deepEqual(
    await warningsOf(board({ brief: withDecisions(['One way']) }), {
      map: { ...map, commits: [{ sha: '7376000', subject: 'x', body: '' }] },
    }),
    [],
  );
});

test('guide.md labels each decision by who says it', () => {
  const sb = board({
    brief: withDecisions([
      { text: 'Keys expire', source: 'description' },
      { text: 'Count per server', source: 'code', cite: ['h2'] },
      'A shared store',
    ]),
  });
  const md = guideMarkdown(sb, hunks);
  assert.match(md, /- The author says \(description\): Keys expire\n/);
  assert.match(md, /- The code shows \(h2\): Count per server\n/);
  assert.match(md, /- Another way, not the author's: A shared store\n/);
});

test('a compare of options that answers "approach" with every decision "mine" must say the alternative is mine', async () => {
  const compare = (over = {}) => ({
    type: 'compare',
    mode: 'options',
    answers: ['approach'],
    sides: [{ title: 'Per server', chosen: true }, { title: 'Shared store' }],
    rows: [{ cells: ['Counts in memory', 'Counts in Redis'] }],
    narration: 'The author counts per server.',
    ...over,
  });
  const mineBrief = withDecisions(['A shared store']);
  const unmarked = await warningsOf(board({ scenes: [...scenes, compare()], brief: mineBrief }));
  assert.ok(
    unmarked.some((w) =>
      /^scenes\[3\]: shows a way not taken for "approach", but every decision in the brief is "mine"/.test(w),
    ),
    unmarked.join('\n'),
  );
  const marked = await warningsOf(board({ scenes: [...scenes, compare({ alternative: 'mine' })], brief: mineBrief }));
  assert.ok(!marked.some((w) => w.startsWith('scenes[3]')), marked.join('\n'));
  // One decision that is stated, and the alternative may be the author's.
  const stated = await warningsOf(
    board({ scenes: [...scenes, compare()], brief: withDecisions(['x', { text: 'y', source: 'description' }]) }),
  );
  assert.ok(!stated.some((w) => w.startsWith('scenes[3]')));
  const wrong = await check(
    board({ scenes: [...scenes, compare({ mode: undefined, alternative: 'mine', sides: undefined })] }),
  );
  assert.ok(wrong.errors.some((e) => e.includes('alternative: only means something with "mode": "options"')));
  const bad = await check(board({ scenes: [...scenes, compare({ alternative: 'theirs' })] }));
  assert.ok(bad.errors.some((e) => e.includes('alternative: must be "mine"')));
});

test('a core or support part with no "does", a long one, and an "after" naming no part are warned about', async () => {
  const parts = [
    { name: 'The limiter', weight: 'core', hunks: ['h1'] },
    { name: 'Wiring', weight: 'support', does: 'x'.repeat(120), after: ['The limiter', 'The limtier'], hunks: ['h2'] },
    { name: 'Tests and docs', weight: 'routine', hunks: ['h3', 'h4'] },
  ];
  const warnings = await warningsOf(board({ brief: brief({ parts }) }));
  assert.equal(warnings.length, 3, warnings.join('\n'));
  assert.match(warnings[0], /^brief\.parts\[0\] \("The limiter"\): a core part with no "does"/);
  assert.match(warnings[1], /^brief\.parts\[1\]\.does: 120 characters; keep it to one sentence/);
  assert.match(warnings[2], /^brief\.parts\[1\]\.after\[1\]: "The limtier" is not a part's name.*"The limiter"/);
});

test('a "does" or "after" of the wrong shape is an error', async () => {
  const { errors } = await check(
    board({ brief: brief({ parts: [{ name: 'x', weight: 'core', hunks: [], does: 3, after: 'y' }] }) }),
  );
  assert.deepEqual(errors, [
    'brief.parts[0].does: must be a non-empty string',
    'brief.parts[0].after: must be an array of strings',
  ]);
});

const tests = (gap) => ({
  type: 'tests',
  answers: ['proof'],
  narration: 'The limiter is tested.',
  outcomes: ['Result'],
  situations: [
    { id: 'ok', when: 'under the limit', expect: { Result: 'accepted' } },
    { id: 'gap', when: 'two servers', gap },
  ],
  tests: [{ name: 'limits', checks: ['ok.Result'] }],
});
const claims = async (sb) => (await check(sb)).warnings.filter((w) => /named or imported by/.test(w));

test('a source file the map lists as covered by a changed test is not called untested, and the test is named', async () => {
  const said = brief({
    proof: { tested: ['x'], untested: ['src/limiter.js handles a burst', 'src/server.js is wired'] },
  });
  const w = await claims(board({ brief: said }));
  assert.equal(w.length, 1);
  assert.match(
    w[0],
    /^brief\.proof\.untested\[0\]: says "src\/limiter\.js handles a burst", but the map lists src\/limiter\.js as named or imported by test\/limiter\.test\.js, which may only mock it; read that test before saying anything about whether a test reaches limiter\.js$/,
  );
  // A bare file name, as writers write it, and a tests scene's gap.
  const bare = await claims(
    board({
      brief: brief({ proof: { tested: ['x'], untested: ['The limiter.js rewrite'] } }),
      scenes: [text(ALL), code('h1'), code('h2'), tests('nothing tests limiter.js with two servers')],
    }),
  );
  assert.equal(bare.length, 2);
  assert.match(
    bare[1],
    /^scenes\[3\]\.situations\[1\]\.gap: says "two servers nothing tests limiter\.js with two servers"/,
  );
  assert.deepEqual(await claims(board({ brief: brief({ proof: { tested: ['x'], untested: ['Two servers'] } }) })), []);
  // Not a branch run with a map, no claim is checked.
  assert.deepEqual(
    (await check(board({ brief: said }), { map: null })).warnings.filter((m) => /named or imported by/.test(m)),
    [],
  );
});
