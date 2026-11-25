import { codeHunkId, codeRows, formatPayload } from '../../shared/flow-code.mjs';
import { fitBlock, fitLines, fitText, measure, type Fit } from '../../shared/textfit.mjs';
import { CODE_TAB_SIZE, contentBox } from '../components/theme';
import { SLOTS, sized } from '../fit/slots';
import type { FlowScene, FlowStep, Hunk, HunkMap } from '../types';
import { SPLIT_GUTTER_W } from './codeLayout';

/** The step rail's width; a flow with real code narrows it, so the code panel has room for long lines. */
const LIST_W = 600;
const CODE_LIST_W = 420;
const COLUMN_GAP = 56;
const STRIP_H = 76;
const STRIP_GAP = 20;
/** The step's number badge and its gap, left of the actor and action. */
const BADGE = 48 + 22;
/** A row's height around its text: the badge, and the gap above the chip, the chip's padding and the gap below it. */
const BADGE_H = 48;
const ROW_PAD = 2 + 2 * 3 + 6;
const CHIP_PAD = 24;
const CHIP_ICON = 19 + 8;
/** Padding inside the step card around a payload, and around a headline. */
const PAYLOAD_PAD = 52;
const HEADLINE_PAD = 64;
/** Share of the strip each actor may take, leaving room for the arrow and "step N/M". */
const STRIP_SHARE = 0.4;

/** The file bar above real code, and the padding around it. */
const CODE_BAR_H = 64;
const CODE_PAD = 24;
/** The rail's `path:line` under a code stage's action, and the gap above it. */
const WHERE_GAP = 4;

/**
 * What the step card shows: the payload as one line of code, real lines of the diff, or else the action as a
 * headline. `rows` of a code card are indexes into `hunk.lines`, each with whether the stage lights it.
 */
export type StepCard =
  | { kind: 'payload'; text: string; language: string; lines: Fit }
  | { kind: 'code'; hunk: Hunk; rows: { index: number; lit: boolean }[]; light: boolean; where: string; lines: Fit }
  | { kind: 'headline'; text: Fit };

export interface FlowLayout {
  stepH: number;
  listW: number;
  panelW: number;
  cardH: number;
  /** Each step's actor, and its action as drawn when it is the current step and when it is not; a code stage adds its `path:line`. */
  rows: { actor: Fit; action: Fit; idle: Fit; where: Fit | null }[];
  /** Whether every row is tall enough for its actor and action, so no row runs into the next. */
  room: Fit;
  /** Each step's actor in the strip above the card, current or next. */
  strip: Fit[];
  cards: StepCard[];
  /** The card before the first step: the scene's title or its step count. */
  intro: StepCard;
}

/** A code stage's card, or null when its hunk or lines do not exist (`validate` reports that). */
function codeCard(step: FlowStep, hunks: HunkMap, width: number, height: number, path: string): StepCard | null {
  const id = codeHunkId(step.code);
  const hunk = id !== undefined && Object.hasOwn(hunks, id) ? hunks[id] : undefined;
  if (!step.code || !hunk) return null;
  const { problem, rows, first } = codeRows(hunk, step.code);
  if (problem || first === null) return null;
  const tabs = ' '.repeat(CODE_TAB_SIZE);
  const columnW = width - 2 * CODE_PAD - SPLIT_GUTTER_W;
  const slot = sized(SLOTS.flowCode, columnW);
  const room = height - CODE_BAR_H - 2 * CODE_PAD;
  const font = { family: 'mono' as const, weight: slot.weight, size: slot.min };
  const chars = Math.floor(columnW / (measure('0'.repeat(100), font) / 100));
  const fitLinesN = Math.floor(room / (slot.min * slot.lineHeight));
  return {
    kind: 'code',
    hunk,
    rows,
    light: rows.some((r) => r.lit),
    where: `${hunk.file}:${first}`,
    lines: fitLines(
      rows.map((r) => hunk.lines[r.index]!.text.replaceAll('\t', tabs)),
      {
        ...slot,
        fix: `at the smallest readable size, ${slot.min}px, a line can be ${chars} characters and ${fitLinesN} lines fit here; narrow \`lines\` to fewer or shorter lines, or split a longer stretch across stages`,
      },
      room,
      path.replace(/action$/, 'code'),
    ),
  };
}

function card(
  step: Pick<FlowStep, 'action' | 'payload' | 'code'>,
  hunks: HunkMap,
  width: number,
  height: number,
  path: string,
): StepCard {
  const code = codeCard(step as FlowStep, hunks, width, height, path);
  if (code) return code;
  if (!step.payload)
    return { kind: 'headline', text: fitText(step.action, sized(SLOTS.flowHeadline, width - 2 * HEADLINE_PAD), path) };
  const { text, language } = formatPayload(step.payload);
  return {
    kind: 'payload',
    text,
    language,
    lines: fitLines(
      text.split('\n'),
      sized(SLOTS.payload, width - 2 * PAYLOAD_PAD),
      height - 48,
      path.replace(/action$/, 'payload'),
    ),
  };
}

/** The rail's `path:line` of a code stage, with the directories dropped from the front when the whole path is too wide. */
function whereFit(card: StepCard, width: number, i: number): Fit | null {
  if (card.kind !== 'code') return null;
  const slot = sized(SLOTS.flowWhere, width);
  const parts = card.where.split('/');
  let fit = fitText(card.where, slot, `steps[${i}].code`);
  for (let from = 1; !fit.fits && from < parts.length; from++)
    fit = fitText(parts.slice(from).join('/'), slot, `steps[${i}].code`);
  return fit;
}

/** The list of steps on the left, the strip naming who acts, and the card with each step's payload. */
export function layoutFlow(scene: FlowScene, hunks: HunkMap = {}): FlowLayout {
  const box = contentBox(Boolean(scene.title));
  const listW = scene.steps.some((s) => s.code) ? CODE_LIST_W : LIST_W;
  const stepH = Math.min(170, box.height / scene.steps.length);
  const panelW = box.width - listW - COLUMN_GAP;
  const cardH = box.height - STRIP_H - STRIP_GAP;
  const textW = listW - BADGE;
  const cards = scene.steps.map((step, i) => card(step, hunks, panelW, cardH, `steps[${i}].action`));
  const rows = scene.steps.map((step, i) => ({
    where: whereFit(cards[i]!, textW, i),
    actor: fitText(
      step.actor,
      sized(SLOTS.flowActor, textW - CHIP_PAD - (step.icon ? CHIP_ICON : 0)),
      `steps[${i}].actor`,
    ),
    action: fitText(
      step.action,
      { ...sized(SLOTS.flowAction, textW), lines: stepH >= 150 ? 2 : 1 },
      `steps[${i}].action`,
    ),
    idle: fitText(
      step.action,
      { ...sized(SLOTS.flowAction, textW), size: 27, weight: 500, lines: stepH >= 150 ? 2 : 1 },
      `steps[${i}].action`,
    ),
  }));
  const rowH = Math.max(
    0,
    ...rows.map((r) =>
      Math.max(
        BADGE_H,
        ROW_PAD +
          r.actor.height +
          Math.max(r.action.height, r.idle.height) +
          (r.where ? WHERE_GAP + r.where.height : 0),
      ),
    ),
  );
  return {
    stepH,
    listW,
    panelW,
    cardH,
    rows,
    room: fitBlock(
      'steps',
      'step list',
      rowH <= stepH + 0.5,
      `each step needs ${Math.ceil(rowH)}px and has ${Math.floor(stepH)}px, so the rows overlap; use fewer steps, or split them across two flow scenes`,
    ),
    strip: scene.steps.map((step, i) =>
      fitText(step.actor, sized(SLOTS.flowStrip, panelW * STRIP_SHARE), `steps[${i}].actor`),
    ),
    cards,
    intro: card(
      { action: scene.title ?? `${scene.steps.length} steps` },
      hunks,
      panelW,
      cardH,
      scene.title ? 'title' : '',
    ),
  };
}
