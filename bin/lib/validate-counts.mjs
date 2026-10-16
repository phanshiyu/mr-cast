// Counts the voice says that the screen contradicts: "seven tests" over a list of nine cases, or "three things to
// check" over two bullets. Only a count right before the noun is read, so "the second of four tests" is never
// guessed at. Of the plain counts in one text only the largest is taken as the total, so "Nine tests cover it; one
// test checks the reset" is read as nine, and a bare "one" is never checked; "one new test" is. Each warning names both numbers.

import { plainText } from '../../shared/markup.mjs';
import { indexRange, sceneSteps } from '../../shared/steps.mjs';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const NUMBER = `(\\d+|${NUMBER_WORDS.join('|')})`;
const countOf = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word.toLowerCase()));

/** "Seven tests", "two new tests", "one existing test", "nine cases": the count, and which cases it means. */
const TESTS_COUNT = new RegExp(`\\b${NUMBER}\\s+(?:(new|added|existing|changed|removed)\\s+)?(?:tests?|test cases?|cases?)\\b`, 'gi');
/** "three things to check", "two risks": the intent scene's bullets. */
const BULLETS_COUNT = new RegExp(`\\b${NUMBER}\\s+(?:(?:main|key|big)\\s+)?(?:things|points|risks|questions|issues)\\b`, 'gi');

const QUALIFIED = { new: 'added', added: 'added', existing: 'existing', changed: 'changed', removed: 'removed' };

/** The counts in `text` to check: each qualified one ("two new tests"), and the largest plain one, but never a bare one. */
function counts(text, pattern) {
  const found = [...plainText(text).matchAll(pattern)]
    .map((m) => ({ phrase: m[0], said: countOf(m[1]), qualifier: m[2]?.toLowerCase() }))
    .filter((c) => c.qualifier || c.said !== 1);
  const plain = found.filter((c) => !c.qualifier);
  const total = plain.reduce((max, c) => (max && max.said >= c.said ? max : c), null);
  return found.filter((c) => c.qualifier || c === total);
}

const isStep = (step) => step !== null && typeof step === 'object';

/** The item indexes a step lights, from its numeric refs and "a-b" ranges. */
const focusedItems = (step) =>
  (Array.isArray(step.focus) ? step.focus : [step.focus]).flatMap((ref) => {
    const range = indexRange(ref);
    return range ? Array.from({ length: range[1] - range[0] + 1 }, (_, k) => range[0] + k) : [];
  });

/**
 * The counts a list of cases allows: with a qualifier, the cases of that status; without, all of them, or all but
 * the removed ones, since a removed test no longer covers anything.
 */
function allowed(list, qualifier) {
  const statusOf = (c) => c?.status ?? 'added';
  if (qualifier) {
    const n = list.filter((c) => statusOf(c) === QUALIFIED[qualifier]).length;
    return { counts: [n], shown: `${n} ${QUALIFIED[qualifier]}` };
  }
  const kept = list.filter((c) => statusOf(c) !== 'removed').length;
  return { counts: [list.length, kept], shown: kept === list.length ? `${list.length}` : `${kept}, and ${list.length - kept} removed` };
}

function checkTests(scene, p, warnings) {
  const cases = scene.cases;
  for (const { phrase, said, qualifier } of counts(scene.narration ?? '', TESTS_COUNT)) {
    const { counts: ok, shown } = allowed(cases, qualifier);
    if (!ok.includes(said)) warnings.push(`${p}.narration: says "${phrase}", but the scene lists ${shown}; say the number on screen`);
  }
  sceneSteps(scene).forEach((step, j) => {
    if (!isStep(step)) return;
    const lit = focusedItems(step).filter((k) => k < cases.length).map((k) => cases[k]);
    if (!lit.length) return;
    for (const { phrase, said, qualifier } of counts(step.say ?? '', TESTS_COUNT)) {
      const { counts: ok, shown } = allowed(lit, qualifier);
      if (!ok.includes(said)) warnings.push(`${p}.steps[${j}].say: says "${phrase}", but the step lights ${shown}; say the number it lights`);
    }
  });
}

function checkIntent(scene, p, warnings) {
  const texts = [['narration', scene.narration ?? ''], ...sceneSteps(scene).map((step, j) => [`steps[${j}].say`, (isStep(step) && step.say) || ''])];
  for (const [where, text] of texts) {
    for (const { phrase, said } of counts(text, BULLETS_COUNT)) {
      if (said !== scene.bullets.length) warnings.push(`${p}.${where}: says "${phrase}", but the scene has ${scene.bullets.length} bullets; say the number on screen`);
    }
  }
}

/** Warns when the narration states a count of tests or of intent bullets that differs from what the scene shows. */
export function checkSpokenCounts(scenes, warnings) {
  scenes.forEach((scene, i) => {
    const p = `scenes[${i}]`;
    if (scene?.type === 'tests' && Array.isArray(scene.cases)) checkTests(scene, p, warnings);
    if (scene?.type === 'intent' && Array.isArray(scene.bullets) && scene.bullets.length) checkIntent(scene, p, warnings);
  });
}
