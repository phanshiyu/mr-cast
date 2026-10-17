import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArticlePlan, parseArticle, readerText } from '../bin/lib/article.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const CLI = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));

const ARTICLE = `# How quicksort sorts a list

## Takeaways

1. Quicksort picks a pivot and moves smaller values left of it and larger ones right.
2. After a partition the pivot is in its final place, so only the two sides are left to sort.

## A partition puts the pivot in its final place {#partition}

Take [7, 2, 9, 4, 3] and pick the last value, 3, as the pivot. Only 2 is smaller, so the list becomes [2, 3, 9, 4, 7].

## Each side is sorted the same way {#recurse}

The left side is [2], already sorted. The right side [9, 4, 7] is partitioned around 7.

## Questions

1. Where is 3 after the first partition of [7, 2, 9, 4, 3]?
   Answer: at index 1, which is its final place.
   Takeaway: 1
2. Why is 3 never moved again?
   Answer: every smaller value is left of it and every larger one right.
   Takeaway: 2

## Left out

- How to pick the pivot, because the idea holds for any pivot.
`;

test('a well-formed article parses into its takeaways, sections and questions', () => {
  const a = parseArticle(ARTICLE);
  assert.deepEqual({ errors: a.errors, warnings: a.warnings }, { errors: [], warnings: [] });
  assert.equal(a.title, 'How quicksort sorts a list');
  assert.deepEqual(a.sections.map((s) => [s.id, s.title, s.line]), [
    ['partition', 'A partition puts the pivot in its final place', 8],
    ['recurse', 'Each side is sorted the same way', 12],
  ]);
  assert.deepEqual(a.questions[1], { question: 'Why is 3 never moved again?', answer: 'every smaller value is left of it and every larger one right.', takeaway: 2 });
});

test('the article names what is missing or malformed, with the fix', () => {
  const broken = ARTICLE
    .replace('## Each side is sorted the same way {#recurse}', '## Recursion')
    .replace('   Takeaway: 2\n', '')
    .replace('## Left out\n\n- How to pick the pivot, because the idea holds for any pivot.\n', '');
  assert.deepEqual(parseArticle(broken).errors, [
    'article.md:12: "## Recursion" has no id; end the heading with one, as "## Recursion {#recursion}"',
    'article.md: no "## Left out" section',
    'article.md: question 2 needs a "Takeaway: <n>" line naming one of the 2 takeaways it tests',
    'article.md: takeaway 2 has no question; add one a reader who got it could answer and one who did not could not',
  ]);
});

const MEDIUM = (phrase, line) => `article.md:${line}: "${phrase}" is about the medium; the article teaches the idea alone, so write it as you would for a page (a code name in backticks, such as \`scene\`, is fine)`;
const withText = (text) => parseArticle(ARTICLE.replace('already sorted.', `already sorted.\n\n${text}`));

test('phrases about the medium warn, but not inside code', () => {
  const a = withText('As the next scene shows, the viewer sees it on screen. The `scene` field is code.');
  assert.deepEqual([a.errors, a.warnings], [[], [MEDIUM('the next scene', 16)]]);
  const lines = ['This video sorts it.', 'The storyboard says so.', 'The narration says so.', 'The video ends.', 'On-screen it moves.', 'The viewers watch.'];
  assert.deepEqual(withText(lines.join('\n')).warnings, [MEDIUM('This video', 16), MEDIUM('storyboard', 17), MEDIUM('narration', 18), MEDIUM('The video', 19), MEDIUM('On-screen', 20), MEDIUM('The viewers', 21)]);
});

test('ordinary words of an article about code are not about the medium', () => {
  const text = 'Primitive values are copied. Synchronization primitives guard it. The window slides right. The image viewer opens it. The narrative holds. A CSS animation runs. The scene graph is a tree.';
  const a = withText(text);
  assert.deepEqual([a.errors, a.warnings], [[], []]);
});

test('a fenced block is code across its lines, and a ## line inside it is no heading', () => {
  const block = ['```text', 'the video shows this scene', '## Questions', '```', '', '~~~~', 'on screen', '~~~', '## Not a heading', '~~~~', ''].join('\n');
  const a = withText(block);
  assert.deepEqual([a.errors, a.warnings], [[], []]);
  assert.deepEqual(a.sections.map((s) => [s.id, s.words]), [['partition', 28], ['recurse', 17]], 'code is not counted as words');
  assert.equal(a.questions.length, 2);
});

test('a heading that is a label rather than a claim warns', () => {
  const a = parseArticle(ARTICLE.replace('A partition puts the pivot in its final place', 'Partition'));
  assert.deepEqual(a.warnings, ['article.md:8: "Partition" is a label; state the section\'s claim as a sentence, such as "Each partition puts the pivot in its final place"']);
});

test('the reader sees the questions without their answers', () => {
  const text = readerText(ARTICLE, parseArticle(ARTICLE));
  assert.ok(text.includes('## Left out'));
  assert.equal(text.includes('Answer:'), false);
  assert.ok(text.endsWith('## Questions\n\n1. Where is 3 after the first partition of [7, 2, 9, 4, 3]?\n2. Why is 3 never moved again?\n'));
});

test('the reader sees no answer whatever the case of the Questions heading, or an id on it', () => {
  for (const heading of ['## questions', '## QUESTIONS {#questions}']) {
    const article = ARTICLE.replace('## Questions', heading);
    const text = readerText(article, parseArticle(article));
    assert.equal(text.includes('Answer:'), false, heading);
    assert.equal(text.includes(heading), false, heading);
    assert.ok(text.includes('## Left out\n\n- How to pick the pivot'), heading);
  }
});

test('the article keeps a section per kept topic of the plan, in its order', () => {
  const warnings = [];
  const plan = { topics: [
    { id: 'recurse', depth: 'deep', views: ['steps'] },
    { id: 'partition', depth: 'brief', views: ['steps'] },
    { id: 'pivots', depth: 'deep', views: ['steps'], choice: { depth: 'skip', view: 'steps' } },
    { id: 'cost', depth: 'brief', views: ['steps'] },
  ] };
  checkArticlePlan(parseArticle(ARTICLE), plan, warnings);
  assert.deepEqual(warnings, [
    'article.md: section "partition" comes before the topic the plan puts ahead of it; follow the plan\'s order',
    'article.md: no section for the plan\'s topic "cost" (brief); write it as "## <its claim> {#cost}"',
  ]);
});

const intent = { type: 'intent', narration: 'Quicksort places one value at a time.', summary: 'Place a pivot, then sort each side', bullets: ['The pivot lands in its final place'] };
const row = (section, values) => ({ type: 'array', ...(section && { section }), narration: 'The list as it stands now.', values });
const check = (scenes, extra = {}) => validateStoryboard({ title: 'Quicksort', scenes, ...extra }, {}, { mode: 'explain', article: parseArticle(ARTICLE) });

test('every scene adapts a known section, in the article\'s order, and every section is adapted', async () => {
  assert.deepEqual(await check([intent, row('partition', [7, 2, 9, 4, 3]), row('recurse', [2, 3, 9, 4, 7])]), { errors: [], warnings: [], coverage: null });
  const out = await check([intent, row('recurse', [2, 3, 9, 4, 7]), row('partition', [7, 2, 9, 4, 3]), row('nope', [1]), row(null, [1])]);
  assert.deepEqual(out.errors, ['scenes[3].section: no section "nope" in article.md; use one of partition, recurse']);
  assert.deepEqual(out.warnings.filter((w) => /section|article/.test(w)), [
    'scenes[4]: adapts no article section; set "section" to one of partition, recurse, or change the article first if this idea belongs in it',
    'scenes[2]: adapts "partition", which the article puts before "recurse" of scenes[1]; the diagrams follow the article\'s order',
  ]);
});

test('a section no scene adapts warns unless it is text-only with a reason', async () => {
  const scenes = [intent, row('partition', [7, 2, 9, 4, 3])];
  assert.deepEqual((await check(scenes)).warnings, ['article.md: no scene adapts section "recurse"; add a scene with "section": "recurse", or list it in "textOnly" with the reason it stays in the article alone']);
  assert.deepEqual(await check(scenes, { textOnly: [{ section: 'recurse', reason: 'the same partition again' }] }), { errors: [], warnings: [], coverage: null });
  assert.deepEqual((await check(scenes, { textOnly: [{ section: 'recurse' }] })).errors, ['textOnly[0].reason: say why this section stays in the article alone']);
});

test('a scene with a topic adapts the section of that id, and the code follows the article apart from the diagrams', async () => {
  const hunks = { s1: { id: 's1', file: 'qs.ts', oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, header: '', additions: 0, deletions: 0, lines: [{ type: 'context', oldNo: null, newNo: 1, text: 'a' }, { type: 'context', oldNo: null, newNo: 2, text: 'b' }] } };
  const code = (topic) => ({ type: 'code', topic, hunkId: 's1', narration: 'The partition function walks the list once.' });
  const sb = { title: 'Quicksort', scenes: [intent, { ...row(null, [7, 2, 9, 4, 3]), topic: 'partition' }, row('recurse', [2, 3]), code('partition'), code('recurse')] };
  const { warnings } = await validateStoryboard(sb, hunks, { mode: 'explain', article: parseArticle(ARTICLE) });
  assert.deepEqual(warnings.filter((w) => /section|article's order/.test(w)), []);
});

function run(args, cwd, env, input) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, ...env, MR_CAST_NO_UPDATE_CHECK: '1' } });
}

test('mr-cast article prints the takeaways, and the hook stops a broken storyboard with exit 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-article-'));
  const env = { XDG_CONFIG_HOME: path.join(tmp, 'config'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
  try {
    const repo = path.join(tmp, 'work');
    fs.mkdirSync(repo);
    assert.equal(run(['init', '--title', 'Quicksort'], repo, env).status, 0);
    const dir = path.join(repo, '.mr-cast', 'quicksort');
    fs.writeFileSync(path.join(dir, 'article.md'), ARTICLE);
    const ok = run(['article'], repo, env);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'Takeaways of "How quicksort sorts a list":\n1. Quicksort picks a pivot and moves smaller values left of it and larger ones right.\n2. After a partition the pivot is in its final place, so only the two sides are left to sort.\n✓ article ok: 2 sections (partition, recurse), 2 questions, 45 words\n');

    const event = (file) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file } });
    const other = run(['hook'], repo, env, event(path.join(repo, 'notes.md')));
    assert.deepEqual([other.status, other.stderr], [0, '']);
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'Quicksort', scenes: [intent, row('nope', [1])] }));
    const bad = run(['hook'], repo, env, event(path.join(dir, 'storyboard.json')));
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /error: scenes\[1\]\.section: no section "nope" in article\.md/);
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'Quicksort', scenes: [intent, row('partition', [7, 2, 9, 4, 3]), row('recurse', [2, 3])] }));
    const good = run(['hook'], repo, env, event(path.join(dir, 'storyboard.json')));
    assert.deepEqual([good.status, good.stderr], [0, '']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
