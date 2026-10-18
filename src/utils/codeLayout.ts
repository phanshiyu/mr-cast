import { lineFocusRanges } from '../../shared/focus.mjs';
import { fitLines, fitText, measure, type Fit } from '../../shared/textfit.mjs';
import { CODE_TAB_SIZE, contentBox } from '../components/theme';
import { SLOTS, sized } from '../fit/slots';
import type { CodeScene, Hunk } from '../types';
import { splitRows, type SplitRow } from './diffRows';
import { CHANGE_WORD } from './marks';
import { layoutSteps, type FlowSteps, type StepLayout } from './stepsLayout';

export type View = 'split' | 'morph';

export const SIGN_W = 26;
export const SPLIT_NUMBER_W = 66;
export const MORPH_NUMBER_W = 58;
export const SPLIT_GUTTER_W = SPLIT_NUMBER_W + SIGN_W;
export const MORPH_GUTTER_W = MORPH_NUMBER_W * 2 + SIGN_W;
/** Code sizes: the readable range, largest first. Past the smallest, code still shrinks to HARD_MIN rather than lose a character. */
const FONT_RANGE: Record<View, { min: number; max: number }> = { split: { min: 14, max: 20 }, morph: { min: 15, max: 23 } };
const HARD_MIN = 10;
/** Room kept between the end of the longest line and the edge of its panel. */
const CODE_RIGHT_PAD = 14;
export const PANEL_PAD = 18;
export const HEADER_H = 92;
export const HEADER_GAP = 22;
export const CALLOUT_W = 420;
export const CALLOUT_GAP = 56;
export const CALLOUT_BELOW_H = 112;
/** Padding of a callout card, across and down. */
const CALLOUT_PAD = { x: 52, y: 44 };
/** With a flow the code keeps this share of the width; the step diagram takes the rest. */
const FLOW_CODE_SHARE = 0.6;
export const FLOW_GAP = 72;
export const FLOW_CALLOUT_GAP = 36;
/** Unfocused rows kept above the first step and below the last; the rest of the hunk is cropped away. */
const CONTEXT_ROWS = 3;

export const STATUS_LABEL: Record<Hunk['status'], string> = { added: CHANGE_WORD.added, modified: CHANGE_WORD.modified, deleted: CHANGE_WORD.removed, renamed: 'renamed', source: 'source' };

/** Morph numbers each row with its old and new line like a unified diff; a source snippet has only its own numbers. */
export const morphGutterW = (hunk: Hunk) => (hunk.status === 'source' ? SPLIT_GUTTER_W : MORPH_GUTTER_W);

/** A code line with its tabs turned into spaces at CODE_TAB_SIZE stops, as the code is drawn. */
export function expandTabs(text: string): string {
  let out = '';
  for (const ch of text) out += ch === '\t' ? ' '.repeat(CODE_TAB_SIZE - (out.length % CODE_TAB_SIZE)) : ch;
  return out;
}

/** Code font and row height, sized so the longest shown line fits the code column. */
export interface CodeMetrics {
  fontSize: number;
  rowH: number;
  /** The shown lines at the smallest readable size, and at the size they are drawn, for the report. */
  readable: Fit;
  drawn: Fit;
}

function codeMetrics(hunk: Hunk, texts: readonly string[], view: View, panelW: number): CodeMetrics {
  const inner = panelW - 2;
  const column = (view === 'split' ? (inner - 1) / 2 - SPLIT_GUTTER_W : inner - morphGutterW(hunk)) - CODE_RIGHT_PAD;
  const lines = texts.map(expandTabs);
  const { min, max } = FONT_RANGE[view];
  const slot = { ...sized(SLOTS.code, column), size: max, min };
  const readable = fitLines(lines, view === 'split' ? slot : { ...slot, severity: 'warning', fix: 'the source line is long, so the code is drawn smaller' }, Infinity, 'hunkId');
  const drawn = fitLines(lines, { ...slot, min: HARD_MIN, fix: 'a line is too long to show at all; leave this hunk out with "skipped", or show other lines of it' }, Infinity, 'hunkId');
  return { fontSize: drawn.size, rowH: Math.round(drawn.size * 1.65), readable, drawn };
}

/**
 * Split view halves the code width, so it is the default only when the focus is mostly a before/after
 * comparison: removed lines beside the added lines that replace them. A focus on new code gets morph.
 */
function defaultView(hunk: Hunk, scene: CodeScene): View {
  const focus = lineFocusRanges(scene, hunk);
  const changed = (i: number | null) => i !== null && hunk.lines[i]!.type !== 'context';
  const focused = splitRows(hunk.lines).filter((row) => [row.left, row.right].some((i) => changed(i) && focus[i!] !== null));
  const paired = focused.filter((row) => changed(row.left) && changed(row.right)).length;
  return paired > 0 && 2 * paired >= focused.length ? 'split' : 'morph';
}

/**
 * One displayed row: a side-by-side pair of hunk.lines indices, or the same index twice in morph view.
 * `step` is the focus step the row belongs to, numbered top to bottom.
 */
export interface Slot extends SplitRow {
  step: number | null;
}

/**
 * The rows to show: the hunk cropped to CONTEXT_ROWS around its focus, plus how many steps they hold.
 * A scene with `steps` numbers rows by step, so step k always plays with its own spoken segment;
 * a focus-range scene numbers its ranges in the order they appear top to bottom.
 */
function cropSlots(hunk: Hunk, view: View, scene: CodeScene): { slots: Slot[]; stepCount: number } {
  const rangeOf = lineFocusRanges(scene, hunk);
  // Typing writes the new code, so removed lines are not drawn.
  const lines = hunk.lines.flatMap((line, i) => (scene.typing && line.type === 'del' ? [] : [i]));
  const rows = view === 'split' ? splitRows(hunk.lines) : lines.map((i) => ({ left: i, right: i }));
  const stepped = scene.steps?.length ?? 0;
  const order: number[] = [];
  const slots = rows.map((row) => {
    const ids = [row.left, row.right].flatMap((i) => (i === null ? [] : [rangeOf[i] ?? null])).filter((id) => id !== null);
    if (!ids.length) return { ...row, step: null };
    const id = Math.min(...ids);
    if (stepped) return { ...row, step: id };
    if (!order.includes(id)) order.push(id);
    return { ...row, step: order.indexOf(id) };
  });
  const focused = slots.flatMap((slot, i) => (slot.step === null ? [] : [i]));
  if (!focused.length) return { slots, stepCount: stepped };
  const from = Math.max(0, Math.min(...focused) - CONTEXT_ROWS);
  const to = Math.min(slots.length, Math.max(...focused) + 1 + CONTEXT_ROWS);
  return { slots: slots.slice(from, to), stepCount: stepped || order.length };
}

/** Width of the status pill and the line counts on either side of a code scene's path. */
function headerChrome(hunk: Hunk): number {
  const pill = measure(STATUS_LABEL[hunk.status], { family: 'sans', weight: 700, size: 20, letterSpacing: 1.5, upper: true }) + 2 * 16 + 2;
  const mono = { family: 'mono', weight: 600, size: 24 } as const;
  const range = hunk.status === 'deleted' ? `L${hunk.oldStartLine}` : `L${hunk.startLine}–${hunk.endLine}`;
  const counts = hunk.status === 'source' ? 0 : measure(`+${hunk.additions}`, mono) + measure(`−${hunk.deletions}`, mono) + 2 * 14;
  return pill + 2 * 22 + counts + 8 + measure(range, mono);
}

type CalloutAt = 'beside' | 'below' | 'flow';

/** The output pane steps print into, beside the code: its window and every step's lines, wrapped as a terminal wraps them. */
export interface OutputPaneLayout {
  x: number;
  width: number;
  title: Fit;
  font: number;
  rowH: number;
  lines: { step: number; fit: Fit; y: number; h: number }[];
}

export const OUTPUT_CHROME_H = 46;
export const OUTPUT_PAD = { x: 24, y: 18 };
const OUTPUT_GAP = 40;
/** With an output pane the code keeps this share of the width. */
const OUTPUT_CODE_SHARE = 0.58;
const OUTPUT_FONT = 22;

function layoutOutput(scene: CodeScene, x: number, width: number): OutputPaneLayout {
  const rowH = Math.round(OUTPUT_FONT * 1.5);
  const inner = width - 2 * OUTPUT_PAD.x;
  let y = OUTPUT_PAD.y;
  const lines = (scene.steps ?? []).flatMap((step, k) =>
    typeof step.output !== 'string'
      ? []
      : step.output.split('\n').map((raw) => {
          const fit = fitText(raw.replace(/\t/g, '  ').trimEnd(), { ...sized(SLOTS.terminalOutput, inner), size: OUTPUT_FONT, min: OUTPUT_FONT }, `steps[${k}].output`);
          // A terminal wraps a long line rather than shrink it, so only its markup can be wrong.
          const placed = { step: k, fit: { ...fit, fits: true, styled: 0 }, y, h: Math.max(1, fit.lines.length) * rowH };
          y += placed.h;
          return placed;
        }),
  );
  return { x, width, title: fitText(scene.outputTitle ?? 'Output', sized(SLOTS.terminalWindow, width - 140), 'outputTitle'), font: OUTPUT_FONT, rowH, lines };
}

export interface CodeLayout {
  view: View;
  flow: FlowSteps | null;
  slots: Slot[];
  stepCount: number;
  metrics: CodeMetrics;
  panelW: number;
  panelH: number;
  viewportH: number;
  path: Fit;
  header: Fit | null;
  /** Where the callout goes: beside a morph, below a split, under a step diagram, or nowhere. */
  callout: { at: CalloutAt; text: Fit; height: number } | null;
  steps: StepLayout | null;
  output: OutputPaneLayout | null;
  diagramLeft: number;
  diagramW: number;
  diagramTop: number;
}

/** Everything a code scene places before it animates: its view, rows, fonts, header, callout and step diagram. */
export function layoutCode(scene: CodeScene, hunk: Hunk): CodeLayout {
  const box = contentBox(false);
  const steps = scene.steps?.length ? scene.steps : null;
  const flow: FlowSteps | null = steps
    ? steps.every((step) => step.label) ? steps.map((step) => ({ label: step.label!, outcome: step.outcome })) : null
    : scene.flow?.length ? scene.flow : null;
  const flowPath = (k: number) => (steps ? `steps[${k}]` : `flow[${k}]`);
  const view: View = hunk.status === 'source' || scene.typing ? 'morph' : scene.view ?? (flow ? 'morph' : defaultView(hunk, scene));
  const { slots, stepCount } = cropSlots(hunk, view, scene);
  const calloutText = scene.calloutText?.trim() || null;
  const printing = !flow && Boolean(steps?.some((step) => typeof step.output === 'string'));
  const at: CalloutAt | null = calloutText === null ? null : flow ? 'flow' : view === 'morph' && !printing ? 'beside' : 'below';

  const panelW = flow ? Math.round(box.width * FLOW_CODE_SHARE) : printing ? Math.round(box.width * OUTPUT_CODE_SHARE) : at === 'beside' ? box.width - CALLOUT_W - CALLOUT_GAP : box.width;
  const panelH = box.height - HEADER_H - HEADER_GAP - (at === 'below' ? CALLOUT_BELOW_H + 28 : 0);
  const shown = slots.flatMap((slot) => [slot.left, slot.right]).flatMap((i) => (i === null ? [] : [hunk.lines[i]!.text]));
  const metrics = codeMetrics(hunk, [...new Set(shown)], view, panelW);

  const diagramLeft = panelW + FLOW_GAP;
  const diagramW = box.width - diagramLeft;
  const calloutWidth = at === 'flow' ? diagramW : at === 'beside' ? CALLOUT_W : box.width;
  const calloutFit = calloutText ? fitText(calloutText, { ...sized(SLOTS.callout, calloutWidth - CALLOUT_PAD.x), lines: at === 'beside' ? 5 : at === 'flow' ? 4 : 2 }, 'calloutText') : null;
  const callout = calloutFit && at ? { at, text: calloutFit, height: calloutFit.height + CALLOUT_PAD.y } : null;
  const flowCalloutBlock = callout?.at === 'flow' ? callout.height + FLOW_CALLOUT_GAP : 0;
  const stepLayout = flow ? layoutSteps(flow, diagramW, panelH - flowCalloutBlock, flowPath) : null;

  const pathText = hunk.status === 'renamed' && hunk.oldFile ? `${hunk.oldFile} → ${hunk.file}` : hunk.file;
  const textW = box.width - headerChrome(hunk);
  return {
    view,
    flow,
    slots,
    stepCount,
    metrics,
    panelW,
    panelH,
    viewportH: panelH - PANEL_PAD * 2,
    path: fitText(pathText, sized(SLOTS.codePath, textW), 'hunkId'),
    header: hunk.header ? fitText(hunk.header, sized(SLOTS.hunkHeader, textW), 'hunkId') : null,
    callout,
    steps: stepLayout,
    output: printing ? layoutOutput(scene, panelW + OUTPUT_GAP, box.width - panelW - OUTPUT_GAP) : null,
    diagramLeft,
    diagramW,
    diagramTop: stepLayout ? Math.max(0, (panelH - stepLayout.height - flowCalloutBlock) / 2) : 0,
  };
}
