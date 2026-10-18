// Prints a reviewer prompt.
//   node prompt.mjs packet <packet-dir> <fixture>          phase A: answer the key questions from the walkthrough alone
//   node prompt.mjs review <run-dir> <fixture> <branch>    phase B: walkthrough in <run-dir>/packet (if present), then the checkout in <run-dir>/repo
//   node prompt.mjs budget <run-dir> <fixture> <branch>    phase C: as review, with a budget of one diff --stat and two file reads
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [phase, dir, fixture, branch] = process.argv.slice(2);
const keys = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'keys', `${fixture}.json`);
const questions = JSON.parse(fs.readFileSync(keys, 'utf8')).questions;
const list = (qs) => qs.map((q) => `${q.id}. ${q.question}`).join('\n');

if (phase === 'packet') {
  const reading = fs.existsSync(path.join(dir, 'reading.md'));
  console.log(`You are reviewing a merge request you have not seen. Your only source is a walkthrough video of it,
given to you in ${dir} as scene stills (scene-01.png, scene-02.png, ...) and packet.md, which lists each
scene's chapter, type and narration${reading ? ', plus reading.md, the reading order the video hands to the reviewer' : ''}. Read packet.md${reading ? ' and reading.md' : ''} and look at every still. Do not open, list or
search any other file or directory, and do not look for the repository.

Answer these questions in your own words, from the video alone. Be concise. If the video does not
cover something a question asks, write "not shown" for that part instead of guessing.

${list(questions)}

Then give:
- ease: a whole number from 1 (hard to follow, I had to work for it) to 5 (easy, I understood it on one pass).
- confusing_scene: the scene number that was most confusing or overloaded, and why in one sentence.

Format the reply as "q1: ...", "q2: ...", then "ease: N" and "confusing_scene: ...".`);
} else if (phase === 'review' || phase === 'budget') {
  const packet = path.join(dir, 'packet');
  const hasPacket = fs.existsSync(path.join(packet, 'packet.md'));
  const reading = fs.existsSync(path.join(packet, 'reading.md'));
  const video = hasPacket
    ? `\n\nBefore you open the code, watch the walkthrough video the author made for this merge request. It is in ${packet} as scene stills (scene-01.png, scene-02.png, ...) and packet.md, which lists each scene's chapter, type and narration${reading ? ', plus reading.md, the reading order the video hands to the reviewer' : ''}. Look at it first, then use it however it helps you.`
    : '';
  const after = hasPacket
    ? `- ease: a whole number from 1 (hard, I had to work for it) to 5 (easy) for the whole review.
- video_help: what in the walkthrough saved you the most work, or "nothing", in one sentence.
- confusing_scene: the scene that was most confusing, misleading or wrong once you read the code, and why, in one sentence.`
    : '- ease: a whole number from 1 (hard, I had to work for it) to 5 (easy) for the whole review.';
  const budget =
    phase === 'budget'
      ? `\n\nYou have a strict reading budget for the code. You may run \`git diff --stat main...${branch}\` once, and read at most 2 files of the repository, each with one Read call. Do not run any other git command, and do not use grep, cat, sed or any other way to see file contents. Anything you cannot check within the budget, answer from what you have and mark it "unchecked".`
      : '';
  console.log(`You are reviewing a merge request: the branch ${branch} against main, in the git checkout at ${path.join(dir, 'repo')}.${video} Work only inside ${dir}. You cannot run the code or install packages.${budget}

Do two things.

1. Answer these questions. Give a file:line for each fact you take from the code.

${list(questions.filter((q) => q.id !== 'q7'))}

2. Review the change for defects: list each problem that would misbehave in production, with file:line, what goes wrong, and how sure you are (high, medium or low). At most 5, the most serious first.

Stop when you are confident in your answers; you do not have to read everything.

Then give:
${after}

Format the reply as "q1: ...", ..., "q6: ...", then "defects:" with one numbered line per defect, then ${hasPacket ? '"ease: N", "video_help: ..." and "confusing_scene: ..."' : '"ease: N"'}.`);
} else {
  console.error('usage: node prompt.mjs packet <packet-dir> <fixture> | review <run-dir> <fixture> <branch>');
  process.exit(1);
}
