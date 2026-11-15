// What the player's guide panel and chapter labels show of a branch video's brief (docs/adr/0037-reviewer-brief.md):
// the six questions with their short answers and the first scene that tells each, the places to open first with the
// scene that shows each, and the questions for the author. Plain data, so the page only draws it and a test can check it.

import { QUESTIONS, decisionLead, decisionsOf } from './brief.mjs';
import { lineSpan } from './review.mjs';
import { plainText } from './markup.mjs';

const QUESTION_LABELS = {
  why: 'Why',
  case: 'One case',
  approach: 'The idea',
  parts: 'The parts',
  proof: 'Proof',
  check: 'Check first',
};
export const NOT_STATED = 'Not stated';

const object = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map(oneLine) : []);
const oneLine = (text) => plainText(String(text)).replace(/\s+/g, ' ').trim();
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const join = (items) => sentence(items.join('; '));

/** The labels of the questions a scene answers, in the order of the six; none for a scene that names none. */
export function sceneQuestions(scene) {
  const own = Array.isArray(scene?.answers) ? scene.answers : [];
  return QUESTIONS.filter((q) => own.includes(q)).map((q) => QUESTION_LABELS[q]);
}

/** The text of one question's answer, or null when the brief does not state it. */
function answerText(brief, question) {
  const a = brief[question];
  if (a === 'unknown') return null;
  if (question === 'why') return a?.source === 'unknown' || !a?.text ? null : oneLine(a.text);
  if (question === 'case')
    return object(a) ? `${sentence(oneLine(a.before ?? ''))} ${sentence(oneLine(a.after ?? ''))}` : null;
  if (question === 'approach') return object(a) && a.text ? oneLine(a.text) : null;
  if (question === 'parts') {
    if (!Array.isArray(a) || a.length === 0) return null;
    const names = (weight) => a.filter((p) => p?.weight === weight && p.name).map((p) => oneLine(p.name));
    const core = names('core');
    const rest = a.length - core.length;
    const first = `${a.length} part${a.length === 1 ? '' : 's'}`;
    return core.length ? `${first}. Main: ${core.join(', ')}.${rest ? ` ${rest} more.` : ''}` : `${first}.`;
  }
  if (question === 'proof') {
    if (!object(a)) return null;
    const tested = strings(a.tested);
    const untested = strings(a.untested);
    return `${tested.length ? `Tested: ${join(tested)}` : 'No test shows it.'}${untested.length ? ` Not tested: ${join(untested)}` : ''}`;
  }
  const checks = Array.isArray(a) ? a.length : 0;
  return checks ? `${checks} place${checks === 1 ? '' : 's'} to open first, under Open first.` : null;
}

/**
 * The index of the scene to seek to for `question`, or null: among the scenes that say they answer it, the one that
 * answers the fewest others, so "Proof" lands on the tests scene and not on a scene that touches it in passing; the
 * first of them on a tie.
 */
const firstAnswering = (scenes, question) => {
  let best = null;
  scenes.forEach((s, i) => {
    if (!Array.isArray(s?.answers) || !s.answers.includes(question)) return;
    if (best === null || s.answers.length < scenes[best].answers.length) best = i;
  });
  return best;
};

/** The first scene that shows a hunk of `file` whose lines meet `line`, else the first that shows one of the file, else null. */
function sceneShowing(scenes, hunks, file, line) {
  const span = lineSpan(line);
  const mine = Object.values(hunks ?? {}).filter((h) => h.file === file || h.oldFile === file);
  const covers = (h) => {
    const n = h.lines.map((l) => l.newLine ?? l.oldLine).filter((x) => x !== null);
    return span && n.length && span[0] <= Math.max(...n) && span[1] >= Math.min(...n);
  };
  const shows = (scene, hs) =>
    hs.some((h) => scene?.hunkId === h.id || (Array.isArray(scene?.from) && scene.from.includes(h.id)));
  for (const group of [mine.filter(covers), mine]) {
    const i = scenes.findIndex((s) => shows(s, group));
    if (i !== -1) return i;
  }
  return null;
}

/**
 * The guide of a storyboard with a `brief`, or null without one:
 * `{ questions: [{ id, label, answer, scene }], parts: [{ name, weight, does }], check: [{ where, what, why, scene }], decisions: [{ kind, lead, text }], ask }`. `answer` is null where the
 * brief does not state it (the page says "Not stated"); `scene` is the index to seek to, or null.
 */
export function guidePanel(storyboard, hunks) {
  const brief = object(storyboard?.brief);
  if (!brief) return null;
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  const checks = Array.isArray(brief.check) ? brief.check.filter((c) => object(c) && typeof c.file === 'string') : [];
  return {
    questions: QUESTIONS.map((id) => ({
      id,
      label: QUESTION_LABELS[id],
      answer: answerText(brief, id),
      scene: firstAnswering(scenes, id),
    })),
    parts: (Array.isArray(brief.parts) ? brief.parts : []).flatMap((p) =>
      object(p) && typeof p.name === 'string' && typeof p.does === 'string' && p.does.trim()
        ? [{ name: oneLine(p.name), weight: String(p.weight), does: oneLine(p.does) }]
        : [],
    ),
    check: checks.map((c) => ({
      where: `${c.file}:${c.line}`,
      what: oneLine(c.what ?? ''),
      why: oneLine(c.why ?? ''),
      scene: sceneShowing(scenes, hunks, c.file, c.line),
    })),
    decisions: decisionsOf(object(brief.approach)).map((d) => ({
      kind: d.kind,
      lead: decisionLead(d),
      text: oneLine(d.text),
    })),
    ask: strings(brief.ask),
  };
}
