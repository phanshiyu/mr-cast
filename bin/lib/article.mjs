// article.md: the teaching article a full video is adapted from. It teaches on its own, so it is written with no
// thought of the medium; the storyboard then names the section each scene adapts, and validate holds the
// storyboard to the article's sections and their order.
//
//   # Title
//   ## Takeaways            1. to 4. full sentences
//   ## <the claim> {#id}    one or more sections, in teaching order
//   ## Questions            1. question / Answer: ... / Takeaway: n
//   ## Left out             - what was excluded, and why

import fs from 'node:fs';
import path from 'node:path';
import { pickOf } from '../../shared/plan.mjs';

export const ARTICLE_FILE = 'article.md';

const RESERVED = { takeaways: 'Takeaways', questions: 'Questions', 'left out': 'Left out' };
const TAKEAWAYS = { min: 2, max: 4 };
const CLAIM_WORDS_MIN = 4;
const ID = /^[a-z0-9][a-z0-9-]*$/;
// Phrases about the medium. The article is the content alone, so it reads the same as a page, a talk or a video.
// Only phrases that can mean nothing else: "scene graph", "primitives", "the window slides" or "CSS animation" are
// ordinary words of an article about code.
const MEDIUM_WORDS = /\b(?:this video|the video|on[- ]screen|the viewers?|storyboards?|narration|(?:this|the next|the previous) (?:scene|slide))\b/i;

/** A line with its code spans blanked out, so a code name such as `scene` is not read as a word. */
const prose = (line) => line.replace(/`[^`\n]*`/g, '');

/** For each line, whether it is part of a fenced code block, its fences included. */
function fenced(lines) {
  let open = null;
  return lines.map((line) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (open === null) {
      if (fence) open = fence;
      return Boolean(fence);
    }
    if (fence && fence[0] === open[0] && fence.length >= open.length && !line.trim().slice(fence.length)) open = null;
    return true;
  });
}

/**
 * The article parsed, with its problems. `sections` are the teaching sections in order, each
 * `{ id, title, line, words }`; `questions` are `{ question, answer, takeaway }`.
 */
export function parseArticle(text) {
  const errors = [];
  const warnings = [];
  const lines = text.split('\n');
  const title = lines.find((l) => l.trim())?.match(/^# (.+)/)?.[1]?.trim() ?? null;
  if (!title) errors.push('article.md: the first line must be the title, as "# How quicksort sorts a list"');

  const code = fenced(lines);
  const parts = [];
  lines.forEach((line, i) => {
    const m = !code[i] && line.match(/^## (.+?)\s*$/);
    if (m) parts.push({ heading: m[1], line: i + 1, body: [], code: [] });
    else if (parts.length) {
      parts.at(-1).body.push(line);
      parts.at(-1).code.push(code[i]);
    }
  });

  const sections = [];
  const reserved = {};
  for (const part of parts) {
    const at = `article.md:${part.line}`;
    const id = part.heading.match(/\{#([^}]*)\}$/);
    const name = part.heading.replace(/\s*\{#[^}]*\}$/, '').trim();
    const key = name.toLowerCase();
    if (Object.hasOwn(RESERVED, key)) {
      reserved[key] = part;
      continue;
    }
    if (!id) {
      errors.push(`${at}: "## ${name}" has no id; end the heading with one, as "## ${name} {#${slug(name)}}"`);
      continue;
    }
    if (!ID.test(id[1])) errors.push(`${at}: id "${id[1]}" must be lowercase letters, digits and dashes`);
    else if (sections.some((s) => s.id === id[1])) errors.push(`${at}: id "${id[1]}" is already used by another section`);
    if (name.split(/\s+/).length < CLAIM_WORDS_MIN) warnings.push(`${at}: "${name}" is a label; state the section's claim as a sentence, such as "Each partition puts the pivot in its final place"`);
    if (!part.body.join('').trim()) errors.push(`${at}: section "${id[1]}" is empty`);
    const words = part.body.filter((_, j) => !part.code[j]).map(prose).join('\n').split(/\s+/).filter(Boolean).length;
    sections.push({ id: id[1], title: name, line: part.line, words });
  }
  if (!sections.length && title) errors.push('article.md: no teaching section; write each idea as "## <its claim> {#id}" followed by its text');

  for (const [key, label] of Object.entries(RESERVED)) {
    if (!reserved[key]) errors.push(`article.md: no "## ${label}" section`);
  }
  const takeaways = numbered(reserved.takeaways?.body ?? []).map((t) => t.text);
  if (reserved.takeaways) {
    if (!takeaways.length) errors.push(`article.md:${reserved.takeaways.line}: Takeaways lists none; write ${TAKEAWAYS.min} to ${TAKEAWAYS.max} as "1. <a full sentence>"`);
    else if (takeaways.length < TAKEAWAYS.min || takeaways.length > TAKEAWAYS.max) warnings.push(`article.md:${reserved.takeaways.line}: ${takeaways.length} takeaways; aim for ${TAKEAWAYS.min} to ${TAKEAWAYS.max}, each a full sentence`);
  }
  const questions = reserved.questions ? parseQuestions(reserved.questions, takeaways.length, errors) : [];
  takeaways.forEach((_, i) => {
    if (reserved.questions && questions.length && !questions.some((q) => q.takeaway === i + 1)) errors.push(`article.md: takeaway ${i + 1} has no question; add one a reader who got it could answer and one who did not could not`);
  });
  if (reserved['left out'] && !reserved['left out'].body.join('').trim()) errors.push(`article.md:${reserved['left out'].line}: Left out is empty; list what you left out and why, or write "- Nothing."`);

  lines.forEach((line, i) => {
    const m = !code[i] && prose(line).match(MEDIUM_WORDS);
    if (m) warnings.push(`article.md:${i + 1}: "${m[0]}" is about the medium; the article teaches the idea alone, so write it as you would for a page (a code name in backticks, such as \`scene\`, is fine)`);
  });
  const q = reserved.questions;
  const next = q && parts[parts.indexOf(q) + 1];
  const questionLines = q ? { from: q.line - 1, to: next ? next.line - 1 : lines.length } : null;
  return { title, takeaways, sections, questions, questionLines, errors, warnings };
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 3).join('-');

/** "1. text" items, a following indented line continuing the item. */
function numbered(body) {
  const items = [];
  for (const line of body) {
    const m = line.match(/^\d+\.\s+(.+)/);
    if (m) items.push({ text: m[1].trim(), more: [] });
    else if (items.length && /^\s+\S/.test(line)) items.at(-1).more.push(line.trim());
  }
  return items;
}

function parseQuestions(part, takeawayCount, errors) {
  const items = numbered(part.body);
  if (!items.length) errors.push(`article.md:${part.line}: Questions lists none; write each as "1. <question>", then "   Answer: ..." and "   Takeaway: <n>" lines under it`);
  return items.map((item, i) => {
    const field = (name) => item.more.find((l) => l.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim();
    const answer = field('answer');
    const takeaway = Number(field('takeaway'));
    if (!answer) errors.push(`article.md: question ${i + 1} has no "Answer:" line under it`);
    if (!Number.isInteger(takeaway) || takeaway < 1 || takeaway > takeawayCount) errors.push(`article.md: question ${i + 1} needs a "Takeaway: <n>" line naming one of the ${takeawayCount} takeaways it tests`);
    return { question: item.text, answer, takeaway };
  });
}

/** The article a reader test sees: everything but the questions' answers, with the questions alone at the end. */
export function readerText(text, article) {
  const lines = text.split('\n');
  const { from, to } = article.questionLines ?? { from: lines.length, to: lines.length };
  const body = [...lines.slice(0, from), ...lines.slice(to)].join('\n').trimEnd();
  return `${body}\n\n## Questions\n\n${article.questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}\n`;
}

/** The run's article.md parsed, or null when it has none. */
export function readArticle(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, ARTICLE_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return { text, ...parseArticle(text) };
}

/** The article against plan.json: a section per topic kept, named by its id, in the plan's order. */
export function checkArticlePlan(article, plan, warnings) {
  const ids = article.sections.map((s) => s.id);
  let last = -1;
  for (const topic of plan.topics) {
    const at = ids.indexOf(topic.id);
    const { depth } = pickOf(topic);
    if (depth === 'skip') {
      if (at >= 0) warnings.push(`article.md: the plan skips "${topic.id}" but the article has its section; move it to Left out`);
      continue;
    }
    if (at < 0) {
      warnings.push(`article.md: no section for the plan's topic "${topic.id}" (${depth}); write it as "## <its claim> {#${topic.id}}"`);
      continue;
    }
    if (at < last) warnings.push(`article.md: section "${topic.id}" comes before the topic the plan puts ahead of it; follow the plan's order`);
    last = Math.max(last, at);
  }
}

// Scenes that frame the whole video rather than adapt one idea.
const FRAMING = ['intent', 'files', 'review', 'reading'];

/**
 * The storyboard against the article: each scene adapts the section its `section` names, or else its `topic`;
 * no section is unknown; each section is adapted or listed in `textOnly`; and the diagrams, and again the code,
 * follow the article's order.
 */
export function checkSections(sb, article, errors, warnings) {
  const ids = article.sections.map((s) => s.id);
  const adapted = new Set();
  const order = { code: [], other: [] };
  sb.scenes.forEach((s, i) => {
    if (s?.section !== undefined && (typeof s.section !== 'string' || !s.section.trim())) return errors.push(`scenes[${i}].section: must be a section id from article.md`);
    const id = s?.section ?? (ids.includes(s?.topic) ? s.topic : undefined);
    if (id === undefined) {
      if (!FRAMING.includes(s?.type)) warnings.push(`scenes[${i}]: adapts no article section; set "section" to one of ${ids.join(', ')}, or change the article first if this idea belongs in it`);
      return;
    }
    if (!ids.includes(id)) return errors.push(`scenes[${i}].section: no section "${id}" in article.md; use one of ${ids.join(', ')}`);
    adapted.add(id);
    order[s.type === 'code' ? 'code' : 'other'].push({ i, id, at: ids.indexOf(id) });
  });
  const textOnly = new Set();
  if (sb.textOnly !== undefined) {
    if (!Array.isArray(sb.textOnly)) errors.push('textOnly: must be an array of { "section": id, "reason": "..." }');
    else sb.textOnly.forEach((t, j) => {
      if (!ids.includes(t?.section)) errors.push(`textOnly[${j}].section: no section ${JSON.stringify(t?.section)} in article.md`);
      if (typeof t?.reason !== 'string' || !t.reason.trim()) errors.push(`textOnly[${j}].reason: say why this section stays in the article alone`);
      textOnly.add(t?.section);
    });
  }
  for (const id of ids) {
    if (!adapted.has(id) && !textOnly.has(id)) warnings.push(`article.md: no scene adapts section "${id}"; add a scene with "section": "${id}", or list it in "textOnly" with the reason it stays in the article alone`);
  }
  for (const [kind, seq] of Object.entries(order)) {
    for (let k = 1; k < seq.length; k++) {
      if (seq[k].at < seq[k - 1].at) warnings.push(`scenes[${seq[k].i}]: adapts "${seq[k].id}", which the article puts before "${seq[k - 1].id}" of scenes[${seq[k - 1].i}]; ${kind === 'code' ? 'the code scenes' : 'the diagrams'} follow the article's order`);
    }
  }
}
