import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { findingLocation, reviewMarkdown } from '../shared/review.mjs';

const line = (n, text) => ({ type: 'add', oldLine: null, newLine: n, text });
const hunks = {
  h1: {
    id: 'h1', file: 'src/reset.js', oldFile: null, status: 'added', language: 'javascript', header: '',
    startLine: 1, oldStartLine: 0, endLine: 3, additions: 3, deletions: 0, beforeCode: '', afterCode: '',
    lines: [line(1, 'export async function redeem(token) {'), line(2, '  await db.tokens.delete(row.userId);'), line(3, '}')],
  },
};
const finding = { id: 'reuse', severity: 'bug', file: 'src/reset.js', line: 2, claim: 'A used token still works', evidence: 'delete(row.userId) removes nothing' };
const code = (step) => ({ type: 'code', hunkId: 'h1', narration: 'Redeeming a token.', steps: [{ lines: '1', say: 'It finds the token.' }, { lines: '2', say: 'I think this delete is a bug.', ...step }] });
const board = (over = {}) => ({
  title: 'Reset',
  findings: [finding],
  scenes: [code({ flag: 'reuse' }), { type: 'review', narration: 'To recap, one bug.' }],
  ...over,
});
const errorsOf = async (sb) => (await validateStoryboard(sb, hunks)).errors;
const warningsOf = async (sb) => (await validateStoryboard(sb, hunks)).warnings;

test('a flagged finding on a line of the diff, recapped at the end, is valid', async () => {
  assert.deepEqual(await errorsOf(board()), []);
});

test('a finding must name a line the diff shows, a known severity and its evidence', async () => {
  const errors = await errorsOf(board({ findings: [{ ...finding, line: 9, severity: 'blocker', evidence: '' }] }));
  assert.ok(errors.some((e) => e.startsWith('findings[0].line: src/reset.js line 9 is not in the diff, which shows its lines 1-3')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('findings[0].severity: must be one of bug, risk, nit')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('findings[0].evidence: required')), errors.join('\n'));
});

test('a flag must sit on the step that shows its line', async () => {
  const sb = board({ scenes: [{ ...code({}), steps: [{ lines: '1', say: 'I think this is off.', flag: 'reuse' }, { lines: '2', say: 'It deletes.' }] }, { type: 'review', narration: 'Recap.' }] });
  assert.deepEqual(await errorsOf(sb), ['scenes[0].steps[0].flag: the step highlights lines 1, but "reuse" is at src/reset.js:2; flag it on the step that shows that line']);
});

test('findings need a recap scene, and a clean review has none', async () => {
  assert.deepEqual(await errorsOf(board({ scenes: [code({ flag: 'reuse' })] })), ['findings: 1 finding and no review scene; add one { "type": "review" } at the end to recap them']);
  assert.deepEqual(await errorsOf(board({ findings: [], scenes: [code({}), { type: 'review', narration: 'Recap.' }] })), [
    "scenes[1]: a review scene recaps the findings, and there are none; remove it, and say in the last scene's narration that nothing looked wrong",
  ]);
  assert.deepEqual(await errorsOf(board({ findings: [], scenes: [code({})] })), []);
});

test('an unflagged finding and a flag said as fact are warned about', async () => {
  const unflagged = await warningsOf(board({ scenes: [code({}), { type: 'review', narration: 'Recap.' }] }));
  assert.ok(unflagged.includes('findings: "reuse" (src/reset.js:2) is flagged on no code step; set "flag": "reuse" on the step that shows its line, so the video says it where the walkthrough reaches it'));
  const fact = await warningsOf(board({ scenes: [code({ flag: 'reuse', say: 'The delete uses the user id.' }), { type: 'review', narration: 'Recap.' }] }));
  assert.ok(fact.some((w) => w.startsWith('scenes[0].steps[1].say: a flag is your opinion')), fact.join('\n'));
});

test('a flagged step draws a circle with the claim unless it names its own mark and note', () => {
  const out = normalizeStoryboard(board(), hunks);
  assert.deepEqual(out.scenes[0].steps[1], { lines: '2', say: 'I think this delete is a bug.', flag: 'reuse', mark: 'circle', note: 'A used token still works' });
  const own = normalizeStoryboard(board({ scenes: [code({ flag: 'reuse', mark: 'underline', note: 'by user id' })] }), hunks);
  assert.equal(own.scenes[0].steps[1].mark, 'underline');
  assert.equal(own.scenes[0].steps[1].note, 'by user id');
});

test('review.md lists the findings worst first as file:line bullets with their evidence', () => {
  const nit = { id: 'name', severity: 'nit', file: 'src/a.js', line: '4-5', claim: '`check` returns a **string**', evidence: 'returns an error message' };
  assert.equal(findingLocation(nit), 'src/a.js:4-5');
  assert.equal(
    reviewMarkdown({ title: 'Reset', findings: [nit, finding] }, { branch: 'feature/reset', base: 'main' }),
    [
      '# Review: Reset',
      '',
      "Claude's review of `feature/reset` against `main`. Each finding is an opinion, checked against the code before it was written down.",
      '',
      '## Bugs',
      '',
      '- `src/reset.js:2` A used token still works',
      '  - Evidence: delete(row.userId) removes nothing',
      '',
      '## Nits',
      '',
      '- `src/a.js:4-5` check returns a string',
      '  - Evidence: returns an error message',
      '',
    ].join('\n'),
  );
  assert.equal(reviewMarkdown({ title: 'Reset', findings: [] }).endsWith('No findings. Nothing in the change looked wrong.\n'), true);
});
