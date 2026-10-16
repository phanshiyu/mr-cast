// Review mode, shared by the scenes (which draw the findings), `validate` (which checks them) and the CLI
// (which writes review.md). A storyboard with `findings`, even an empty list, is a reviewed one.

import { plainText } from './markup.mjs';

/** Severities, worst first: the order the review scene and review.md list them in. */
export const SEVERITIES = ['bug', 'risk', 'nit'];
export const SEVERITY_TITLES = { bug: 'Bugs', risk: 'Risks', nit: 'Nits' };

/** The mark a flagged step draws when it names none. */
export const FLAG_MARK = 'circle';

export const isReviewed = (storyboard) => Array.isArray(storyboard?.findings);

/** The finding a code step flags, or undefined. */
export const flaggedFinding = (storyboard, step) => (typeof step?.flag === 'string' && isReviewed(storyboard) ? storyboard.findings.find((f) => f?.id === step.flag) : undefined);

/** A line number or "a-b" range as [first, last], or null when it is neither. Never expands the range. */
export function lineSpan(ref) {
  if (Number.isInteger(ref) && ref > 0) return [ref, ref];
  const m = typeof ref === 'string' ? /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(ref) : null;
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
  return [Math.min(a, b), Math.max(a, b)];
}

/** "src/a.ts:12" or "src/a.ts:12-14". */
export function findingLocation(finding) {
  const span = lineSpan(finding.line);
  if (!span) return finding.file;
  return `${finding.file}:${span[0] === span[1] ? span[0] : `${span[0]}-${span[1]}`}`;
}

/** The first line of review.md, by which mr-cast knows a review.md is its own. */
export const REVIEW_HEADING = '# Review: ';
/** One line of review.md: a claim or evidence never breaks its bullet. */
const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

/** The findings worst first, keeping the written order within a severity. */
export const bySeverity = (findings) => SEVERITIES.flatMap((severity) => findings.filter((f) => f.severity === severity));

/** review.md: the findings as file:line bullets a reader can act on, with their evidence. */
export function reviewMarkdown(storyboard, { branch, base } = {}) {
  const findings = storyboard.findings ?? [];
  const against = branch && base ? ` of \`${branch}\` against \`${base}\`` : '';
  const out = [`${REVIEW_HEADING}${oneLine(plainText(storyboard.title))}`, '', `Claude's review${against}. Each finding is an opinion, checked against the code before it was written down.`, ''];
  if (!findings.length) {
    out.push('No findings. Nothing in the change looked wrong.');
    return `${out.join('\n')}\n`;
  }
  for (const severity of SEVERITIES) {
    const own = findings.filter((f) => f.severity === severity);
    if (!own.length) continue;
    out.push(`## ${SEVERITY_TITLES[severity]}`, '');
    for (const f of own) out.push(`- \`${findingLocation(f)}\` ${oneLine(plainText(f.claim))}`, `  - Evidence: ${oneLine(f.evidence)}`);
    out.push('');
  }
  return out.join('\n');
}
