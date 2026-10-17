// Prints a grader prompt for every answer file of one fixture in one phase. The answer files are named by
// opaque ids, so the grader cannot tell which arm wrote them.
//   node grader.mjs packet <fixture> <out.json> <answers.md>...
//   node grader.mjs review <fixture> <out.json> <checkout-dir> <answers.md>...
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [phase, fixture, out, ...rest] = process.argv.slice(2);
const key = path.join(here, '..', 'keys', `${fixture}.json`);
const rubric = `For each question, compare the reviewer's answer to the key's must_mention facts and score:
- 1 if every must_mention fact is present and nothing contradicts the key,
- 0.5 if some but not all of the facts are present, or the answer is right but vague,
- 0 if the facts are missing, wrong, or the answer is "not shown".
Accept different wording for the same fact. Do not reward length. Grade each file on its own merits; do not compare files.
The reviewed branch differs from the key's description in one seeded defect, the "${fixture}" entry of ${path.join(here, 'bugs.json')}.
An answer that describes the code as it is with that defect does not contradict the key. Use only the key, that entry and the
answer files (and the checkout when one is given); do not read the fixture scripts.`;

if (phase === 'packet') {
  console.log(`Grade reviewers' answers against an answer key. The key is ${key}. The answer files are:
${rest.map((f) => `- ${f}`).join('\n')}

${rubric}

Write ${out} as exactly one JSON array, one object per answer file, in the order above:
[{"file":"<path>","answers":[{"id":"q1","correct":1,"note":"one short sentence"}, ...one per question in the key],
  "ease":<the reviewer's ease number>,"confusing_scene":"<the reviewer's text>"}]
Write only that file.`);
} else if (phase === 'review') {
  const [checkout, ...files] = rest;
  console.log(`Grade code reviewers' answers. The answer key is ${key}; grade only the questions q1 to q6 (ignore q7).
The seeded defect key is the "${fixture}" entry of ${path.join(here, 'bugs.json')}. A clean checkout of the reviewed branch is at ${checkout}, for checking file:line citations.
The answer files are:
${files.map((f) => `- ${f}`).join('\n')}

${rubric}

For each question also score "evidence": 1 if the file:line citations given point at code that supports the answer
(open the checkout to check; a line off by up to 3 is fine), 0.5 if the file is right but the lines are not, 0 if wrong
or missing.

For the defects list, score "bug_found": 1 if a listed defect names the seeded defect's location and its consequence,
0.5 if it names the location and the mechanism but a wrong or vague consequence, 0 otherwise. "bug_rank" is its
position in the list, or null. "defects_listed" is how many defects are listed, and "false_defects" how many of them
are not real problems in the code (check the checkout; a real design weakness counts as real).

Write ${out} as exactly one JSON array, one object per answer file, in the order above:
[{"file":"<path>","answers":[{"id":"q1","correct":1,"evidence":1,"note":"one short sentence"}, ...q1 to q6],
  "bug_found":0,"bug_rank":null,"bug_note":"one short sentence","defects_listed":0,"false_defects":0,
  "ease":<the reviewer's ease number>,"video_help":"<the reviewer's text or null>","confusing_scene":"<the reviewer's text or null>"}]
Write only that file.`);
} else {
  console.error('usage: node grader.mjs packet|review <fixture> <out.json> ...');
  process.exit(1);
}
