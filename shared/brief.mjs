// The brief of a branch video (docs/adr/0037-reviewer-brief.md): the six questions a reviewer has, answered in the
// storyboard. This file reads them for the one-line summary and for guide.md, so the terminal and the file agree.

import { parseMarkup, plainText } from './markup.mjs';

export const QUESTIONS = ['why', 'case', 'approach', 'parts', 'proof', 'check'];
/** The first line of guide.md, by which mr-cast knows a guide.md is its own. */
export const GUIDE_HEADING = '# Guide to this change: ';

const WEIGHT_WORDS = { core: 'main part', support: 'supporting part', routine: 'routine, skim it' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const object = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const oneLine = (text) => plainText(String(text)).replace(/\s+/g, ' ').trim();

/**
 * One decision as `{ text, source, cite }`. A plain string is the writer's own observation, so source "mine".
 * `kind` is "stated" (a commit or the description), "code" or "mine".
 */
function readDecision(d) {
  const o = object(d);
  const text = typeof d === 'string' ? d : typeof o?.text === 'string' ? o.text : '';
  const source = o && typeof o.source === 'string' && o.source.trim() ? o.source.trim() : 'mine';
  const kind = source === 'code' ? 'code' : source === 'mine' ? 'mine' : 'stated';
  return { text, source, kind, cite: o ? list(o.cite) : [] };
}

/** The decisions of an approach, each read by `readDecision`; empty text is dropped. */
export const decisionsOf = (approach) =>
  (Array.isArray(approach?.decisions) ? approach.decisions : []).map(readDecision).filter((d) => d.text.trim());

/** What each kind of decision is called where a person reads it. */
const DECISION_LABELS = {
  stated: 'The author says',
  code: 'The code shows',
  mine: "Another way, not the author's",
};

/** The words before a decision: "The author says (commit 7376000)", "The code shows (h2)", "Another way, not the author's". */
export function decisionLead(d) {
  const detail = d.kind === 'stated' ? d.source : d.kind === 'code' ? d.cite.join(', ') : '';
  return `${DECISION_LABELS[d.kind]}${detail ? ` (${detail})` : ''}`;
}

/** "3 decisions (2 stated, 1 mine)": the count with the kinds that are there. */
function decisionCount(approach) {
  const ds = decisionsOf(approach);
  const by = (k) => ds.filter((d) => d.kind === k).length;
  const parts = [
    [by('stated'), 'stated'],
    [by('code'), 'code'],
    [by('mine'), 'mine'],
  ].filter(([n]) => n > 0);
  return `${plural(ds.length, 'decision')}${parts.length ? ` (${parts.map(([n, w]) => `${n} ${w}`).join(', ')})` : ''}`;
}

/** Whether `brief` answers `question`, with something other than "unknown": a missing answer is not an answer. */
function answered(brief, question) {
  const a = brief?.[question];
  if (question === 'check') return Array.isArray(a) && a.length > 0;
  if (question === 'why') return object(a) !== null;
  return a === 'unknown' || (question === 'parts' ? Array.isArray(a) : object(a) !== null);
}

/** Whether the answer says it is not known. */
const unknown = (brief, question) =>
  question === 'why' ? brief?.why?.source === 'unknown' : brief?.[question] === 'unknown';

/** The questions with no answer at all, which `validate` names. */
export const missingQuestions = (brief) => QUESTIONS.filter((q) => !answered(brief, q));

/**
 * One line for validate, outline and the hook: `brief: why ✓ (commit 7376000) · case ✓ · approach ✓ 3 decisions (2 stated, 1 mine) ·
 * parts 3, core 2 · proof ✗ · check 2 · ask 1`.
 */
export function briefLine(brief) {
  const word = (q, ok) => (!answered(brief, q) ? `${q} ✗` : unknown(brief, q) ? `${q} unknown` : `${q} ✓${ok}`);
  const source = typeof brief?.why?.source === 'string' ? ` (${brief.why.source})` : '';
  const parts = Array.isArray(brief?.parts) ? brief.parts : null;
  const core = parts ? parts.filter((p) => p?.weight === 'core').length : 0;
  const proof = object(brief?.proof);
  return `brief: ${[
    word('why', source),
    word('case', ''),
    word('approach', ` ${decisionCount(object(brief?.approach))}`),
    parts ? `parts ${parts.length}, core ${core}` : word('parts', ''),
    word('proof', proof ? ` ${list(proof.tested).length} tested, ${list(proof.untested).length} untested` : ''),
    answered(brief, 'check') ? `check ${brief.check.length}` : 'check ✗',
    `ask ${list(brief?.ask).length}`,
  ].join(' · ')}`;
}

const md = (text) =>
  parseMarkup(String(text))
    .runs.map((r) => (r.code ? `\`${r.text}\`` : r.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const bullets = (items) => items.map((t) => `- ${md(t)}`);
const NOT_ANSWERED = 'Not answered yet.';

/** The files of a part's hunks, each once, in the order its hunks name them. */
function partFiles(part, hunks) {
  const files = list(part?.hunks).flatMap((id) => (Object.hasOwn(hunks, id) ? [hunks[id].file] : []));
  return [...new Set(files)];
}

function sections(brief, hunks) {
  const why = object(brief.why);
  const cs = object(brief.case);
  const approach = object(brief.approach);
  const proof = object(brief.proof);
  const out = [];
  const add = (heading, lines) => out.push(`## ${heading}`, '', ...lines, '');

  if (!why) add('Why does this change exist?', [NOT_ANSWERED]);
  else if (why.source === 'unknown')
    add('Why does this change exist?', [
      'Nothing in the commits, the description or the code says. See the questions at the end.',
    ]);
  else add('Why does this change exist?', [`${md(why.text ?? '')} (Source: ${why.source}.)`]);

  if (brief.case === 'unknown') add('What happens on one case?', ['Not known.']);
  else if (!cs) add('What happens on one case?', [NOT_ANSWERED]);
  else
    add('What happens on one case?', [
      `Before: ${md(cs.before ?? '')}`,
      '',
      `After: ${md(cs.after ?? '')}`,
      ...(list(cs.cite).length ? ['', `See: ${list(cs.cite).join(', ')}`] : []),
    ]);

  if (brief.approach === 'unknown') add('What is the idea, and what did the author decide?', ['Not known.']);
  else if (!approach) add('What is the idea, and what did the author decide?', [NOT_ANSWERED]);
  else
    add('What is the idea, and what did the author decide?', [
      md(approach.text ?? ''),
      ...(decisionsOf(approach).length
        ? ['', 'Decisions:', ...decisionsOf(approach).map((d) => `- ${decisionLead(d)}: ${md(d.text)}`)]
        : []),
    ]);

  if (brief.parts === 'unknown') add('What are the parts?', ['Not known.']);
  else if (!Array.isArray(brief.parts)) add('What are the parts?', [NOT_ANSWERED]);
  else
    add(
      'What are the parts?',
      brief.parts.map((p) => {
        const files = partFiles(p, hunks);
        const named = files.length ? files.map((f) => `\`${f}\``).join(', ') : 'no files named';
        const after = list(p?.after);
        const head = `- **${md(p?.name ?? '')}** (${WEIGHT_WORDS[p?.weight] ?? p?.weight}):`;
        if (!list([p?.does]).length && !after.length) return `${head} ${named}`;
        return [
          `${head} ${md(p?.does ?? '')}`.trimEnd(),
          ...(after.length ? [`  After: ${after.map(md).join(', ')}`] : []),
          `  Files: ${named}`,
        ].join('\n');
      }),
    );

  if (brief.proof === 'unknown') add('How do we know it works?', ['Not known.']);
  else if (!proof) add('How do we know it works?', [NOT_ANSWERED]);
  else
    add('How do we know it works?', [
      'Tested:',
      ...(list(proof.tested).length ? bullets(proof.tested) : ['- nothing a test shows']),
      '',
      'Not tested:',
      ...(list(proof.untested).length ? bullets(proof.untested) : ['- nothing listed']),
    ]);

  const checks = Array.isArray(brief.check) ? brief.check.filter((c) => c && typeof c === 'object') : [];
  add(
    'What to look at first',
    checks.length
      ? checks.flatMap((c) => [`- \`${c.file}:${c.line}\`  ${md(c.what ?? '')}`, ...(c.why ? [`  ${md(c.why)}`] : [])])
      : [NOT_ANSWERED],
  );
  const ask = list(brief.ask);
  add('Questions for the author', ask.length ? bullets(ask) : ['None.']);
  return out;
}

/** guide.md: the brief's six answers, the parts with their files, the check-first list and the questions for the author. */
export function guideMarkdown(storyboard, hunks, { branch, base } = {}) {
  const against = branch && base ? `This is \`${branch}\` against \`${base}\`.\n\n` : '';
  return `${GUIDE_HEADING}${oneLine(storyboard.title)}\n\n${against}${sections(storyboard.brief, hunks).join('\n').trimEnd()}\n`;
}
