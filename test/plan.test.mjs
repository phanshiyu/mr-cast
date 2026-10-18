import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeChoice, readPlan, recordBuilt } from '../bin/lib/plan.mjs';
import { TOKEN_HEADER, startServer } from '../bin/lib/server.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatOutline } from '../bin/lib/summary.mjs';
import { checkPlan, formatLength, pickOf, planSeconds } from '../shared/plan.mjs';

const topic = (id, over = {}) => ({
  id, title: `Topic ${id}`, summary: 'What it covers.', files: ['src/a.ts'], depth: 'brief',
  views: ['calls', 'compare'], seconds: { brief: 40, deep: 110 }, ...over,
});
const plan = (...topics) => ({ topics });

test('a plan with known views, depths and seconds has no problems', () => {
  assert.deepEqual(checkPlan(plan(topic('rate-limiter'), topic('pricing', { views: ['code'], why: 'Only lines change.' }))), { errors: [], warnings: [] });
});

test('a plan names each bad field', () => {
  const { errors } = checkPlan(plan(
    topic('Rate Limiter', { depth: 'medium', views: ['calls', 'sequence'], seconds: { brief: 40 } }),
    topic('pricing', { views: ['calls', 'calls', 'data', 'code'] }),
    topic('orders', { choice: { depth: 'deep', view: 'states' } }),
  ));
  assert.deepEqual(errors, [
    'topics[0].id: required slug of lowercase letters, digits and single dashes, such as "rate-limiter" (got "Rate Limiter")',
    'topics[0].depth: must be one of skip, brief, deep, your suggestion',
    'topics[0].seconds: required { "brief": n, "deep": n }, about how many seconds the topic takes at each depth',
    'topics[0].views[1]: unknown view "sequence"; use one of parts, calls, data, decisions, states, layers, schema, compare, timing, facts, numbers, shell, memory, steps, code',
    'topics[1].views: required array of 1 to 3 views, your suggestion first',
    "topics[2].choice: view must be one of the topic's views, calls, compare (got \"states\")",
  ]);
  assert.deepEqual(checkPlan({}).errors, ['topics: required non-empty array']);
});

test('the length counts each topic at its pick, plus the opening and the tests', () => {
  const p = plan(topic('a'), topic('b', { choice: { depth: 'deep', view: 'compare' } }), topic('c', { choice: { depth: 'skip', view: 'calls' } }));
  assert.equal(planSeconds(p), 40 + 40 + 110);
  assert.equal(formatLength(planSeconds(p)), 'About 3:10');
  assert.equal(formatLength(271), 'About 4:30');
});

test('a choice is merged into its topic only, and null goes back to the suggestion', () => {
  const p = plan(topic('a'), topic('b', { choice: { depth: 'skip', view: 'calls' } }));
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: { depth: 'deep', view: 'compare' } }).plan.topics[0].choice, { depth: 'deep', view: 'compare' });
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: { depth: 'deep', view: 'compare' } }).plan.topics[1], p.topics[1]);
  assert.equal('choice' in mergeChoice(p, { topic: 'b', choice: null }).plan.topics[1], false);
});

test('a choice for an unknown topic, a view it does not offer, or with more fields is refused', () => {
  const p = plan(topic('a'));
  assert.deepEqual(mergeChoice(p, { topic: 'nope', choice: { depth: 'deep', view: 'calls' } }), { error: 'no topic "nope" in plan.json' });
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: { depth: 'deep', view: 'states' } }), { error: "choice view must be one of the topic's views, calls, compare (got \"states\")" });
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: { depth: 'huge', view: 'calls' } }), { error: 'choice depth must be one of skip, brief, deep (got "huge")' });
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: { depth: 'deep', view: 'calls', title: 'x' } }), { error: 'choice takes only depth and view (got title)' });
  assert.deepEqual(mergeChoice(p, { topic: 'a', choice: null, topics: [] }), { error: 'unexpected topics; send only topic and choice' });
});

async function withServer(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-plan-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  fs.mkdirSync(dist);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(data, 'plan.json'), JSON.stringify(plan(topic('a'), topic('b'))));
  const server = await startServer({ distDir: dist, dataDir: data, port: 0 });
  const post = (body, headers = { 'content-type': 'application/json', [TOKEN_HEADER]: server.token }) =>
    fetch(`${server.url}/plan/choice`, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    await fn({ data, post, server, onDisk: () => JSON.parse(fs.readFileSync(path.join(data, 'plan.json'), 'utf8')) });
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the server writes a choice with the token into plan.json and keeps the rest', () => withServer(async ({ post, onDisk }) => {
  assert.deepEqual(await post({ topic: 'b', choice: { depth: 'deep', view: 'compare' } }), { status: 200, body: { ok: true } });
  assert.deepEqual(onDisk(), plan(topic('a'), topic('b', { choice: { depth: 'deep', view: 'compare' } })));
}));

test('the server refuses a write without the token, a bad token, an unknown topic or a bad value', () => withServer(async ({ post, server, onDisk }) => {
  const choice = { topic: 'a', choice: { depth: 'deep', view: 'calls' } };
  assert.equal((await post(choice, { 'content-type': 'application/json' })).status, 403);
  assert.equal((await post(choice, { 'content-type': 'application/json', [TOKEN_HEADER]: 'f'.repeat(server.token.length) })).status, 403);
  assert.equal((await post(choice, { 'content-type': 'text/plain', [TOKEN_HEADER]: server.token })).status, 415);
  assert.deepEqual(await post({ topic: 'zzz', choice: choice.choice }), { status: 400, body: { error: 'no topic "zzz" in plan.json' } });
  assert.equal((await post({ topic: 'a', choice: { depth: 'deep', view: 'memory' } })).status, 400);
  assert.deepEqual(onDisk(), plan(topic('a'), topic('b')));
}));

test('the server refuses a write while plan.json is not valid', () => withServer(async ({ data, post }) => {
  fs.writeFileSync(path.join(data, 'plan.json'), '{ "topics": [');
  assert.equal((await post({ topic: 'a', choice: { depth: 'deep', view: 'calls' } })).status, 409);
  assert.equal(fs.readFileSync(path.join(data, 'plan.json'), 'utf8'), '{ "topics": [');
}));

test('a write the disk refuses is a 500 with the reason, and the server keeps serving', () => withServer(async ({ data, post }) => {
  fs.chmodSync(data, 0o555);
  try {
    const { status, body } = await post({ topic: 'a', choice: { depth: 'deep', view: 'calls' } });
    assert.equal(status, 500);
    assert.match(body.error, /^could not write plan\.json: EACCES/);
  } finally {
    fs.chmodSync(data, 0o755);
  }
  assert.equal((await post({ topic: 'a', choice: { depth: 'deep', view: 'calls' } })).status, 200);
}));

test('the built picks are exactly the storyboard\'s plan, in plan order, whatever was built before', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-plan-'));
  const built = () => JSON.parse(fs.readFileSync(path.join(dir, 'plan-built.json'), 'utf8'));
  const p = plan(topic('a'), topic('b', { choice: { depth: 'deep', view: 'compare' } }));
  recordBuilt(dir, p, { b: { depth: 'brief', view: 'calls' }, a: { depth: 'skip', view: 'compare' } });
  assert.deepEqual(built(), { topics: { a: { depth: 'skip', view: 'compare' }, b: { depth: 'brief', view: 'calls' } } });
  recordBuilt(dir, p, { b: { depth: 'deep', view: 'compare' } });
  assert.deepEqual(built(), { topics: { b: { depth: 'deep', view: 'compare' } } });
  recordBuilt(dir, p, undefined);
  assert.deepEqual(built(), { topics: {} });
  assert.equal(readPlan(dir), null);
  fs.rmSync(dir, { recursive: true });
});

const opening = { type: 'text', narration: 'Orders now have a rate limit.', headline: 'Limit orders', risk: 'low', items: ['Twenty a minute'] };
const sequence = (topicId) => ({
  type: 'sequence', topic: topicId, narration: 'The client sends an order to the server.',
  participants: [{ id: 'c', label: 'Client' }, { id: 's', label: 'Server' }], messages: [{ from: 'c', to: 's', label: 'POST /orders' }],
});
const compare = (topicId) => ({ type: 'compare', topic: topicId, narration: 'The limit before and after.', rows: [{ label: 'Limit', cells: ['None', 'Twenty'] }] });
const picksOf = (p) => Object.fromEntries(p.topics.map((t) => [t.id, pickOf(t)]));
const topicsOf = async (scenes, p, written = picksOf(p)) => validateStoryboard({ title: 'Limits', scenes, plan: written }, {}, { plan: { plan: p, ...checkPlan(p) } });
const about = (list) => list.filter((m) => /topic|^plan[.:]/.test(m));

test('a storyboard that follows the picks has no topic problems', async () => {
  const p = plan(topic('limit'), topic('orders', { choice: { depth: 'brief', view: 'compare' } }), topic('logs', { choice: { depth: 'skip', view: 'calls' } }));
  const { errors, warnings } = await topicsOf([opening, sequence('limit'), compare('orders')], p);
  assert.deepEqual([...errors, ...about(warnings)], []);
});

test('a storyboard without a plan entry for each topic is warned about', async () => {
  const p = plan(topic('limit'), topic('orders', { choice: { depth: 'brief', view: 'compare' } }));
  const scenes = [opening, sequence('limit'), compare('orders')];
  const unrecorded = await validateStoryboard({ title: 'Limits', scenes }, {}, { plan: { plan: p, ...checkPlan(p) } });
  assert.deepEqual(about(unrecorded.warnings), [
    'plan: missing; copy the pick of each topic in plan.json into the storyboard\'s "plan", such as { "limit": {"depth":"brief","view":"calls"} }',
  ]);
  assert.deepEqual(about((await topicsOf(scenes, p, { limit: { depth: 'brief', view: 'calls' } })).warnings), [
    'plan: no entry for "orders"; add the pick its scenes were written from, {"depth":"brief","view":"compare"}',
  ]);
});

test('a plan entry for an unknown topic or with a pick the topic does not offer is an error', async () => {
  const p = plan(topic('limit'));
  const { errors } = await topicsOf([opening, sequence('limit')], p, { limit: { depth: 'brief', view: 'states' }, nope: { depth: 'brief', view: 'calls' } });
  assert.deepEqual(errors, [
    "plan.limit: view must be one of the topic's views, calls, compare (got \"states\")",
    'plan.nope: no topic "nope" in plan.json; use one of limit',
  ]);
});

test('a pick flipped after the storyboard was written warns, and stays marked until its entry is updated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-plan-'));
  const built = () => JSON.parse(fs.readFileSync(path.join(dir, 'plan-built.json'), 'utf8')).topics;
  const written = { a: { depth: 'brief', view: 'calls' }, b: { depth: 'brief', view: 'calls' } };
  const flipped = plan(topic('a'), topic('b', { title: 'Orders', choice: { depth: 'deep', view: 'compare' } }));
  const before = [opening, sequence('a'), sequence('b')];
  const stale = await topicsOf(before, flipped, written);
  assert.deepEqual(stale.errors, []);
  assert.deepEqual(about(stale.warnings), ['plan.b: the plan changed since the storyboard was written: "Orders" is now deep, Before vs after; update its scenes and this entry']);
  recordBuilt(dir, flipped, written);
  assert.deepEqual(built().b, { depth: 'brief', view: 'calls' });

  const rebuilt = { ...written, b: { depth: 'deep', view: 'compare' } };
  const after = [opening, sequence('a'), compare('b')];
  const fresh = await topicsOf(after, flipped, rebuilt);
  assert.deepEqual([...fresh.errors, ...about(fresh.warnings)], []);
  recordBuilt(dir, flipped, rebuilt);
  assert.deepEqual(built(), { a: pickOf(flipped.topics[0]), b: pickOf(flipped.topics[1]) });
  fs.rmSync(dir, { recursive: true });
});

test('the scenes are checked against the pick the storyboard was written from', async () => {
  const p = plan(topic('b', { choice: { depth: 'deep', view: 'compare' } }));
  const { warnings } = await topicsOf([opening, sequence('b')], p, { b: { depth: 'brief', view: 'calls' } });
  assert.deepEqual(about(warnings), ['plan.b: the plan changed since the storyboard was written: "Topic b" is now deep, Before vs after; update its scenes and this entry']);
});

test('a storyboard plan without a plan.json is warned about', async () => {
  const { warnings } = await validateStoryboard({ title: 'Limits', scenes: [opening], plan: { a: { depth: 'brief', view: 'calls' } } }, {}, {});
  assert.ok(warnings.includes('plan: this run has no plan.json, so there are no picks to record; remove "plan"'), warnings.join('\n'));
});

test('an unknown topic id is an error', async () => {
  const { errors } = await topicsOf([opening, sequence('nope')], plan(topic('limit')));
  assert.deepEqual(errors, ['scenes[1].topic: no topic "nope" in plan.json; use one of limit']);
});

test('a missing, skipped or wrongly drawn topic is warned about', async () => {
  const p = plan(
    topic('limit'),
    topic('orders', { choice: { depth: 'deep', view: 'compare' } }),
    topic('logs', { choice: { depth: 'skip', view: 'calls' } }),
  );
  const { errors, warnings } = await topicsOf([opening, sequence('orders'), sequence('logs')], p);
  assert.deepEqual(errors, []);
  assert.deepEqual(about(warnings), [
    'scenes[1] is a sequence scene in "orders", which the viewer chose to see as "Before vs after"; draw it as a compare scene, or move this scene to another topic',
    'topic "limit": the viewer chose brief, and no scene has "topic": "limit"; add its scenes, or tag the scenes that show it',
    'topic "orders": the viewer chose to see it as "Before vs after", and none of its scenes is a compare scene; add one',
    'topic "logs": the viewer chose to skip it, but scenes[2] show it',
  ]);
});

test('an invalid plan.json fails validate', async () => {
  const p = plan(topic('limit', { views: [] }));
  const { errors } = await topicsOf([opening, sequence('limit')], p);
  assert.deepEqual(errors, ['plan.json: topics[0].views: required array of 1 to 3 views, your suggestion first']);
});

test('the outline groups scenes under their topic and lists skipped topics', () => {
  const p = plan(topic('limit', { title: 'Rate limiter' }), topic('logs', { title: 'Logging', choice: { depth: 'skip', view: 'calls' } }));
  const storyboard = { title: 'Limits', scenes: [opening, sequence('limit')] };
  const out = formatOutline({ storyboard, hunks: {}, coverage: null, seconds: 30, voiced: false, plan: p });
  assert.deepEqual(out.split('\n').slice(2, 7), ['No topic', '1. text        headline Limit orders · low risk · 1 item', '', 'Rate limiter (brief, who calls whom, in order)', '2. sequence    2 participants, 1 message']);
  assert.match(out, /\nskipped topics: Logging$/);
});
