// Facts about the whole storyboard that a writer cannot see without rendering, or where two parts of it disagree
// (docs/adr/0019-tools-not-opinions.md, docs/adr/0038-facts-about-the-mix.md): how the scene types are spread, a
// payload that reads as a sentence, a diagram that repeats an earlier one, a before and after that is only
// spoken, and tests that no scene names. Each is a warning that states the fact and what to look at; none says
// which scene to use.

import { shownHunkIds } from '../../shared/shown-hunks.mjs';
import { isTestFile } from '../../shared/test-files.mjs';
import { plainText } from '../../shared/markup.mjs';
import { runsOf } from '../../shared/brief.mjs';

/** A run of this many scenes of one type in a row is reported. */
const RUN_MIN = 4;
/** A flow payload of at least this many words, with none of PAYLOAD_CODE, reads as a sentence. */
const SENTENCE_WORDS = 6;
const PAYLOAD_CODE = /[\d"'`‘’“”[\]{}()=:]/;
/** A later diagram repeats an earlier one when this share of its labels is in the earlier one. */
const REPEAT_SHARE = 0.7;
/** Fewer labels than this say too little to call a repeat. */
const REPEAT_LABELS_MIN = 3;
const LIST_MAX = 6;
const DIAGRAMS = ['flow', 'graph', 'sequence', 'state', 'layers', 'mermaid'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const named = (items) =>
  items.length > LIST_MAX
    ? `${items.slice(0, LIST_MAX).join(', ')} and ${items.length - LIST_MAX} more`
    : items.join(', ');
const fold = (text) => plainText(text).replace(/\s+/g, ' ').trim().toLowerCase();

function checkRuns(scenes, warnings) {
  for (const r of runsOf(scenes))
    if (r.length >= RUN_MIN)
      warnings.push(
        `scenes[${r.from}] to scenes[${r.from + r.length - 1}]: ${r.length} ${r.type} scenes in a row; the viewer sees ${r.length} of the same kind without a change of view`,
      );
}

function checkPayloads(scenes, warnings) {
  scenes.forEach((s, i) => {
    if (!isObj(s) || s.type !== 'flow') return;
    list(s.steps).forEach((st, j) => {
      const payload = st?.payload;
      if (typeof payload !== 'string') return;
      const words = payload.split(/\s+/).filter(Boolean).length;
      if (words >= SENTENCE_WORDS && !PAYLOAD_CODE.test(payload))
        warnings.push(
          `scenes[${i}].steps[${j}].payload: ${JSON.stringify(payload.length > 50 ? `${payload.slice(0, 50)}…` : payload)} is ${words} words with no digit, quote, bracket, equals sign or colon, so it reads as a sentence; payload is drawn as one line of code`,
        );
    });
  });
}

const MERMAID_LABELS = [/\[+([^\]\n]+)\]+/g, /\(+([^()\n]+)\)+/g, /\{+([^}\n]+)\}+/g, /\|([^|\n]+)\|/g];

/** The labels a diagram scene draws, case-folded and without repeats. */
function labelsOf(s) {
  const out = [];
  const add = (v) => typeof v === 'string' && out.push(v);
  switch (s.type) {
    case 'flow':
      for (const st of list(s.steps)) {
        add(st?.actor);
        add(st?.action);
      }
      break;
    case 'graph':
      for (const n of list(s.nodes)) add(n?.label);
      for (const e of list(s.edges)) add(e?.label);
      break;
    case 'sequence':
      for (const n of list(s.participants)) add(n?.label);
      for (const m of list(s.messages)) add(m?.label);
      break;
    case 'state':
      for (const n of list(s.states)) add(n?.label);
      for (const t of list(s.transitions)) add(t?.label);
      break;
    case 'layers':
      for (const l of list(s.layers)) {
        add(l?.label);
        for (const it of list(l?.items)) add(it?.label);
      }
      break;
    case 'mermaid': {
      const code = typeof s.code === 'string' ? s.code : '';
      for (const re of MERMAID_LABELS) for (const m of code.matchAll(re)) add(m[1]);
      for (const m of code.matchAll(/^\s*(?:participant|actor)\s+\S+\s+as\s+(.+)$/gm)) add(m[1]);
      for (const m of code.matchAll(/^\s*\S+\s*-{1,2}>>?\s*\S+\s*:\s*(.+)$/gm)) add(m[1]);
      break;
    }
  }
  return [...new Set(out.map(fold).filter(Boolean))];
}

function checkRepeats(scenes, warnings) {
  const seen = [];
  scenes.forEach((s, i) => {
    if (!isObj(s) || !DIAGRAMS.includes(s.type)) return;
    const labels = labelsOf(s);
    let best = null;
    if (labels.length >= REPEAT_LABELS_MIN)
      for (const earlier of seen) {
        const shared = labels.filter((l) => earlier.labels.includes(l));
        if (shared.length / labels.length >= REPEAT_SHARE && (!best || shared.length > best.shared.length))
          best = { earlier, shared };
      }
    if (best)
      warnings.push(
        `scenes[${i}] (${s.type}) repeats scenes[${best.earlier.at}] (${scenes[best.earlier.at].type}): ${best.shared.length} of its ${labels.length} labels are in the earlier diagram (${named(best.shared.map((l) => JSON.stringify(l)))}); the viewer sees the same diagram again`,
      );
    seen.push({ at: i, labels });
  });
}

const hasText = (v) => isStr(v) || isObj(v);

/**
 * Whether `s`, a scene that answers "case", has the before and the after on screen. This is the test chosen:
 * a compare scene with a row whose two cells both hold something and differ; a code scene on a hunk with removed
 * and added lines (and, when the case cites hunks, on one of those) that does not type, since typing hides removed
 * lines; a table with a `{ before, after }` cell or a modified row; a tests scene with a test that says what a cell
 * `was`; a terminal with two entries that print output, such as a run before and a run after.
 */
function showsBoth(s, hunks, cited) {
  switch (s.type) {
    case 'compare':
      return list(s.rows).some(
        (r) =>
          Array.isArray(r?.cells) &&
          r.cells.length === 2 &&
          r.cells.every((c) => (typeof c === 'string' ? isStr(c) : hasText(c))) &&
          JSON.stringify(r.cells[0]) !== JSON.stringify(r.cells[1]),
      );
    case 'code': {
      const lines = list(hunks?.[s.hunkId]?.lines);
      const ids = cited.filter((id) => Object.hasOwn(hunks, id));
      return (
        s.typing !== true &&
        (ids.length === 0 || ids.includes(s.hunkId)) &&
        lines.some((l) => l?.type === 'del') &&
        lines.some((l) => l?.type === 'add')
      );
    }
    case 'table':
      return list(s.rows).some(
        (r) => r?.change === 'modified' || list(r?.cells).some((c) => isObj(c) && 'before' in c && 'after' in c),
      );
    case 'tests':
      return list(s.tests).some((t) => isStr(t?.was));
    case 'terminal':
      return list(s.entries).filter((e) => isStr(e?.output)).length >= 2;
    default:
      return false;
  }
}

function checkCase(scenes, hunks, brief, warnings) {
  const c = brief?.case;
  if (!isObj(c) || !isStr(c.before) || !isStr(c.after)) return;
  const telling = scenes.filter((s) => isObj(s) && list(s.answers).includes('case'));
  // With no scene answering "case" the brief check already says so.
  if (!telling.length) return;
  const cited = list(c.cite).filter(isStr);
  if (!telling.some((s) => showsBoth(s, hunks, cited)))
    warnings.push(
      `case: a before and an after are written, but none of the ${plural(telling.length, 'scene')} marked for "case" (${telling.map((s) => s.type).join(', ')}) puts both on screen; the viewer hears the before and does not see it. A compare scene, a code scene on a cited hunk with removed and added lines, a table with before and after cells, a tests scene with "was" or a terminal with two runs puts both on screen`,
    );
}

/** The text a scene draws: every string in it except what is spoken or only labels the scene. */
function drawn(v, out = []) {
  if (typeof v === 'string') out.push(fold(v));
  else if (Array.isArray(v)) for (const x of v) drawn(x, out);
  else if (isObj(v))
    for (const [k, x] of Object.entries(v))
      if (!['narration', 'say', 'chapter', 'answers', 'hunkId', 'type'].includes(k)) drawn(x, out);
  return out;
}

/** The names of added tests in the map, and the ids of the hunks of its test files; the map's shape is read leniently. */
function mapTests(map) {
  const tests = list(map?.tests);
  const names = tests.flatMap((t) => list(t?.adds ?? t?.names)).filter(isStr);
  const files = map?.files;
  const entries = Array.isArray(files) ? files.filter((f) => f?.kind === 'tests') : list(files?.tests);
  const hunkIds = new Set(entries.flatMap((f) => list(f?.hunkIds ?? f?.hunks)));
  return { names, hunkIds };
}

function checkTestNames(scenes, hunks, map, warnings) {
  const { names, hunkIds } = mapTests(map);
  if (!names.length) return;
  const isTestHunk = (id) => typeof id === 'string' && (hunkIds.has(id) || isTestFile(hunks?.[id]?.file ?? ''));
  const shown = scenes.some(
    (s) => isObj(s) && (shownHunkIds(s).some(isTestHunk) || list(s.items).some((it) => isTestHunk(it?.hunkId))),
  );
  if (shown) return;
  const text = scenes.filter(isObj).flatMap((s) => drawn(s));
  const named_ = names.filter((n) => text.some((t) => t.includes(fold(n))));
  if (!named_.length)
    warnings.push(
      `tests: this branch adds ${plural(names.length, 'named test')} (${named(names.map((n) => JSON.stringify(n)))}), and no scene draws the name of any of them or shows a test hunk; the viewer hears of the tests but sees none`,
    );
}

/**
 * Checks the storyboard's mix. `branch` is a video of a branch with a diff; `map` is map.json or null. The flow
 * payload and the repeated diagram are checked in every video, the rest in a branch video only.
 */
export function checkMix(sb, hunks, { branch, map = null }, warnings) {
  const scenes = list(sb?.scenes);
  checkPayloads(scenes, warnings);
  checkRepeats(scenes, warnings);
  if (!branch) return;
  checkRuns(scenes, warnings);
  checkCase(scenes, hunks, sb.brief, warnings);
  checkTestNames(scenes, hunks, map, warnings);
}
