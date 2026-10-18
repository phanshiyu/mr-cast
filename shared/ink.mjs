// The ink board: what each step's `draw` writes and draws, what it points at, and the step that erases it. Shared by
// the scenes, which place and draw the items, and `validate`, which reports the walk's problems.

import { stepLines, stepRange } from './focus.mjs';
import { NOTE_MAX } from './pen-marks.mjs';
import { indexRange, sceneSteps } from './steps.mjs';
import { FOCUS_TYPES, refNames, resolveRef } from './targets.mjs';
import { cueWord, spokenTexts } from './timing.mjs';

const INK_SHAPES = ['circle', 'box', 'underline', 'strike', 'cross', 'tick'];
const INK_VERBS = [...INK_SHAPES, 'brace', 'arrow', 'write'];
const INK_SIDES = ['above', 'below', 'left', 'right'];
const INK_TONES = ['neutral', 'accent', 'good', 'bad', 'warn'];
const OPTIONS = ['note', 'when', 'tone', 'side', 'id', 'near', 'at'];
/** Scene types whose steps take `draw`: every scene with focus refs, and code. */
export const INK_TYPES = [...FOCUS_TYPES, 'code'];

const list = (v) => (Array.isArray(v) ? v : []);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isFraction = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isPoint = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');

/** The verbs an item names; a well-formed item names exactly one. */
const inkVerbs = (item) => INK_VERBS.filter((verb) => item?.[verb] !== undefined);

/**
 * Item keys a code step's ink ref names: a line number or an "a-b" range on the step's side ("ln:<hunk line>"), or text
 * that occurs once on the step's lines ("tx:<hunk line>:<offset>:<length>"). Null when it names nothing; the count of
 * places when the text occurs more than once.
 */
function codeKeys(hunk, step, ref) {
  if (!hunk) return null;
  const lines = typeof ref === 'string' && /^\s*\d+\s*$/.test(ref) ? null : indexRange(ref);
  if (lines) {
    const { side } = stepRange(step);
    const hits = hunk.lines.flatMap((line, i) =>
      line[side] !== null && line[side] >= lines[0] && line[side] <= lines[1] ? [`ln:${i}`] : [],
    );
    return hits.length ? hits : null;
  }
  if (!isText(ref)) return null;
  const hits = stepLines(hunk, step).flatMap((line) => {
    const text = hunk.lines[line].text;
    const at = [];
    for (let i = text.indexOf(ref); i >= 0; i = text.indexOf(ref, i + 1)) at.push(`tx:${line}:${i}:${ref.length}`);
    return at;
  });
  return hits.length === 1 ? hits : hits.length ? hits.length : null;
}

/**
 * The item keys a ref names on a step, as ink and the camera resolve it: a scene's ref, or on a code step a line, a
 * range or text on its lines. Null when it names nothing; on code, the count of places when the text occurs more than once.
 */
export const stepRefKeys = (scene, hunks, step, ref) =>
  scene?.type === 'code' ? codeKeys(hunks?.[scene.hunkId], step, ref) : resolveRef(scene, ref, hunks);

/**
 * Walks the scene's steps in order and returns every item drawn, with what each points at and the step that erases it
 * (`until`, Infinity while it stays), and the problems found on the way. A target is `{ keys }` (scene item keys),
 * `{ ink: id }` (an item already on the board) or `{ point: [x, y] }` (a fraction of the stage).
 */
export function inkBoard(scene, hunks = {}) {
  const steps = sceneSteps(scene);
  const items = [];
  const problems = [];
  if (!steps.some((step) => step?.draw !== undefined || step?.erase !== undefined)) return { items, problems };
  const problem = (step, index, field, message, suggest) =>
    problems.push({ step, index, field, message, ...(suggest ? { suggest } : {}) });
  if (!INK_TYPES.includes(scene.type)) {
    steps.forEach((step, k) => {
      if (step?.draw !== undefined)
        problem(k, null, 'draw', `${scene.type} steps take no draw; ink goes on the steps of ${INK_TYPES.join(', ')}`);
    });
    return { items, problems };
  }
  const code = scene.type === 'code';
  const said = spokenTexts(scene);
  const live = () => items.filter((it) => it.until === Infinity);
  const allIds = new Set(
    steps.flatMap((step) => list(step?.draw).flatMap((item) => (isText(item?.id) ? [item.id] : []))),
  );
  const names = code ? [] : refNames(scene, hunks);
  const sceneKeys = (step, ref) => stepRefKeys(scene, hunks, step, ref);

  steps.forEach((step, k) => {
    if (!step || typeof step !== 'object') return;
    if (step.erase === true) for (const it of live()) it.until = k;
    else if (Array.isArray(step.erase)) {
      step.erase.forEach((id, j) => {
        const hits = live().filter((it) => it.id === id);
        if (!hits.length)
          problem(
            k,
            null,
            `erase[${j}]`,
            allIds.has(id)
              ? `${JSON.stringify(id)} is not on the board at this step; it is drawn later or already erased`
              : `no item has the id ${JSON.stringify(id)}; give the item to erase an "id"`,
            allIds.has(id) ? undefined : { name: String(id), names: [...allIds] },
          );
        for (const it of hits) it.until = k;
      });
    } else if (step.erase !== undefined)
      problem(k, null, 'erase', 'must be true, to erase everything drawn so far, or a list of item ids');
    if (step.draw === undefined) return;
    if (!Array.isArray(step.draw))
      return problem(k, null, 'draw', 'must be a list of items, such as [{ "circle": "A", "note": "start" }]');

    step.draw.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return problem(k, i, '', 'must be an object with one verb, such as { "circle": "A" }');
      const bad = (field, message, suggest) => problem(k, i, field, message, suggest);
      for (const key of Object.keys(item))
        if (!INK_VERBS.includes(key) && !OPTIONS.includes(key))
          bad(key, `is not an ink field; an item takes one of ${INK_VERBS.join(', ')}, and ${OPTIONS.join(', ')}`, {
            name: key,
            names: [...INK_VERBS, ...OPTIONS],
          });
      const verbs = inkVerbs(item);
      if (verbs.length !== 1)
        return bad(
          '',
          verbs.length
            ? `names ${verbs.join(' and ')}; an item draws one thing, so split it into ${verbs.length} items`
            : `names nothing to draw; give it one of ${INK_VERBS.join(', ')}`,
        );
      const [verb] = verbs;

      const target = (ref, field, points) => {
        if (points && isPoint(ref)) {
          if (ref.every(isFraction)) return { point: ref };
          bad(field, 'a point is [x, y], each a fraction of the stage from 0 to 1');
          return null;
        }
        if (typeof ref === 'string' && live().some((it) => it.id === ref)) return { ink: ref };
        if (typeof ref !== 'string' && typeof ref !== 'number') {
          bad(field, `must be a ref${points ? ', an item id or an [x, y] point' : ' or an item id'}`);
          return null;
        }
        const keys = sceneKeys(step, ref);
        if (Array.isArray(keys)) return { keys };
        if (typeof keys === 'number')
          bad(
            field,
            `${JSON.stringify(ref)} occurs ${keys} times on the step's lines; lengthen it until it names one place`,
          );
        else if (typeof ref === 'string' && allIds.has(ref))
          bad(
            field,
            `${JSON.stringify(ref)} is an item id that is not on the board at this step; draw it in an earlier item or step`,
          );
        else if (code)
          bad(
            field,
            `${JSON.stringify(ref)} is not on the step's lines; name a line number, an "a-b" range, or text copied exactly from the code`,
          );
        else
          bad(field, `${JSON.stringify(ref)} names nothing in this ${scene.type}`, {
            name: String(ref),
            names: [...names, ...live().flatMap((it) => (it.id ? [it.id] : []))],
          });
        return null;
      };

      let targets;
      if (verb === 'arrow') {
        if (!Array.isArray(item.arrow) || item.arrow.length !== 2)
          return bad('arrow', 'must be [from, to], each a ref, an item id or an [x, y] point');
        targets = item.arrow.map((ref, j) => target(ref, `arrow[${j}]`, true));
      } else if (verb === 'write') {
        if (!isText(item.write)) bad('write', 'must be the text to write');
        else if (item.write.split('\n').some((line) => line.trim().length > NOTE_MAX))
          bad('write', `a line is over ${NOTE_MAX} characters; break it with "\\n"`);
        if ((item.near === undefined) === (item.at === undefined))
          return bad(
            'write',
            'needs "near", a ref or item id to write beside, or "at", an [x, y] point on the stage; give one',
          );
        if (item.at !== undefined && !(isPoint(item.at) && item.at.every(isFraction)))
          bad('at', 'must be [x, y], each a fraction of the stage from 0 to 1');
        targets = item.near === undefined ? [] : [target(item.near, 'near', false)];
      } else {
        const refs = Array.isArray(item[verb]) ? item[verb] : [item[verb]];
        if (!refs.length) return bad(verb, 'names nothing; give a ref, an item id or a list of them');
        targets = refs.map((ref, j) => target(ref, Array.isArray(item[verb]) ? `${verb}[${j}]` : verb, false));
      }
      if (verb !== 'write' && (item.near !== undefined || item.at !== undefined))
        bad(item.near !== undefined ? 'near' : 'at', `only "write" takes it; a ${verb} goes on what it names`);
      if (item.note !== undefined) {
        if (verb === 'write') bad('note', 'a write is its own text; drop "note" or make it a second item');
        else if (!isText(item.note)) bad('note', 'must be a non-empty string');
        else if (item.note.trim().length > NOTE_MAX)
          bad(
            'note',
            `${item.note.trim().length} characters; a note is written on one line, so keep it to ${NOTE_MAX}`,
          );
      }
      if (item.side !== undefined && !INK_SIDES.includes(item.side))
        bad('side', `must be one of ${INK_SIDES.join(', ')}`);
      if (item.tone !== undefined && !INK_TONES.includes(item.tone))
        bad('tone', `must be one of ${INK_TONES.join(', ')}`);
      if (item.when !== undefined) {
        if (!isText(item.when)) bad('when', "must be words from the step's say");
        else if (cueWord(said[k + 1], item.when) < 0)
          bad('when', `${JSON.stringify(item.when)} is not in the step's say; copy the words the item should start on`);
      }
      if (item.id !== undefined) {
        if (!isText(item.id)) bad('id', 'must be a non-empty string');
        else if (live().some((it) => it.id === item.id))
          bad('id', `${JSON.stringify(item.id)} is already on the board; erase it first or pick another id`);
        else if (sceneKeys(step, item.id) !== null)
          bad('id', `${JSON.stringify(item.id)} is also a ref in this scene; pick an id that names nothing else`);
      }
      if (targets.some((t) => t === null)) return;
      items.push({
        step: k,
        index: i,
        item,
        verb,
        targets,
        until: Infinity,
        ...(isText(item.id) ? { id: item.id } : {}),
      });
    });
  });
  return { items, problems };
}
