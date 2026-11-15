import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../quality/understanding.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-understanding-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const critic = (grades, extra) => ({
  answers: grades.map((grade, i) => ({ id: `u${i + 1}`, grade, note: 'n' })),
  contradicted: [],
  missing: [],
  questions: { why: 'well', case: 'weakly', approach: 'well', parts: 'not', proof: 'not', check: 'weakly' },
  ease: 4,
  confident: 2,
  ...extra,
});
const put = (name, body) => {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
  fs.writeFileSync(path.join(tmp, name, 'critic.json'), typeof body === 'string' ? body : JSON.stringify(body));
};

test('understanding.mjs counts grades, scores and skips broken files', () => {
  put(
    'a',
    critic(['correct', 'correct', 'partly', 'wrong', 'not_shown', 'not_shown', 'partly'], { contradicted: ['x'] }),
  );
  put(
    'b',
    critic(['correct', 'correct', 'correct', 'correct', 'partly', 'wrong', 'wrong'], {
      contradicted: ['y', 'z'],
      questions: { why: 'well', case: 'well', approach: 'well', parts: 'well', proof: 'weakly', check: 'not' },
      ease: 5,
      confident: 4,
    }),
  );
  put('broken', '{nope');
  const r = spawnSync(process.execPath, [SCRIPT, tmp], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /broken: critic\.json is not valid JSON, skipped/);
  const out = JSON.parse(fs.readFileSync(path.join(tmp, 'understanding.json'), 'utf8'));
  const [a, b] = out.videos;
  assert.deepEqual([a.correct, a.partly, a.wrong, a.not_shown, a.score, a.contradicted], [2, 2, 1, 2, 3, 1]);
  assert.deepEqual(a.questions, { well: 2, weakly: 2, not: 2 });
  assert.deepEqual([b.correct, b.partly, b.wrong, b.not_shown, b.score, b.contradicted], [4, 1, 2, 0, 4.5, 2]);
  assert.equal(out.videos.length, 2);
  assert.equal(out.overall.score, 7.5);
  assert.equal(out.overall.outOf, 14);
  assert.equal(out.overall.contradicted, 3);
  assert.deepEqual(out.overall.questions, { well: 6, weakly: 3, not: 3 });
  assert.equal(out.overall.ease, 4.5);
  assert.equal(out.overall.confident, 3);
  assert.match(r.stdout, /OVERALL/);
});
