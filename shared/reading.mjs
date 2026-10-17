// The reading order of a pre-read (`--audience preread`): the hunks a reviewer reads after the video, in order,
// each with what to check there. The storyboard's `reading` scene holds it; the scene, the player's Reading
// order panel, reading.md and `mr-cast outline` all draw it from here, so they never disagree.

import { parseMarkup, plainText } from './markup.mjs';
import { sceneChapter } from './chapters.mjs';
import { lineSpan } from './review.mjs';

/** Items the closing scene lists under "Read first"; the rest of the order is in reading.md. */
export const READ_FIRST_MAX = 6;
/** A check is one line a reviewer reads beside the file name. */
export const CHECK_MAX = 80;
/** The first line of reading.md, by which mr-cast knows a reading.md is its own. */
export const READING_HEADING = '# Reading order: ';
/** Words a review finding's severity is shown with on its reading item. */
export const FLAG_WORDS = { bug: 'likely bug', risk: 'risk', nit: 'nit' };

const oneLine = (text) => plainText(String(text)).replace(/\s+/g, ' ').trim();
/** One line of Markdown: the markup's `code` stays code, and the rest is plain text. */
const mdLine = (text) => parseMarkup(String(text)).runs.map((r) => (r.code ? `\`${r.text}\`` : r.text)).join('').replace(/\s+/g, ' ').trim();
// A file name from git may hold control characters, which would garble the terminal and reading.md.
const C0 = /[\u0000-\u001f\u007f]/g;

/** The scene that holds the reading order, or undefined. */
export const readingScene = (storyboard) => storyboard?.scenes?.find((s) => s?.type === 'reading');

/**
 * The side and lines of the file a hunk covers: new-file lines unless it only removes, as `{ file, side, range }`;
 * `range` is null for a hunk with no numbered lines.
 */
export function hunkSpan(hunk) {
  const side = hunk.lines.some((l) => l.newLine !== null) ? 'newLine' : 'oldLine';
  const numbers = hunk.lines.map((l) => l[side]).filter((n) => n !== null);
  const file = (side === 'oldLine' ? hunk.oldFile ?? hunk.file : hunk.file).replace(C0, '');
  return { file, side, range: numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null };
}

const spanText = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);

/**
 * "src/limiter.ts:12-30": the lines of the file a hunk covers, or the lines a reading item's `lines` names when
 * they lie inside them (`validate` reports any that do not).
 */
export function hunkLocation(hunk, lines) {
  const { file, side, range } = hunkSpan(hunk);
  if (!range) return file;
  const own = lineSpan(lines);
  const shown = own && own[0] >= range[0] && own[1] <= range[1] ? own : range;
  return `${file}:${spanText(shown)}${side === 'oldLine' ? ' (removed)' : ''}`;
}

/**
 * The scene that explains `hunkId`: of the scenes that cite it in `from`, the one that cites the fewest hunks, so a
 * diagram about the hunk wins over an overview of many. The earlier wins a tie.
 */
function explainer(storyboard, hunkId) {
  let best = null;
  storyboard.scenes.forEach((scene, index) => {
    if (!Array.isArray(scene?.from) || !scene.from.includes(hunkId)) return;
    if (!best || scene.from.length < best.scene.from.length) best = { scene, index };
  });
  return best;
}

/**
 * `items` grouped by the topic of the scene that explains each, as `{ title, items }`: each topic once, in the
 * order the items first reach it, with its items in their order. Grouping needs only the scenes' topic ids, so the
 * scene, which has no plan, numbers the items as reading.md does. `title` is the plan's title for the topic,
 * "Other changes" for items with none, and null for every group when no item has a title.
 */
function byTopic(items) {
  const titled = items.some((i) => i.topic !== null);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.topicId)) groups.set(item.topicId, { title: titled ? item.topic ?? 'Other changes' : null, items: [] });
    groups.get(item.topicId).items.push(item);
  }
  return [...groups.values()];
}

/**
 * The reading order, resolved against hunks.json: each item's place, number (routine items have none), the
 * chapter that explains it, the plan topic of that chapter and the finding it carries. `groups` are the items to
 * read by topic, each topic once, and `readFirst` is them in that order, numbered 1, 2, 3; `skim` holds the
 * routine items not riding on an item of their file, one entry per topic. `plan` (plan.json) titles the topics;
 * without one there are no topic headings. Items whose hunk is unknown are left out; `validate` reports them.
 */
export function readingOrder(storyboard, hunks, plan = null) {
  const scene = readingScene(storyboard);
  if (!scene || !Array.isArray(scene.items)) return null;
  const findings = new Map((Array.isArray(storyboard.findings) ? storyboard.findings : []).map((f) => [f?.id, f]));
  const titles = new Map((plan?.topics ?? []).map((t) => [t.id, t.title]));
  const items = scene.items.filter((item) => item && Object.hasOwn(hunks, item.hunkId)).map((item) => {
    const by = explainer(storyboard, item.hunkId);
    const topicId = typeof by?.scene.topic === 'string' ? by.scene.topic : null;
    return {
      hunkId: item.hunkId,
      where: hunkLocation(hunks[item.hunkId], item.lines),
      also: [],
      check: typeof item.check === 'string' ? item.check : '',
      routine: item.routine === true,
      number: null,
      finding: typeof item.flag === 'string' ? findings.get(item.flag) ?? null : null,
      explainedIn: by ? { chapter: sceneChapter(by.scene), scene: by.index } : null,
      topicId,
      topic: titles.get(topicId) ?? null,
    };
  });
  const groups = byTopic(items.filter((i) => !i.routine));
  const readFirst = groups.flatMap((g) => g.items);
  readFirst.forEach((item, i) => { item.number = i + 1; });
  // A routine hunk of a file the reader already reads rides on that file's item, so no file is on both lists.
  const skimmed = [];
  for (const item of items.filter((i) => i.routine)) {
    const file = hunkSpan(hunks[item.hunkId]).file;
    const host = readFirst.find((r) => hunkSpan(hunks[r.hunkId]).file === file);
    if (host) host.also.push(...[item.where.slice(file.length + 1)].filter(Boolean));
    else skimmed.push(item);
  }
  return { items, readFirst, groups, skim: byTopic(skimmed) };
}

/** ", also 1-6": the routine lines of the item's file that ride on it, or nothing. */
export const alsoText = (item) => (item.also.length ? `, also ${item.also.join(', ')}` : '');

/** "Claude: likely bug, the count is per server". */
export const flagText = (finding, line = oneLine) => `Claude: ${FLAG_WORDS[finding.severity] ?? finding.severity}, ${line(finding.claim)}`;

/** One item as a terminal line: its number, place and check, and the finding it carries. */
function itemLine(item) {
  const flag = item.finding ? ` (${flagText(item.finding)})` : '';
  return `${item.number}. ${item.where}${alsoText(item)}  ${oneLine(item.check)}${flag}`;
}

/** "`src/a.ts:3-4`", or "`src/a.ts:3-4` (removed)": the place as Markdown code. */
const mdWhere = (where) => where.replace(/^(.*?)( \(removed\))?$/, '`$1`$2');

/** One item as a Markdown checklist entry. */
function itemMarkdown(item) {
  const flag = item.finding ? ` (${flagText(item.finding, mdLine)})` : '';
  return `- [ ] ${item.number}. ${mdWhere(item.where)}${alsoText(item)}: ${mdLine(item.check)}${flag}`;
}

/** The reading order as a Markdown checklist: the items to read by topic, then one "skim" line per topic. */
export function readingChecklist(order) {
  const out = [];
  for (const group of order.groups) {
    if (group.title) out.push(`### ${oneLine(group.title)}`, '');
    for (const item of group.items) out.push(itemMarkdown(item));
    out.push('');
  }
  if (order.skim.length) {
    out.push('### Skim', '');
    for (const group of order.skim) out.push(`- [ ] ${group.title ? `${oneLine(group.title)}: ` : ''}${group.items.map((i) => mdWhere(i.where)).join(', ')}`);
  }
  return out.join('\n').trimEnd();
}

/** reading.md: the reading order to follow in the editor after the video, and to paste into the merge request. */
export function readingMarkdown(storyboard, order, { branch, base } = {}) {
  const against = branch && base ? ` of \`${branch}\` against \`${base}\`` : '';
  return `${READING_HEADING}${oneLine(storyboard.title)}\n\nRead the change${against} in this order. Each item says what to check there.\n\n${readingChecklist(order)}\n`;
}

/** The reading order as terminal lines, `1. src/limiter.ts:12-30  check`, which Claude Code makes clickable. */
export function readingLines(order) {
  const lines = order.readFirst.map((item) => `  ${itemLine(item)}`);
  const routine = order.skim.flatMap((g) => g.items);
  if (routine.length) lines.push(`  skim: ${routine.map((i) => i.where).join(', ')}`);
  return lines;
}
