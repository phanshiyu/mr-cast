// The reading order of a pre-read (`--audience preread`): the hunks a reviewer reads after the video, in order,
// each with what to check there. The storyboard's `reading` scene holds it; the scene, the player's Reading
// order panel, reading.md and `mr-cast outline` all draw it from here, so they never disagree.

import { plainText } from './markup.mjs';
import { sceneChapter } from './chapters.mjs';

/** Items the closing scene lists under "Read first"; the rest of the order is in reading.md. */
export const READ_FIRST_MAX = 6;
/** A check is one line a reviewer reads beside the file name. */
export const CHECK_MAX = 80;
/** The first line of reading.md, by which mr-cast knows a reading.md is its own. */
export const READING_HEADING = '# Reading order: ';
/** Words a review finding's severity is shown with on its reading item. */
export const FLAG_WORDS = { bug: 'likely bug', risk: 'risk', nit: 'nit' };

const oneLine = (text) => plainText(String(text)).replace(/\s+/g, ' ').trim();

/** The scene that holds the reading order, or undefined. */
export const readingScene = (storyboard) => storyboard?.scenes?.find((s) => s?.type === 'reading');

/** "src/limiter.ts:12-30": the lines of the file a hunk covers, new-file lines unless it only removes. */
export function hunkLocation(hunk) {
  const side = hunk.lines.some((l) => l.newLine !== null) ? 'newLine' : 'oldLine';
  const numbers = hunk.lines.map((l) => l[side]).filter((n) => n !== null);
  if (!numbers.length) return hunk.file;
  const [a, b] = [Math.min(...numbers), Math.max(...numbers)];
  return `${side === 'oldLine' ? hunk.oldFile ?? hunk.file : hunk.file}:${a === b ? a : `${a}-${b}`}${side === 'oldLine' ? ' (removed)' : ''}`;
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
 * Runs of `items` in a row that share a topic, as `{ title, items }`; `title` is null when no item has a topic.
 * Runs keep the reading order, so a topic the order comes back to gets a second run.
 */
function runsByTopic(items) {
  const titled = items.some((i) => i.topic !== null);
  const runs = [];
  for (const item of items) {
    const title = titled ? item.topic ?? 'Other changes' : null;
    const last = runs.at(-1);
    if (last && last.title === title) last.items.push(item);
    else runs.push({ title, items: [item] });
  }
  return runs;
}

/**
 * The reading order, resolved against hunks.json: each item's place, number (routine items have none), the
 * chapter that explains it, the plan topic of that chapter and the finding it carries. `groups` are the items to
 * read in runs by topic; `skim` holds the routine items, one entry per topic. `plan` (plan.json) names the topics;
 * without one there are no topic headings. Items whose hunk is unknown are left out; `validate` reports them.
 */
export function readingOrder(storyboard, hunks, plan = null) {
  const scene = readingScene(storyboard);
  if (!scene || !Array.isArray(scene.items)) return null;
  const findings = new Map((Array.isArray(storyboard.findings) ? storyboard.findings : []).map((f) => [f?.id, f]));
  const topics = new Map((plan?.topics ?? []).map((t) => [t.id, t.title]));
  let n = 0;
  const items = scene.items.filter((item) => item && Object.hasOwn(hunks, item.hunkId)).map((item) => {
    const by = explainer(storyboard, item.hunkId);
    return {
      hunkId: item.hunkId,
      where: hunkLocation(hunks[item.hunkId]),
      check: typeof item.check === 'string' ? item.check : '',
      routine: item.routine === true,
      number: item.routine === true ? null : ++n,
      finding: typeof item.flag === 'string' ? findings.get(item.flag) ?? null : null,
      explainedIn: by ? sceneChapter(by.scene) : null,
      topic: (by?.scene.topic && topics.get(by.scene.topic)) ?? null,
    };
  });
  const readFirst = items.filter((i) => !i.routine);
  const skim = [];
  for (const run of runsByTopic(items.filter((i) => i.routine))) {
    const same = skim.find((g) => g.title === run.title);
    if (same) same.items.push(...run.items);
    else skim.push(run);
  }
  return { items, readFirst, groups: runsByTopic(readFirst), skim };
}

/** "Claude: likely bug, the count is per server". */
export const flagText = (finding) => `Claude: ${FLAG_WORDS[finding.severity] ?? finding.severity}, ${oneLine(finding.claim)}`;

/** One item as a line: its number, place and check, and the finding it carries. */
function itemLine(item, sep) {
  const flag = item.finding ? ` (${flagText(item.finding)})` : '';
  return `${item.number}. ${item.where}${sep}${oneLine(item.check)}${flag}`;
}

/** The reading order as a Markdown checklist: the items to read in runs by topic, then one "skim" line per topic. */
export function readingChecklist(order) {
  const out = [];
  for (const group of order.groups) {
    if (group.title) out.push(`### ${oneLine(group.title)}`, '');
    for (const item of group.items) out.push(`- [ ] ${itemLine(item, ': ')}`);
    out.push('');
  }
  if (order.skim.length) {
    out.push('### Skim', '');
    for (const group of order.skim) out.push(`- [ ] ${group.title ? `${oneLine(group.title)}: ` : ''}${group.items.map((i) => i.where).join(', ')}`);
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
  const lines = order.readFirst.map((item) => `  ${itemLine(item, '  ')}`);
  const routine = order.items.filter((i) => i.routine);
  if (routine.length) lines.push(`  skim: ${routine.map((i) => i.where).join(', ')}`);
  return lines;
}
