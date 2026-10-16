// Review mode, shared by the scenes (which draw the findings), `validate` (which checks them) and the CLI
// (which writes review.md). A storyboard with `findings`, even an empty list, is a reviewed one.

import { expandLineRefs } from './focus.mjs';
import { plainText } from './markup.mjs';

/** Severities, worst first: the order the review scene and review.md list them in. */
export const SEVERITIES = ['bug', 'risk', 'nit'];
export const SEVERITY_TITLES = { bug: 'Bugs', risk: 'Risks', nit: 'Nits' };

/** The mark a flagged step draws when it names none. */
export const FLAG_MARK = 'circle';

export const isReviewed = (storyboard) => Array.isArray(storyboard?.findings);

/** The finding a code step flags, or undefined. */
export const flaggedFinding = (storyboard, step) => (typeof step?.flag === 'string' ? storyboard?.findings?.find((f) => f?.id === step.flag) : undefined);

/** "src/a.ts:12" or "src/a.ts:12-14". */
export function findingLocation(finding) {
  const lines = [...expandLineRefs([finding.line])];
  if (!lines.length) return finding.file;
  const [a, b] = [Math.min(...lines), Math.max(...lines)];
  return `${finding.file}:${a === b ? a : `${a}-${b}`}`;
}

/** The findings worst first, keeping the written order within a severity. */
export const bySeverity = (findings) => SEVERITIES.flatMap((severity) => findings.filter((f) => f.severity === severity));

/** review.md: the findings as file:line bullets a reader can act on, with their evidence. */
export function reviewMarkdown(storyboard, { branch, base } = {}) {
  const findings = storyboard.findings ?? [];
  const against = branch && base ? ` of \`${branch}\` against \`${base}\`` : '';
  const out = [`# Review: ${plainText(storyboard.title)}`, '', `Claude's review${against}. Each finding is an opinion, checked against the code before it was written down.`, ''];
  if (!findings.length) {
    out.push('No findings. Nothing in the change looked wrong.');
    return `${out.join('\n')}\n`;
  }
  for (const severity of SEVERITIES) {
    const own = findings.filter((f) => f.severity === severity);
    if (!own.length) continue;
    out.push(`## ${SEVERITY_TITLES[severity]}`, '');
    for (const f of own) out.push(`- \`${findingLocation(f)}\` ${plainText(f.claim)}`, `  - Evidence: ${f.evidence.trim()}`);
    out.push('');
  }
  return out.join('\n');
}
