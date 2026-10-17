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

const bundled = await build({ entryPoints: [new URL('../src/utils/readingLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutReading, moreText } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hunk = (id, file, texts, start = 1) => ({
  id, file, oldFile: null, status: 'modified', language: 'typescript', header: '', startLine: start, oldStartLine: start, endLine: start + texts.length - 1,
  additions: texts.length, deletions: 0, beforeCode: '', afterCode: '',
  lines: texts.map((text, i) => ({ type: 'add', oldLine: null, newLine: start + i, text })),
});
const filler = (n, text) => Array.from({ length: n }, (_, i) => `${text} ${i};`);
// The limiter (20 lines, from line 12), the route that mounts it (16 lines, from line 40), and a 2-line config tweak.
const hunks = {
  h1: hunk('h1', 'src/limiter.ts', ['export function checkLimit(ip) {', ...filler(19, 'count')], 12),
  h2: hunk('h2', 'src/server.ts', ['app.use(rateLimit);', ...filler(15, 'route')], 40),
  h3: hunk('h3', 'src/config.ts', ['export const MAX_REQUESTS = 20;', 'export const WINDOW = 60;'], 3),
};
const intent = { type: 'intent', summary: 'Limits orders per minute.', risk: 'medium', bullets: ['The count is per server'], narration: 'The branch limits orders.' };
const graph = (from, label = '`checkLimit`') => ({
  type: 'graph', chapter: 'The limiter', narration: 'The limiter sits in front of the orders route.', from,
  nodes: [{ id: 'server', label: '`server.ts`' }, { id: 'limiter', label }],
  edges: [{ from: 'server', to: 'limiter', label: 'each order' }],
});
const tests = { type: 'tests', subject: 'the limiter', cases: [], gaps: ['Two servers each allow twenty'], narration: 'No test covers the limit yet.' };
const reading = (items) => ({ type: 'reading', narration: 'Read the limiter first, because every order passes it.', items });
const both = [{ hunkId: 'h1', check: 'the key resets on a new minute; check the off-by-one' }, { hunkId: 'h2', check: 'the limiter runs before the order is saved' }];
const validate = (scenes, extra = {}, audience = 'preread') => validateStoryboard({ title: 'Rate limit', scenes, ...extra }, hunks, { audience });
const matching = (list, re) => list.filter((m) => re.test(m));

test('a pre-read refuses a code scene, a code cell in a compare, and a review scene', async () => {
  const code = { type: 'code', hunkId: 'h1', narration: 'The limiter counts each request.', focusLinesAfter: ['12-14'] };
  const compare = { type: 'compare', narration: 'The route before and after.', rows: [{ label: 'Route', cells: ['no limit', { code: 'app.use(rateLimit)', lang: 'ts' }] }] };
  const review = { type: 'review', narration: 'One thing looked wrong.' };
  const { errors } = await validate([intent, graph(['h1', 'h2']), compare, code, tests, review, reading(both)], { findings: [] });
  assert.deepEqual(matching(errors, /pre-read/), [
    'scenes[2].rows[0].cells[1]: a code snippet, and a pre-read puts no code on screen; write what the code does as text, with the real names and values',
    'scenes[3] is a code scene, and a pre-read puts no code on screen; draw what the code does as a diagram, name its hunk in that scene\'s "from", and list it in the reading order',
    'scenes[5]: a pre-read ends on the reading order, which carries the findings; remove the review scene and flag each finding on its reading item',
  ]);
  const reviewer = await validate([intent, graph(), compare, code, tests], { skipped: [{ hunkId: 'h2', reason: 'routine mount' }] }, 'familiar');
  assert.deepEqual(matching(reviewer.errors, /pre-read/), []);
});

test('a pre-read covers the diff with its reading order, not with from', async () => {
  const listed = await validate([intent, graph(['h1', 'h2']), tests, reading(both)]);
  assert.deepEqual(listed.errors, []);
  assert.deepEqual(matching(listed.warnings, /reading order|is not shown/), []);
  assert.equal(listed.coverage.shown, 2);

  const citedOnly = await validate([intent, graph(['h1', 'h2']), tests, reading(both.slice(0, 1))]);
  assert.deepEqual(matching(citedOnly.warnings, /is not in the reading order/), [
    'h2 src/server.ts (+16) is not in the reading order; add it to the reading scene\'s items ("routine": true for a change to skim), or list it in skipped with a reason',
  ]);

  const none = await validate([intent, graph(['h1', 'h2']), tests]);
  assert.deepEqual(matching(none.warnings, /reading scene, the order/), [
    'a pre-read ends on a reading scene, the order in which to read the code with what to check at each hunk; add one { "type": "reading", "items": [...] } last',
  ]);
});

test('a pre-read still may not skip a substantial hunk because the diagrams cover it', async () => {
  const { warnings } = await validate([intent, graph(['h1']), tests, reading(both.slice(0, 1))], { skipped: [{ hunkId: 'h2', reason: 'covered by the diagrams' }] });
  assert.deepEqual(matching(warnings, /^skipped\[/), [
    'skipped[0]: h2 src/server.ts (+16) is skipped as "covered by the diagrams", but a video for a reviewer who reads the code next shows every substantial hunk; add it to the reading scene\'s items ("routine": true for a change to skim). Only the team\'s overview leaves code to the diagrams',
  ]);
});

test('from names known hunks, at most three, and something on screen that names each one', async () => {
  const unknown = await validate([intent, graph(['h1', 'h9']), tests, reading(both)]);
  assert.deepEqual(matching(unknown.errors, /from/), ['scenes[1].from[1]: "h9" not found in hunks.json']);

  const many = await validate([intent, graph(['h1', 'h2', 'h3', 'h1']), tests, reading(both)]);
  assert.deepEqual(matching(many.warnings, /hunks; one picture/), ['scenes[1].from: 4 hunks; one picture explains at most 3, so cite the ones it is about and draw the rest in their own scene']);

  // The graph names `checkLimit` (h1) and `server.ts` (h2), but nothing from config.ts (h3).
  const unnamed = await validate([intent, graph(['h1', 'h2', 'h3']), tests, reading(both)]);
  assert.deepEqual(matching(unnamed.warnings, /nothing on screen/), [
    'scenes[1].from[2]: nothing on screen names h3; label the part it explains with its file or identifier, such as `config.ts`, `MAX_REQUESTS`, so the viewer finds it in the code',
  ]);
  // A plain word from the code (`count`) is not a name to look for; the identifier is.
  const plain = await validate([intent, graph(['h1'], 'count'), tests, reading(both)]);
  assert.equal(matching(plain.warnings, /nothing on screen names h1/).length, 1);

  const reviewer = await validate([intent, graph(['h1']), tests], {}, 'familiar');
  assert.deepEqual(matching(reviewer.warnings, /^scenes\[1\]\.from/), ['scenes[1].from: only a pre-read (--audience preread) reads "from"; show the code in a code scene instead']);
});

test('reading items name real hunks once, each with a short check unless routine', async () => {
  const items = [
    { hunkId: 'h1', check: 'the key resets on a new minute; check the off-by-one at the boundary of every window' },
    { hunkId: 'h2' },
    { hunkId: 'h1', check: 'again' },
    { hunkId: 'h7', check: 'gone' },
    { hunkId: 'h3', routine: true },
  ];
  const { errors, warnings } = await validate([intent, graph(['h1', 'h2']), tests, reading(items)]);
  assert.deepEqual(matching(errors, /items/), [
    'scenes[3].items[1].check: required, what to verify there in under 80 characters; set "routine": true for a change to skim',
    'scenes[3].items[2].hunkId: h1 is already items[0]; list each hunk once',
    'scenes[3].items[3].hunkId: "h7" not found in hunks.json',
  ]);
  assert.deepEqual(matching(warnings, /items\[0\]\.check/), ['scenes[3].items[0].check: 84 characters; say what to verify in under 80']);
});

test('the reading scene comes last, and the narration names only items it numbers', async () => {
  const early = await validate([intent, reading(both), graph(['h1', 'h2']), tests]);
  assert.deepEqual(matching(early.warnings, /put it last/), ['scenes[1]: the reading scene hands the code to the viewer, so put it last, after the tests']);
  const g = { ...graph(['h1', 'h2']), narration: 'The limiter counts per server; check this at item 3.' };
  const { warnings } = await validate([intent, g, tests, reading([...both, { hunkId: 'h3', routine: true }])]);
  assert.deepEqual(matching(warnings, /item 3/), ['scenes[1].narration: says "item 3", but the reading order numbers 2 items to read; name one of 1 to 2']);
});

test('a pre-read flags its findings on reading items of the same file', async () => {
  const finding = { id: 'per-server', severity: 'bug', file: 'src/limiter.ts', line: 14, claim: 'the count is per server', evidence: 'two servers each allow twenty, so forty pass' };
  const flagged = await validate([intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])], { findings: [finding] });
  assert.deepEqual(flagged.errors, []);
  assert.deepEqual(matching(flagged.warnings, /finding|flag/), []);

  const wrongFile = await validate([intent, graph(['h1', 'h2']), tests, reading([both[0], { ...both[1], flag: 'per-server' }])], { findings: [finding] });
  assert.deepEqual(matching(wrongFile.errors, /flag/), ['scenes[3].items[1].flag: "per-server" is about src/limiter.ts, but h2 is in src/server.ts; flag it on that file\'s item']);

  const unflagged = await validate([intent, graph(['h1', 'h2']), tests, reading(both)], { findings: [finding] });
  assert.deepEqual(matching(unflagged.warnings, /flagged on no/), ['findings: "per-server" is flagged on no reading item; set "flag": "per-server" on the item of its hunk, so the reader meets it there']);
  assert.deepEqual(matching(unflagged.errors, /review scene/), []);
});

test('a pre-read plan offers no code view, and a deep topic adds a second diagram', async () => {
  const topic = (views) => ({ id: 'limiter', title: 'Rate limiter', summary: 'Counts requests.', files: [], depth: 'deep', views, seconds: { brief: 30, deep: 90 } });
  assert.deepEqual(checkPlan({ topics: [topic(['parts', 'code'])] }, { preread: true }).errors, [
    'topics[0].views: a pre-read puts no code on screen, so drop "code" and offer the views that draw the topic, such as "data" or "decisions"',
  ]);
  assert.deepEqual(checkPlan({ topics: [topic(['parts', 'code'])] }).errors, []);

  const p = { topics: [topic(['parts', 'data'])] };
  const plan = { plan: p, ...checkPlan(p, { preread: true }) };
  const scenes = [intent, { ...graph(['h1', 'h2']), topic: 'limiter' }, tests, reading(both)];
  const one = await validateStoryboard({ title: 'Rate limit', scenes, plan: { limiter: { depth: 'deep', view: 'parts' } } }, hunks, { audience: 'preread', plan });
  assert.deepEqual(matching(one.warnings, /chose deep/), ['topic "limiter": the viewer chose deep, which in a pre-read traces one real case through a second diagram; add a flow, array or table that walks it with the actual limits, keys and order']);
  const flow = { type: 'flow', topic: 'limiter', narration: 'One visitor sends a twenty-first order.', steps: [{ actor: '`checkLimit`', action: 'count 21 of 20', say: 'The count passes twenty.' }, { actor: '`server.ts`', action: 'answer 429', say: 'The server refuses the order.' }] };
  const two = await validateStoryboard({ title: 'Rate limit', scenes: [intent, scenes[1], flow, tests, reading(both)], plan: { limiter: { depth: 'deep', view: 'parts' } } }, hunks, { audience: 'preread', plan });
  assert.deepEqual(matching(two.warnings, /chose deep|chose to see it as/), []);
});

test('the reading order resolves file and lines from hunks.json, numbers the items to read, and collapses routine ones', () => {
  // Without a plan there are no topics, so the checklist has no headings.
  const plain = { title: 'Rate limit', scenes: [intent, graph(['h1', 'h2']), tests, reading([both[0], { hunkId: 'h3', routine: true }, both[1]])] };
  assert.equal(readingMarkdown(plain, readingOrder(plain, hunks)).split('\n').slice(4).join('\n'), [
    '- [ ] 1. `src/limiter.ts:12-31`: the key resets on a new minute; check the off-by-one',
    '- [ ] 2. `src/server.ts:40-55`: the limiter runs before the order is saved',
    '',
    '### Skim',
    '',
    '- [ ] `src/config.ts:3-4`',
    '',
  ].join('\n'));

  const finding = { id: 'per-server', severity: 'bug', file: 'src/limiter.ts', line: 14, claim: 'the count is **per server**', evidence: '' };
  const sb = {
    title: 'Rate limit',
    findings: [finding],
    scenes: [intent, { ...graph(['h1', 'h3']), topic: 'limiter' }, { ...graph(['h2']), chapter: 'The route' }, tests,
      reading([{ ...both[0], flag: 'per-server' }, { hunkId: 'h3', routine: true }, both[1]])],
  };
  const order = readingOrder(sb, hunks, { topics: [{ id: 'limiter', title: 'Rate limiter: twenty a minute' }] });
  assert.deepEqual(order.items.map((i) => [i.number, i.where, i.explainedIn, i.topic]), [
    [1, 'src/limiter.ts:12-31', { chapter: 'The limiter', scene: 1 }, 'Rate limiter: twenty a minute'],
    [null, 'src/config.ts:3-4', { chapter: 'The limiter', scene: 1 }, 'Rate limiter: twenty a minute'],
    [2, 'src/server.ts:40-55', { chapter: 'The route', scene: 2 }, null],
  ]);
  assert.deepEqual(readingLines(order), [
    '  1. src/limiter.ts:12-31  the key resets on a new minute; check the off-by-one (Claude: likely bug, the count is per server)',
    '  2. src/server.ts:40-55  the limiter runs before the order is saved',
    '  skim: src/config.ts:3-4',
  ]);
  assert.equal(readingMarkdown(sb, order, { branch: 'feature/limit', base: 'main' }), [
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
  ].join('\n'));
});

test('validate writes reading.md and outline prints the reading order as clickable lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-preread-'));
  try {
    const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
    write('hunks.json', hunks);
    write('meta.json', { mode: 'diff', branch: 'feature/limit', base: 'main' });
    write('storyboard.json', { title: 'Rate limit', scenes: [intent, graph(['h1', 'h2']), tests, reading([...both, { hunkId: 'h3', routine: true }])] });
    const env = { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(dir, 'config'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
    const run = (cmd, audience = ['--audience', 'preread']) => spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), cmd, ...audience, '--dir', dir], { encoding: 'utf8', env });
    const validated = run('validate');
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /wrote .*reading\.md/);
    assert.match(fs.readFileSync(path.join(dir, 'reading.md'), 'utf8'), /^# Reading order: Rate limit\n[\s\S]*- \[ \] 1\. `src\/limiter\.ts:12-31`: the key resets on a new minute; check the off-by-one\n/);
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

test('in a pre-read the plan depth changes only the video, so a brief or skipped topic keeps its hunks in the reading order', async () => {
  const skipped = (reason) => [{ hunkId: 'h2', reason }];
  const brief = await validate([intent, graph(['h1']), tests, reading(both.slice(0, 1))], { skipped: skipped('the viewer chose a brief look at this topic') });
  assert.deepEqual(matching(brief.warnings, /^skipped\[/), [
    'skipped[0]: h2 src/server.ts (+16) is skipped as "the viewer chose a brief look at this topic", so it is not in the reading order; in a pre-read the plan\'s depth changes only the video, and the reviewer still reads the code, so add it to the reading scene\'s items ("routine": true for a change to skim)',
  ]);
  const skip = await validate([intent, graph(['h1']), tests, reading(both.slice(0, 1))], { skipped: skipped('the viewer chose to skip this topic') });
  assert.equal(matching(skip.warnings, /skipped as "the viewer chose to skip this topic", so it is not in the reading order/).length, 1);
  // A small hunk may still be skipped, and a reviewer's video still skips a brief topic's hunks.
  const small = await validate([intent, graph(['h1', 'h2']), tests, reading(both)], { skipped: [{ hunkId: 'h3', reason: 'the viewer chose a brief look at this topic' }] });
  assert.deepEqual(matching(small.warnings, /^skipped\[/), []);
  const reviewer = await validate([intent, graph(), tests], { skipped: skipped('the viewer chose a brief look at this topic') }, 'familiar');
  assert.deepEqual(matching(reviewer.warnings, /^skipped\[/), []);

  const topic = { id: 'route', title: 'The route', summary: 'Mounts it.', files: [], depth: 'skip', views: ['parts'], seconds: { brief: 30, deep: 60 } };
  const plan = { plan: { topics: [topic] }, ...checkPlan({ topics: [topic] }, { preread: true }) };
  const shown = await validateStoryboard({ title: 'Rate limit', scenes: [intent, { ...graph(['h1', 'h2']), topic: 'route' }, tests, reading(both)], plan: { route: { depth: 'skip', view: 'parts' } } }, hunks, { audience: 'preread', plan });
  assert.deepEqual(matching(shown.warnings, /chose to skip it/), ['topic "route": the viewer chose to skip it, but scenes[1] show it; remove them and add its hunks to the reading order, since the reviewer still reads them']);
});

test('a pre-read flags findings only on reading items, on a line of the item\'s hunk', async () => {
  const finding = (line) => ({ id: 'per-server', severity: 'bug', file: 'src/limiter.ts', line, claim: 'the count is per server', evidence: 'two servers each allow twenty, so forty pass' });
  const flow = { type: 'flow', narration: 'One order.', from: ['h1'], steps: [{ actor: '`checkLimit`', action: 'count 21 of 20', say: 'I think this count is per server.', flag: 'per-server' }] };
  const stepFlag = await validate([intent, graph(['h1', 'h2']), flow, tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])], { findings: [finding(14)] });
  assert.deepEqual(matching(stepFlag.errors, /flag/), ['scenes[2].steps[0].flag: a pre-read carries its findings on the reading order; flag it on the reading item of its hunk']);

  // h1 holds src/limiter.ts lines 12 to 31; line 40 is in the same file but not in that hunk.
  const outside = await validate([intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])], { findings: [finding(40)] });
  assert.deepEqual(matching(outside.errors, /items\[0\]\.flag/), ['scenes[3].items[0].flag: "per-server" is at src/limiter.ts:40, but h1 covers src/limiter.ts:12-31; flag it on the item of the hunk that holds that line']);
  const edge = await validate([intent, graph(['h1', 'h2']), tests, reading([{ ...both[0], flag: 'per-server' }, both[1]])], { findings: [finding('30-33')] });
  assert.deepEqual(matching(edge.errors, /items\[0\]\.flag/), []);
});

test('"Explained in" names the scene to seek to, and two citing scenes need their own chapters', async () => {
  const twin = { ...graph(['h2']), narration: 'The route mounts it in `server.ts`.' };
  const { warnings } = await validate([intent, graph(['h1']), twin, tests, reading(both)]);
  assert.deepEqual(matching(warnings, /Explained in/), ['scenes[2]: cites hunks in "from" under the chapter "The limiter", as scenes[1] does, so the reading order\'s "Explained in" cannot tell them apart; give one its own "chapter"']);
  const sb = { title: 'Rate limit', scenes: [intent, graph(['h1']), { ...twin, chapter: 'The route' }, tests, reading(both)] };
  assert.deepEqual(readingOrder(sb, hunks).items.map((i) => i.explainedIn), [{ chapter: 'The limiter', scene: 1 }, { chapter: 'The route', scene: 2 }]);
});

test('reading.md keeps paths and inline code as code, and file names lose control characters', () => {
  const odd = { ...hunks, h4: { ...hunk('h4', 'src/we\u001b[31mird\u0007.ts', ['export const LIMIT = 20;']), lines: [{ type: 'add', oldLine: null, newLine: 7, text: 'export const LIMIT = 20;' }] } };
  const sb = { title: 'Rate limit', findings: [{ id: 'f', severity: 'risk', file: 'src/limiter.ts', line: 12, claim: '`checkLimit` trusts **the header**', evidence: 'x' }], scenes: [intent, graph(['h1']), tests, reading([{ hunkId: 'h1', check: 'the `windowStart` resets on a **new** minute', flag: 'f' }, { hunkId: 'h4', check: 'the limit is 20' }])] };
  const order = readingOrder(sb, odd);
  assert.equal(readingChecklist(order), [
    '- [ ] 1. `src/limiter.ts:12-31`: the `windowStart` resets on a new minute (Claude: risk, `checkLimit` trusts the header)',
    '- [ ] 2. `src/we[31mird.ts:7`: the limit is 20',
  ].join('\n'));
  assert.deepEqual(readingLines(order), [
    '  1. src/limiter.ts:12-31  the windowStart resets on a new minute (Claude: risk, checkLimit trusts the header)',
    '  2. src/we[31mird.ts:7  the limit is 20',
  ]);
});

test('a reading scene or from outside a pre-read asks for --audience preread', async () => {
  const { warnings } = await validate([intent, graph(['h1', 'h2']), tests, reading(both)], {}, 'familiar');
  assert.deepEqual(matching(warnings, /pre-read/), [
    'this storyboard is a pre-read; pass --audience preread',
    'scenes[1].from: only a pre-read (--audience preread) reads "from"; show the code in a code scene instead',
    'scenes[3]: only a pre-read has a reading scene; pass --audience preread, or remove it',
  ]);
  const plain = await validate([intent, graph(), tests], { skipped: [{ hunkId: 'h1', reason: 'formatting only' }, { hunkId: 'h2', reason: 'formatting only' }] }, 'familiar');
  assert.deepEqual(matching(plain.warnings, /pre-read/), []);
});

test('a pre-read warns about a label that writes code, and allows names and plain words', async () => {
  const flow = (payloads) => ({
    type: 'flow', chapter: 'One delivery', narration: 'The worker claims a row, and `claimDue(row, now)` is fine to say.', from: ['h1'],
    steps: payloads.map((payload, i) => ({ actor: '`checkLimit`', action: 'POST with a 10 s timeout', payload, say: `Step ${i}, where a && b is spoken, not shown.` })),
  });
  const wrote = await validate([intent, graph(['h1', 'h2']), flow([
    "{ status: 'pending', next_attempt_at: now + 10 s }",
    'rows.filter(r => r.due)',
    'attempts === 8',
    'ok && signed',
    'claimDue(row, now)',
    'lock(); send()',
  ]), tests, reading(both)]);
  assert.deepEqual(matching(wrote.warnings, /never expressions/), [
    `scenes[2].steps[0].payload: "{ status: 'pending', next_attempt_at: now + 10 s }" is an object literal, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values`,
    'scenes[2].steps[1].payload: "rows.filter(r => r.due)" is an arrow function, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values',
    'scenes[2].steps[2].payload: "attempts === 8" is a comparison, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values',
    'scenes[2].steps[3].payload: "ok && signed" is a boolean expression, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values',
    'scenes[2].steps[4].payload: "claimDue(row, now)" is a call with arguments, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values',
    'scenes[2].steps[5].payload: "lock(); send()" is statements, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values',
  ]);
  const named = await validate([intent, graph(['h1', 'h2']), flow(['`claimDue`', 'limiter.ts', 'status pending, next try in 10 s', 'retries (up to 8); then dead', '{ status }', 'item(s)']), tests, reading(both)]);
  assert.deepEqual(matching(named.warnings, /never expressions/), []);
  const reviewer = await validate([intent, { ...graph(), nodes: [{ id: 'a', label: 'a && b' }, { id: 'b', label: 'b' }], edges: [{ from: 'a', to: 'b' }] }, tests], { skipped: [{ hunkId: 'h1', reason: 'formatting only' }, { hunkId: 'h2', reason: 'formatting only' }] }, 'familiar');
  assert.deepEqual(matching(reviewer.warnings, /never expressions/), []);
});

test('the from check counts labels, not narration or a step\'s words', async () => {
  // h3 is config.ts with MAX_REQUESTS; the narration and the step say both, but no label does.
  const g = { ...graph(['h1', 'h3']), narration: 'It reads `MAX_REQUESTS` from `config.ts`.', steps: [{ focus: 'limiter', say: 'Here `MAX_REQUESTS` is twenty.' }] };
  const { warnings } = await validate([intent, g, tests, reading([...both, { hunkId: 'h3', routine: true }])]);
  assert.equal(matching(warnings, /nothing on screen names h3/).length, 1);
});

test('the reading scene counts the items to read past the first six apart from the routine ones', () => {
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`r${i}`, hunk(`r${i}`, `src/part${i}.ts`, ['export const a = 1;'], 1)]));
  const items = Array.from({ length: 11 }, (_, i) => (i < 8 ? { hunkId: `r${i}`, check: `check part ${i}` } : { hunkId: `r${i}`, routine: true }));
  const sb = { title: 'Parts', scenes: [intent, reading(items)] };
  const layout = layoutReading(readingOrder(sb, many), items, 1712, 760);
  assert.equal(layout.rows.length, 6);
  assert.equal(moreText(layout), '+2 more to read, +3 routine');
  assert.equal(moreText({ moreToRead: 0, routine: 1 }), '+1 routine');
  assert.equal(moreText({ moreToRead: 1, routine: 0 }), '+1 more to read');
});
