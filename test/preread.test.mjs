import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../bin/lib/server.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { checkPlan } from '../shared/plan.mjs';
import { readingLines, readingMarkdown, readingOrder } from '../shared/reading.mjs';

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
    'skipped[0]: h2 src/server.ts (+16) is skipped as "covered by the diagrams", but a video for a reviewer who reads the code next shows every substantial hunk; add it to the reading scene\'s items ("routine": true for a change to skim). Only the team\'s overview leaves code to the diagrams, and a topic the viewer chose brief its non-key hunks, with the reason "the viewer chose a brief look at this topic"',
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
  assert.deepEqual(matching(two.warnings, /chose deep/), []);
});

test('the reading order resolves file and lines from hunks.json, numbers the items to read, and collapses routine ones', () => {
  // Without a plan there are no topics, so the checklist has no headings.
  const plain = { title: 'Rate limit', scenes: [intent, graph(['h1', 'h2']), tests, reading([both[0], { hunkId: 'h3', routine: true }, both[1]])] };
  assert.equal(readingMarkdown(plain, readingOrder(plain, hunks)).split('\n').slice(4).join('\n'), [
    '- [ ] 1. src/limiter.ts:12-31: the key resets on a new minute; check the off-by-one',
    '- [ ] 2. src/server.ts:40-55: the limiter runs before the order is saved',
    '',
    '### Skim',
    '',
    '- [ ] src/config.ts:3-4',
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
    [1, 'src/limiter.ts:12-31', 'The limiter', 'Rate limiter: twenty a minute'],
    [null, 'src/config.ts:3-4', 'The limiter', 'Rate limiter: twenty a minute'],
    [2, 'src/server.ts:40-55', 'The route', null],
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
    '- [ ] 1. src/limiter.ts:12-31: the key resets on a new minute; check the off-by-one (Claude: likely bug, the count is per server)',
    '',
    '### Other changes',
    '',
    '- [ ] 2. src/server.ts:40-55: the limiter runs before the order is saved',
    '',
    '### Skim',
    '',
    '- [ ] Rate limiter: twenty a minute: src/config.ts:3-4',
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
    const run = (cmd) => spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), cmd, '--audience', 'preread', '--dir', dir], { encoding: 'utf8', env });
    const validated = run('validate');
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /wrote .*reading\.md/);
    assert.match(fs.readFileSync(path.join(dir, 'reading.md'), 'utf8'), /^# Reading order: Rate limit\n[\s\S]*- \[ \] 1\. src\/limiter\.ts:12-31: the key resets on a new minute; check the off-by-one\n/);
    const outlined = run('outline');
    assert.equal(outlined.status, 0, outlined.stderr);
    assert.deepEqual(outlined.stdout.trim().split('\n').slice(-4), [
      'reading order:',
      '  1. src/limiter.ts:12-31  the key resets on a new minute; check the off-by-one',
      '  2. src/server.ts:40-55  the limiter runs before the order is saved',
      '  skim: src/config.ts:3-4',
    ]);
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
