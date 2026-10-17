// plan.json on disk. Claude writes the file; the plan page changes one topic's `choice` at a time through
// writeChoice, which never takes more than that from the browser. plan-built.json records the picks the
// storyboard was written from, so the page can mark the picks the video does not have yet.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkPlan, choiceError } from '../../shared/plan.mjs';
import { locateJsonError } from './json.mjs';

export const PLAN_FILE = 'plan.json';
export const BUILT_FILE = 'plan-built.json';

/**
 * The run's plan with its problems, or null when it has no plan.json. A plan that is not JSON has
 * `plan: null` and one error. `preread` checks it for a pre-read, which offers no code view.
 */
export function readPlan(dir, { preread = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, PLAN_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const plan = JSON.parse(text);
    return { plan, ...checkPlan(plan, { preread }) };
  } catch {
    const loc = locateJsonError(text);
    return { plan: null, errors: [`not valid JSON${loc ? ` at line ${loc.line} column ${loc.column}: ${loc.reason}` : ''}`], warnings: [] };
  }
}

function writeAtomic(file, value) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * `plan` with one topic's choice set, or removed when `choice` is null (back to the suggestion), from a request
 * body `{ topic, choice }`. Returns `{ plan }`, or `{ error }` for a body that names no known topic or a pick
 * the topic does not offer.
 */
export function mergeChoice(plan, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'expected { "topic": id, "choice": { depth, view } | null }' };
  const extra = Object.keys(body).filter((k) => k !== 'topic' && k !== 'choice');
  if (extra.length) return { error: `unexpected ${extra.join(', ')}; send only topic and choice` };
  const index = plan.topics.findIndex((t) => t.id === body.topic);
  if (index < 0) return { error: `no topic ${JSON.stringify(body.topic)} in plan.json` };
  const topic = plan.topics[index];
  if (body.choice !== null) {
    const problem = choiceError(topic, body.choice);
    if (problem) return { error: `choice ${problem}` };
  }
  const { choice: _old, ...rest } = topic;
  const next = body.choice === null ? rest : { ...rest, choice: { depth: body.choice.depth, view: body.choice.view } };
  return { plan: { ...plan, topics: plan.topics.with(index, next) } };
}

/**
 * Applies a choice from the plan page to plan.json. Returns `{ status: 200 }`, or an HTTP status and the error:
 * 409 while plan.json is missing or invalid (Claude may be rewriting it), 400 for a bad request.
 */
export function writeChoice(dir, body) {
  const current = readPlan(dir);
  if (!current) return { status: 409, error: 'plan.json does not exist yet' };
  if (current.errors.length) return { status: 409, error: `plan.json has errors: ${current.errors[0]}` };
  const merged = mergeChoice(current.plan, body);
  if (merged.error) return { status: 400, error: merged.error };
  writeAtomic(path.join(dir, PLAN_FILE), merged.plan);
  return { status: 200 };
}

/**
 * Records the picks the storyboard says it was written from (its `plan`, already validated against `plan`) as the
 * picks the video was built from, so the plan page marks each topic whose current pick differs.
 */
export function recordBuilt(dir, plan, written = {}) {
  const topics = plan.topics.filter((t) => Object.hasOwn(written, t.id)).map((t) => [t.id, { depth: written[t.id].depth, view: written[t.id].view }]);
  writeAtomic(path.join(dir, BUILT_FILE), { topics: Object.fromEntries(topics) });
}
