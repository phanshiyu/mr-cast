import { bySeverity, findingLocation } from '../../shared/review.mjs';
import { fitBlock, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { Finding } from '../types';

const MAX_FONT = 30;
const LINE_HEIGHT = 1.3;
export const PILL_W = 104;
export const ROW_PAD_X = 22;
export const COL_GAP = 26;
const ROW_GAP = 10;
/** The file:line column never takes more than this share of the row, so the claim keeps its room. */
const WHERE_SHARE = 0.4;

export interface PlacedFinding {
  finding: Finding;
  y: number;
  h: number;
  where: Fit;
  claim: Fit;
}

export interface ReviewLayout {
  rows: PlacedFinding[];
  lineHeight: number;
  whereX: number;
  claimX: number;
  claimW: number;
  height: number;
  room: Fit;
}

/** `written` is the storyboard's own order, which a report names each claim by. */
function attempt(findings: readonly Finding[], written: readonly Finding[], width: number, font: number): ReviewLayout {
  const lineHeight = Math.round(font * LINE_HEIGHT);
  const whereFont = Math.round(font * 0.82);
  const pad = Math.round(font * 0.5);
  const whereX = ROW_PAD_X + PILL_W + COL_GAP;
  const locations = findings.map(findingLocation);
  const widest = Math.max(0, ...locations.map((l) => measure(l, { family: 'mono', weight: SLOTS.findingWhere.weight, size: whereFont })));
  const whereW = Math.ceil(Math.min(widest, (width - whereX) * WHERE_SHARE));
  const claimX = whereX + whereW + COL_GAP;
  const claimW = width - claimX - ROW_PAD_X;
  let y = 0;
  const rows = findings.map((finding, i) => {
    const k = `findings[${written.indexOf(finding)}]`;
    const where = fitTextAt(locations[i]!, sized(SLOTS.findingWhere, whereW), `${k}.file`, whereFont);
    const claim = fitTextAt(finding.claim, sized(SLOTS.findingClaim, claimW), `${k}.claim`, font);
    const h = Math.max(1, claim.lines.length) * lineHeight + 2 * pad;
    const row = { finding, y, h, where, claim };
    y += h + ROW_GAP;
    return row;
  });
  return { rows, lineHeight, whereX, claimX, claimW, height: Math.max(0, y - ROW_GAP), room: fitBlock('findings', 'review scene', true, '') };
}

/**
 * The recap's rows, worst severity first: a severity pill, the file:line and the claim in up to two lines.
 * Picks the largest font at which every claim fits and the rows fit the height; a recap that does not fit
 * at the smallest is reported, so `validate` fails rather than the video cutting a claim.
 */
export function layoutReview(findings: readonly Finding[], width: number, height: number): ReviewLayout {
  const ordered = bySeverity(findings);
  let last = attempt(ordered, findings, width, SLOTS.findingClaim.min);
  for (let font = MAX_FONT; font >= SLOTS.findingClaim.min; font--) {
    last = attempt(ordered, findings, width, font);
    if (last.height <= height && last.rows.every((r) => r.claim.fits)) return last;
  }
  return { ...last, room: fitBlock('findings', 'review scene', last.height <= height, 'keep only the findings that clearly look wrong, or shorten their claims') };
}
