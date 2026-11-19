// Checks that make a video easier to follow (ADR 47), each a pattern the agent can see in the storyboard without
// rendering: a scene title says the scene's point; something on screen changes with each step, and no stretch of
// words holds the picture still for long; a longer video keeps one picture that comes back and ends on it; the tones
// a video uses mean what its `tones` says; and `illustrative` is a flag.

import { plainText } from '../../shared/markup.mjs';
import { STATE_TYPES } from '../../shared/state-steps.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import { tintEntries } from '../../shared/storyboard-json.mjs';

const MEANING_TONES = ['accent', 'good', 'bad', 'warn'];
/** A title under this many words is a topic ("The ripple"), not a point ("Each carry waits for the one before"). */
const TITLE_MIN_WORDS = 3;
/** Words spoken over one still picture: about eight seconds at the voice's pace, the longest the reference holds. */
const STILL_WORDS = 24;
/** A video this long or longer keeps one picture that comes back. */
const PICTURE_SCENES = 5;
/** Step fields that change nothing on screen by themselves. */
const QUIET = new Set(['say', 'focus', 'answers', 'flag']);
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const spoken = (text) => (typeof text === 'string' ? words(plainText(text)) : 0);

/** Whether a step changes what is on screen: anything but its words, or a focus other than the step before's. */
function changes(step, before) {
  if (!isObj(step)) return true;
  if (Object.keys(step).some((k) => !QUIET.has(k))) return true;
  return step.focus !== undefined && JSON.stringify(step.focus) !== JSON.stringify(before?.focus);
}

/** The meaning tones a scene uses, each with where: tints, and tone, fill and stroke classes in an svg. */
function tonesUsed(scene) {
  const used = [];
  const tints = (record, at) => {
    if (record === undefined) return;
    try {
      for (const [, tone] of tintEntries(record)) if (MEANING_TONES.includes(tone)) used.push({ tone, at });
    } catch {
      // A malformed tint is reported by the scene's own checks.
    }
  };
  tints(scene.tint, 'tint');
  (Array.isArray(scene.steps) ? scene.steps : []).forEach((st, k) => tints(st?.tint, `steps[${k}].tint`));
  if (typeof scene.svg === 'string')
    for (const m of scene.svg.matchAll(/class="([^"]*)"/g))
      for (const c of m[1].split(/\s+/)) {
        const tone = /^(?:tone|fill|stroke)-(\w+)$/.exec(c)?.[1];
        if (MEANING_TONES.includes(tone)) used.push({ tone, at: `svg class "${c}"` });
      }
  return used;
}

/** Steps that change nothing on screen, and words that hold the picture still too long. */
function checkStill(s, p, warnings) {
  if (spoken(s.narration) > STILL_WORDS && sceneSteps(s).length)
    warnings.push(
      `${p}.narration: ${spoken(s.narration)} words over a picture that does not change; say the first sentence here and move the rest into steps that each change something`,
    );
  sceneSteps(s).forEach((step, k) => {
    const at = `${p}.steps[${k}]`;
    // Scenes whose steps change what they show; in the others (code, flow, sequence) lighting a part plays it.
    if (STATE_TYPES.includes(s.type) && !changes(step, sceneSteps(s)[k - 1]))
      warnings.push(
        `${at}: changes nothing on screen while it is said; show, tint, trace or write the thing it names (a draw item with "when"), or join it to the step before`,
      );
    const n = spoken(step?.say);
    if (n > STILL_WORDS)
      warnings.push(
        `${at}.say: ${n} words while the picture holds still, about ${Math.round((n / 170) * 60)} seconds; split it into steps of a sentence or two that each change something`,
      );
  });
}

/** A longer explanation keeps one picture and ends on it. */
function checkPictures(sb, explain, warnings) {
  const drawn = sb.scenes.map((s) => (isObj(s) && typeof s.picture === 'string' ? s.picture : null));
  const first = drawn.find(Boolean);
  if (!first) {
    if (explain && sb.scenes.length >= PICTURE_SCENES)
      warnings.push(
        `pictures: none; a video of ${sb.scenes.length} scenes is easier to follow around one picture that comes back, such as a row of bytes or a request's path; see references/pictures.md`,
      );
    return;
  }
  if (!drawn.slice(-2).includes(first))
    warnings.push(
      `pictures: the video starts on "${first}" but does not come back to it; end on it once more, showing what the fix or the answer changes`,
    );
}

export function checkStyle(sb, { explain }, errors, warnings) {
  const tones = sb.tones;
  let meant = null;
  if (tones !== undefined) {
    if (!isObj(tones) || !Object.entries(tones).every(([k, v]) => MEANING_TONES.includes(k) && typeof v === 'string'))
      errors.push(
        `tones: must say what each tone means, such as { "good": "bytes that fit", "bad": "bytes past the end" }; a tone is one of ${MEANING_TONES.join(', ')}`,
      );
    else meant = new Set(Object.keys(tones));
  }
  const unmeant = new Map();
  let firstTone = null;
  sb.scenes.forEach((s, i) => {
    if (!isObj(s)) return;
    const p = `scenes[${i}]`;
    if (s.illustrative !== undefined && typeof s.illustrative !== 'boolean')
      errors.push(`${p}.illustrative: must be true or false`);
    if (typeof s.title === 'string' && s.title.trim() && words(s.title) < TITLE_MIN_WORDS)
      warnings.push(
        `${p}.title: "${s.title.trim()}" names a topic; say the scene's point in a short sentence, such as "Each carry waits for the one before", so a viewer who drifts off can catch up from the title alone`,
      );
    checkStill(s, p, warnings);
    for (const { tone, at } of tonesUsed(s)) {
      if (meant && !meant.has(tone) && !unmeant.has(tone)) unmeant.set(tone, `${p} ${at}`);
      if (!meant && !firstTone) firstTone = `${p} ${at}`;
    }
  });
  checkPictures(sb, explain, warnings);
  if (firstTone)
    warnings.push(
      `tones: none, but ${firstTone} colours a part; say what each colour means, such as { "good": "bytes that fit", "bad": "bytes past the end" }, and use each only for that`,
    );
  for (const [tone, at] of unmeant)
    warnings.push(
      `tones: ${at} uses "${tone}", which tones does not give a meaning; use the tones for what they mean (${[...meant].map((t) => `${t}: ${tones[t]}`).join(', ')}), or add "${tone}" with its meaning`,
    );
}
