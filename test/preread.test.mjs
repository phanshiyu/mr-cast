import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { startServer } from '../bin/lib/server.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { checkPlan } from '../shared/plan.mjs';
import { readingChecklist, readingLines, readingMarkdown, readingOrder } from '../shared/reading.mjs';

const bundled = await build({
  entryPoints: [new URL('../src/utils/readingLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { layoutReading, moreText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hunk = (id, file, texts, start = 1) => ({
  id,
  file,
  oldFile: null,
  status: 'modified',
  language: 'typescript',
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
const filler = (n, text) => Array.from({ length: n }, (_, i) => `${text} ${i};`);
// The limiter (20 lines, from line 12), the route that mounts it (16 lines, from line 40), and a 2-line config tweak.
const hunks = {
  h1: hunk('h1', 'src/limiter.ts', ['export function checkLimit(ip) {', ...filler(19, 'count')], 12),
  h2: hunk('h2', 'src/server.ts', ['app.use(rateLimit);', ...filler(15, 'route')], 40),
  h3: hunk('h3', 'src/config.ts', ['export const MAX_REQUESTS = 20;', 'export const WINDOW = 60;'], 3),
};
const intent = {
  type: 'intent',
  summary: 'Limits orders per minute.',
  risk: 'medium',
  bullets: ['The count is per server'],
  narration: 'The branch limits orders.',
};
const graph = (from, label = '`checkLimit`') => ({
  type: 'graph',
  chapter: 'The limiter',
  narration: 'The limiter sits in front of the orders route.',
  from,
  nodes: [
    { id: 'server', label: '`server.ts`' },
    { id: 'limiter', label },
  ],
  edges: [{ from: 'server', to: 'limiter', label: 'each order' }],
});
const tests = {
  type: 'tests',
  subject: 'the limiter',
  cases: [],
  gaps: ['Two servers each allow twenty'],
  narration: 'No test covers the limit yet.',
};
const reading = (items) => ({
  type: 'reading',
  narration: 'Read the limiter first, because every order passes it.',
  items,
});
const both = [
  { hunkId: 'h1', check: 'the key resets on a new minute; check the off-by-one' },
  { hunkId: 'h2', check: 'the limiter runs before the order is saved' },
];
const validate = (scenes, extra = {}, audience = 'preread') =>
  validateStoryboard({ title: 'Rate limit', scenes, ...extra }, hunks, { audience });
const matching = (list, re) => list.filter((m) => re.test(m));

test('a pre-read refuses a code scene, a code cell in a compare, and a review scene', async () => {
  const code = {
    type: 'code',
    hunkId: 'h1',
    narration: 'The limiter counts each request.',
    focusLinesAfter: ['12-14'],
  };
  const compare = {
    type: 'compare',
    narration: 'The route before and after.',
    rows: [{ label: 'Route', cells: ['no limit', { code: 'app.use(rateLimit)', lang: 'ts' }] }],
  };
  const review = { type: 'review', narration: 'One thing looked wrong.' };
  const { errors } = await validate([intent, graph(['h1', 'h2']), compare, code, tests, review, reading(both)], {
    findings: [],
  });
  assert.deepEqual(matching(errors, /pre-read/), [
    'scenes[2].rows[0].cells[1]: a code snippet, and a pre-read puts no code on screen; use a text cell',
    'scenes[3] is a code scene, and a pre-read puts no code on screen; cite the hunk in a diagram\'s "from" or list it in the reading order',
    'scenes[5]: a pre-read ends on the reading order, which carries the findings; remove the review scene and flag each finding on its reading item',
  ]);
  const reviewer = await validate(
    [intent, graph(), compare, code, tests],
    { skipped: [{ hunkId: 'h2', reason: 'routine mount' }] },
    'familiar',
  );
  assert.deepEqual(matching(reviewer.errors, /pre-read/), []);
});

test('a pre-read counts the hunks its reading order lists, and says when it has no reading scene', async () => {
  const listed = await validate([intent, graph(['h1', 'h2']), tests, reading(both)]);
  assert.deepEqual([listed.errors, listed.warnings], [[], []]);
  assert.equal(listed.coverage.shown, 2);

  const citedOnly = await validate([intent, graph(['h1', 'h2']), tests, reading(both.slice(0, 1))]);
  assert.deepEqual([citedOnly.warnings, citedOnly.coverage.shown], [[], 1]);

  const none = await validate([intent, graph(['h1', 'h2']), tests]);
  assert.deepEqual(none.warnings, [
    'a pre-read with no reading scene has no reading order, so no reading.md is written; add { "type": "reading", "items": [...] }',
  ]);
});
test('from names known hunks, and does nothing outside a pre-read', async () => {
  const unknown = await validate([intent, graph(['h1', 'h9']), tests, reading(both)]);
  assert.deepEqual(matching(unknown.errors, /from/), ['scenes[1].from[1]: "h9" not found in hunks.json']);
  assert.deepEqual(
    (await validate([intent, graph(['h1', 'h2', 'h3', 'h1'], 'count'), tests, reading(both)])).warnings,
    [],
  );

  const reviewer = await validate([intent, graph(['h1']), tests], {}, 'familiar');
  assert.deepEqual(matching(reviewer.warnings, /^scenes\[1\]\.from/), [
    'scenes[1].from: only a pre-read (--audience preread) reads "from", so it does nothing here',
  ]);
});
test('reading items name real hunks once, each with a check unless routine', async () => {
  const items = [
    { hunkId: 'h1', check: 'the key resets on a new minute; check the off-by-one at the boundary of every window' },
    { hunkId: 'h2' },
    { hunkId: 'h1', check: 'again' },
    { hunkId: 'h7', check: 'gone' },
    { hunkId: 'h3', routine: true },
  ];
  const { errors, warnings } = await validate([intent, graph(['h1', 'h2']), tests, reading(items)]);
  assert.deepEqual(matching(errors, /items/), [
    'scenes[3].items[1].check: required, what to verify there; set "routine": true for a change to skim',
    'scenes[3].items[2].hunkId: h1 is already items[0]; list each hunk once',
    'scenes[3].items[3].hunkId: "h7" not found in hunks.json',
  ]);
  assert.deepEqual(matching(warnings, /items\[0\]\.check/), []);
});

test('the reading scene may go anywhere, and the narration names only items it numbers', async () => {
  assert.deepEqual((await validate([intent, reading(both), graph(['h1', 'h2']), tests])).warnings, []);
  const g = { ...graph(['h1', 'h2']), narration: 'The limiter counts per server; check this at item 3.' };
  const { warnings } = await validate([intent, g, tests, reading([...both, { hunkId: 'h3', routine: true }])]);
  assert.deepEqual(matching(warnings, /item 3/), [
    'scenes[1].narration: says "item 3", but the reading order numbers 2 items to read; name one of 1 to 2',
  ]);
});

test('a pre-read flags its findings on reading items of the same file', async () => {
  const finding = {
    id: 'per-server',
    severity: 'bug',
    file: 'src/limiter.ts',
    line: 14,
    claim: 'the count is per server',
    evidence: 'two servers each allow twenty, so forty pass',
  };
  const flagged = await validate(
    [intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])],
    { findings: [finding] },
  );
  assert.deepEqual(flagged.errors, []);
  assert.deepEqual(matching(flagged.warnings, /finding|flag/), []);

  const wrongFile = await validate(
    [intent, graph(['h1', 'h2']), tests, reading([both[0], { ...both[1], flag: 'per-server' }])],
    { findings: [finding] },
  );
  assert.deepEqual(matching(wrongFile.errors, /flag/), [
    'scenes[3].items[1].flag: "per-server" is about src/limiter.ts, but h2 is in src/server.ts; flag it on that file\'s item',
  ]);

  const unflagged = await validate([intent, graph(['h1', 'h2']), tests, reading(both)], { findings: [finding] });
  assert.deepEqual(matching(unflagged.warnings, /flagged on no/), [
    'findings: "per-server" is flagged on no reading item; set "flag": "per-server" on the item of its hunk, so the reader meets it there',
  ]);
  assert.deepEqual(matching(unflagged.errors, /review scene/), []);
});

test('a pre-read plan offers no code view, and a deep topic may be one diagram', async () => {
  const topic = (views) => ({
    id: 'limiter',
    title: 'Rate limiter',
    summary: 'Counts requests.',
    files: [],
    depth: 'deep',
    views,
    seconds: { brief: 30, deep: 90 },
  });
  assert.deepEqual(checkPlan({ topics: [topic(['parts', 'code'])] }, { preread: true }).errors, [
    'topics[0].views: a pre-read puts no code on screen, so drop "code" and offer the views that draw the topic, such as "data" or "decisions"',
  ]);
  assert.deepEqual(checkPlan({ topics: [topic(['parts', 'code'])] }).errors, []);

  const p = { topics: [topic(['parts', 'data'])] };
  const plan = { plan: p, ...checkPlan(p, { preread: true }) };
  const scenes = [intent, { ...graph(['h1', 'h2']), topic: 'limiter' }, tests, reading(both)];
  const one = await validateStoryboard(
    { title: 'Rate limit', scenes, plan: { limiter: { depth: 'deep', view: 'parts' } } },
    hunks,
    { audience: 'preread', plan },
  );
  assert.deepEqual(matching(one.warnings, /chose deep/), []);
  const flow = {
    type: 'flow',
    topic: 'limiter',
    narration: 'One visitor sends a twenty-first order.',
    steps: [
      { actor: '`checkLimit`', action: 'count 21 of 20', say: 'The count passes twenty.' },
      { actor: '`server.ts`', action: 'answer 429', say: 'The server refuses the order.' },
    ],
  };
  const two = await validateStoryboard(
    {
      title: 'Rate limit',
      scenes: [intent, scenes[1], flow, tests, reading(both)],
      plan: { limiter: { depth: 'deep', view: 'parts' } },
    },
    hunks,
    { audience: 'preread', plan },
  );
  assert.deepEqual(matching(two.warnings, /chose deep|chose to see it as/), []);
});

test('the reading order resolves file and lines from hunks.json, numbers the items to read, and collapses routine ones', () => {
  // Without a plan there are no topics, so the checklist has no headings.
  const plain = {
    title: 'Rate limit',
    scenes: [intent, graph(['h1', 'h2']), tests, reading([both[0], { hunkId: 'h3', routine: true }, both[1]])],
  };
  assert.equal(
    readingMarkdown(plain, readingOrder(plain, hunks)).split('\n').slice(4).join('\n'),
    [
      '- [ ] 1. `src/limiter.ts:12-31`: the key resets on a new minute; check the off-by-one',
      '- [ ] 2. `src/server.ts:40-55`: the limiter runs before the order is saved',
      '',
      '### Skim',
      '',
      '- [ ] `src/config.ts:3-4`',
      '',
    ].join('\n'),
  );

  const finding = {
    id: 'per-server',
    severity: 'bug',
    file: 'src/limiter.ts',
    line: 14,
    claim: 'the count is **per server**',
    evidence: '',
  };
  const sb = {
    title: 'Rate limit',
    findings: [finding],
    scenes: [
      intent,
      { ...graph(['h1', 'h3']), topic: 'limiter' },
      { ...graph(['h2']), chapter: 'The route' },
      tests,
      reading([{ ...both[0], flag: 'per-server' }, { hunkId: 'h3', routine: true }, both[1]]),
    ],
  };
  const order = readingOrder(sb, hunks, { topics: [{ id: 'limiter', title: 'Rate limiter: twenty a minute' }] });
  assert.deepEqual(
    order.items.map((i) => [i.number, i.where, i.explainedIn, i.topic]),
    [
      [1, 'src/limiter.ts:12-31', { chapter: 'The limiter', scene: 1 }, 'Rate limiter: twenty a minute'],
      [null, 'src/config.ts:3-4', { chapter: 'The limiter', scene: 1 }, 'Rate limiter: twenty a minute'],
      [2, 'src/server.ts:40-55', { chapter: 'The route', scene: 2 }, null],
    ],
  );
  assert.deepEqual(readingLines(order), [
    '  1. src/limiter.ts:12-31  the key resets on a new minute; check the off-by-one (Claude: likely bug, the count is per server)',
    '  2. src/server.ts:40-55  the limiter runs before the order is saved',
    '  skim: src/config.ts:3-4',
  ]);
  assert.equal(
    readingMarkdown(sb, order, { branch: 'feature/limit', base: 'main' }),
    [
      '# Reading order: Rate limit',
      '',
      'Read the change of `feature/limit` against `main` in this order. Each item says what to check there.',
      '',
      '### Rate limiter: twenty a minute',
      '',
      '- [ ] 1. `src/limiter.ts:12-31`: the key resets on a new minute; check the off-by-one (Claude: likely bug, the count is per server)',
      '',
      '### Other changes',
      '',
      '- [ ] 2. `src/server.ts:40-55`: the limiter runs before the order is saved',
      '',
      '### Skim',
      '',
      '- [ ] Rate limiter: twenty a minute: `src/config.ts:3-4`',
      '',
    ].join('\n'),
  );
});

test('validate writes reading.md and outline prints the reading order as clickable lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-preread-'));
  try {
    const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
    write('hunks.json', hunks);
    write('meta.json', { mode: 'diff', branch: 'feature/limit', base: 'main' });
    write('storyboard.json', {
      title: 'Rate limit',
      scenes: [intent, graph(['h1', 'h2']), tests, reading([...both, { hunkId: 'h3', routine: true }])],
    });
    const env = {
      ...process.env,
      MR_CAST_NO_UPDATE_CHECK: '1',
      XDG_CONFIG_HOME: path.join(dir, 'config'),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    };
    const run = (cmd, audience = ['--audience', 'preread']) =>
      spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), cmd, ...audience, '--dir', dir], {
        encoding: 'utf8',
        env,
      });
    const validated = run('validate');
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /wrote .*reading\.md/);
    assert.match(
      fs.readFileSync(path.join(dir, 'reading.md'), 'utf8'),
      /^# Reading order: Rate limit\n[\s\S]*- \[ \] 1\. `src\/limiter\.ts:12-31`: the key resets on a new minute; check the off-by-one\n/,
    );
    const outlined = run('outline');
    assert.equal(outlined.status, 0, outlined.stderr);
    assert.deepEqual(outlined.stdout.trim().split('\n').slice(-4), [
      'reading order:',
      '  1. src/limiter.ts:12-31  the key resets on a new minute; check the off-by-one',
      '  2. src/server.ts:40-55  the limiter runs before the order is saved',
      '  skim: src/config.ts:3-4',
    ]);
    // Only a pre-read has a reading.md; validated for a reviewer, the run's own reading.md goes.
    const reviewer = run('validate', []);
    assert.match(reviewer.stdout, /this storyboard is a pre-read; pass --audience preread/);
    assert.equal(fs.existsSync(path.join(dir, 'reading.md')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the server tells the plan page the audience it was started for', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-settings-'));
  const server = await startServer({ distDir: root, dataDir: root, port: 0, audience: 'preread' });
  try {
    assert.deepEqual(await (await fetch(`${server.url}/data/settings.json`)).json(), { audience: 'preread' });
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a skipped topic whose scenes still show it is reported, in a pre-read too', async () => {
  const topic = {
    id: 'route',
    title: 'The route',
    summary: 'Mounts it.',
    files: [],
    depth: 'skip',
    views: ['parts'],
    seconds: { brief: 30, deep: 60 },
  };
  const plan = { plan: { topics: [topic] }, ...checkPlan({ topics: [topic] }, { preread: true }) };
  const shown = await validateStoryboard(
    {
      title: 'Rate limit',
      scenes: [intent, { ...graph(['h1', 'h2']), topic: 'route' }, tests, reading(both)],
      plan: { route: { depth: 'skip', view: 'parts' } },
    },
    hunks,
    { audience: 'preread', plan },
  );
  assert.deepEqual(matching(shown.warnings, /chose to skip it/), [
    'topic "route": the viewer chose to skip it, but scenes[1] show it',
  ]);
});
test("a pre-read flags findings only on reading items, on a line of the item's hunk", async () => {
  const finding = (line) => ({
    id: 'per-server',
    severity: 'bug',
    file: 'src/limiter.ts',
    line,
    claim: 'the count is per server',
    evidence: 'two servers each allow twenty, so forty pass',
  });
  const flow = {
    type: 'flow',
    narration: 'One order.',
    from: ['h1'],
    steps: [
      { actor: '`checkLimit`', action: 'count 21 of 20', say: 'I think this count is per server.', flag: 'per-server' },
    ],
  };
  const stepFlag = await validate(
    [intent, graph(['h1', 'h2']), flow, tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])],
    { findings: [finding(14)] },
  );
  assert.deepEqual(matching(stepFlag.errors, /flag/), [
    'scenes[2].steps[0].flag: a pre-read carries its findings on the reading order; flag it on the reading item of its hunk',
  ]);

  // h1 holds src/limiter.ts lines 12 to 31; line 40 is in the same file but not in that hunk.
  const outside = await validate(
    [intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])],
    { findings: [finding(40)] },
  );
  assert.deepEqual(matching(outside.errors, /items\[0\]\.flag/), [
    'scenes[3].items[0].flag: "per-server" is at src/limiter.ts:40, but h1 covers src/limiter.ts:12-31; flag it on the item of the hunk that holds that line',
  ]);
  const edge = await validate(
    [intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])],
    { findings: [finding('30-33')] },
  );
  assert.deepEqual(matching(edge.errors, /items\[0\]\.flag/), []);
});

test('"Explained in" names the scene to seek to, and two citing scenes need their own chapters', async () => {
  const twin = { ...graph(['h2']), narration: 'The route mounts it in `server.ts`.' };
  const { warnings } = await validate([intent, graph(['h1']), twin, tests, reading(both)]);
  assert.deepEqual(matching(warnings, /Explained in/), [
    'scenes[2]: cites hunks in "from" under the chapter "The limiter", as scenes[1] does, so the reading order\'s "Explained in" cannot tell them apart; give one its own "chapter"',
  ]);
  const sb = {
    title: 'Rate limit',
    scenes: [intent, graph(['h1']), { ...twin, chapter: 'The route' }, tests, reading(both)],
  };
  assert.deepEqual(
    readingOrder(sb, hunks).items.map((i) => i.explainedIn),
    [
      { chapter: 'The limiter', scene: 1 },
      { chapter: 'The route', scene: 2 },
    ],
  );
});

test('reading.md keeps paths and inline code as code, and file names lose control characters', () => {
  const odd = {
    ...hunks,
    h4: {
      ...hunk('h4', 'src/we\u001b[31mird\u0007.ts', ['export const LIMIT = 20;']),
      lines: [{ type: 'add', oldLine: null, newLine: 7, text: 'export const LIMIT = 20;' }],
    },
  };
  const sb = {
    title: 'Rate limit',
    findings: [
      {
        id: 'f',
        severity: 'risk',
        file: 'src/limiter.ts',
        line: 12,
        claim: '`checkLimit` trusts **the header**',
        evidence: 'x',
      },
    ],
    scenes: [
      intent,
      graph(['h1']),
      tests,
      reading([
        { hunkId: 'h1', check: 'the `windowStart` resets on a **new** minute', flag: 'f' },
        { hunkId: 'h4', check: 'the limit is 20' },
      ]),
    ],
  };
  const order = readingOrder(sb, odd);
  assert.equal(
    readingChecklist(order),
    [
      '- [ ] 1. `src/limiter.ts:12-31`: the `windowStart` resets on a new minute (Claude: risk, `checkLimit` trusts the header)',
      '- [ ] 2. `src/we[31mird.ts:7`: the limit is 20',
    ].join('\n'),
  );
  assert.deepEqual(readingLines(order), [
    '  1. src/limiter.ts:12-31  the windowStart resets on a new minute (Claude: risk, checkLimit trusts the header)',
    '  2. src/we[31mird.ts:7  the limit is 20',
  ]);
});

test('a reading scene or from outside a pre-read asks for --audience preread', async () => {
  const { warnings } = await validate([intent, graph(['h1', 'h2']), tests, reading(both)], {}, 'familiar');
  assert.deepEqual(matching(warnings, /pre-read/), [
    'this storyboard is a pre-read; pass --audience preread',
    'scenes[1].from: only a pre-read (--audience preread) reads "from", so it does nothing here',
    'scenes[3]: only a pre-read has a reading scene; pass --audience preread, or remove it',
  ]);
  const plain = await validate(
    [intent, graph(), tests],
    {
      skipped: [
        { hunkId: 'h1', reason: 'formatting only' },
        { hunkId: 'h2', reason: 'formatting only' },
      ],
    },
    'familiar',
  );
  assert.deepEqual(matching(plain.warnings, /pre-read/), []);
});

test('the reading scene counts the items to read past the first six apart from the routine ones', () => {
  const many = Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`r${i}`, hunk(`r${i}`, `src/part${i}.ts`, ['export const a = 1;'], 1)]),
  );
  const items = Array.from({ length: 11 }, (_, i) =>
    i < 8 ? { hunkId: `r${i}`, check: `check part ${i}` } : { hunkId: `r${i}`, routine: true },
  );
  const sb = { title: 'Parts', scenes: [intent, reading(items)] };
  const layout = layoutReading(readingOrder(sb, many), items, 1712, 760);
  assert.equal(layout.rows.length, 6);
  assert.equal(moreText(layout), '+2 more to read, +3 routine');
  assert.equal(moreText({ moreToRead: 0, routine: 1 }), '+1 routine');
  assert.equal(moreText({ moreToRead: 1, routine: 0 }), '+1 more to read');
});

test('a reading item points at the lines that matter with "lines", inside its hunk', async () => {
  // A new file's hunk is the whole file: 60 lines of the worker.
  const big = {
    ...hunks,
    h4: hunk('h4', 'src/worker.ts', ['export function runOnce(db) {', ...filler(59, 'step')], 1),
  };
  const scenes = (items) => [
    intent,
    graph(['h1', 'h2']),
    { ...graph(['h4'], '`runOnce`'), chapter: 'The worker' },
    tests,
    reading(items),
  ];
  const check = (items) =>
    validateStoryboard({ title: 'Rate limit', scenes: scenes(items) }, big, { audience: 'preread' });
  const whole = await check([...both, { hunkId: 'h4', check: 'a claimed row is never reclaimed' }]);
  assert.deepEqual(whole.warnings, []);
  const bad = await check([
    { ...both[0], lines: '5-14' },
    { ...both[1], lines: 'top' },
    { hunkId: 'h4', check: 'x', lines: '20-28' },
  ]);
  assert.deepEqual(matching(bad.errors, /\.lines/), [
    'scenes[4].items[0].lines: 5-14 is outside h1, which covers src/limiter.ts:12-31; name lines inside it',
    'scenes[4].items[1].lines: must be "a-b" or a line number, such as "40-49"',
  ]);
  assert.deepEqual(matching(bad.warnings, /lines that matter/), []);

  const sb = {
    title: 'Rate limit',
    scenes: scenes([
      { ...both[0], lines: 14 },
      { hunkId: 'h4', check: 'a claimed row is never reclaimed', lines: '20-28' },
    ]),
  };
  const order = readingOrder(sb, big);
  assert.deepEqual(readingLines(order), [
    '  1. src/limiter.ts:14  the key resets on a new minute; check the off-by-one',
    '  2. src/worker.ts:20-28  a claimed row is never reclaimed',
  ]);
  assert.equal(
    readingChecklist(order).split('\n')[1],
    '- [ ] 2. `src/worker.ts:20-28`: a claimed row is never reclaimed',
  );
  assert.equal(
    layoutReading(order, sb.scenes[4].items, 1712, 760)
      .rows[1].where.lines.flat()
      .map((r) => r.text)
      .join(''),
    'src/worker.ts:20-28',
  );
});

test('the reading order lists each topic once, and a file to read is never also on a skim line', () => {
  // h5 is the import line of server.ts, routine; h2 is the route in server.ts, read first.
  const more = { ...hunks, h5: hunk('h5', 'src/server.ts', ["import { rateLimit } from './limiter';"], 2) };
  const sb = {
    title: 'Rate limit',
    scenes: [
      intent,
      { ...graph(['h1', 'h3']), topic: 'limiter' },
      { ...graph(['h2']), chapter: 'The route', topic: 'route' },
      tests,
      reading([both[0], both[1], { hunkId: 'h3', check: 'the window is 60 seconds' }, { hunkId: 'h5', routine: true }]),
    ],
  };
  const order = readingOrder(sb, more, {
    topics: [
      { id: 'limiter', title: 'The limiter' },
      { id: 'route', title: 'The route' },
    ],
  });
  assert.equal(
    readingChecklist(order),
    [
      '### The limiter',
      '',
      '- [ ] 1. `src/limiter.ts:12-31`: the key resets on a new minute; check the off-by-one',
      '- [ ] 2. `src/config.ts:3-4`: the window is 60 seconds',
      '',
      '### The route',
      '',
      '- [ ] 3. `src/server.ts:40-55`, also 2: the limiter runs before the order is saved',
    ].join('\n'),
  );
  assert.deepEqual(readingLines(order).slice(1), [
    '  2. src/config.ts:3-4  the window is 60 seconds',
    '  3. src/server.ts:40-55, also 2  the limiter runs before the order is saved',
  ]);
  // The scene has no plan, yet numbers and shows the items as reading.md does.
  const layout = layoutReading(readingOrder(sb, more), sb.scenes[4].items, 1712, 760);
  assert.deepEqual(
    layout.rows.map((r) => [r.item.number, r.item.hunkId]),
    [
      [1, 'h1'],
      [2, 'h3'],
      [3, 'h2'],
    ],
  );
  assert.equal(moreText(layout), '');
});

test('"check this at item N" may name any item of the reading order', async () => {
  const g = (from, narration) => ({ ...graph(from), narration });
  const { warnings } = await validate([
    intent,
    g(['h1'], 'The limiter counts per server; check this at item 1.'),
    { ...g(['h2'], 'The route mounts it; see item 1.'), chapter: 'The route' },
    tests,
    reading(both),
  ]);
  assert.deepEqual(matching(warnings, /says "item/), []);
});
