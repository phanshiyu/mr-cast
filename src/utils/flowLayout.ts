import { fitBlock, fitLines, fitText, type Fit } from '../../shared/textfit.mjs';
import { contentBox } from '../components/theme';
import { SLOTS, sized } from '../fit/slots';
import type { FlowScene, FlowStep } from '../types';

export const LIST_W = 600;
export const COLUMN_GAP = 56;
export const STRIP_H = 76;
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

/** Pretty-printed JSON when the payload parses, otherwise the raw text. */
function formatPayload(payload: string): { text: string; language: string } {
  try {
    return { text: JSON.stringify(JSON.parse(payload), null, 2), language: 'json' };
  } catch {
    return { text: payload, language: 'plain' };
  }
}

/** What the step card shows: the payload as code, or else the action as a headline. */
export type StepCard =
  | { kind: 'payload'; text: string; language: string; lines: Fit }
  | { kind: 'headline'; text: Fit };

export interface FlowLayout {
  stepH: number;
  panelW: number;
  cardH: number;
  /** Each step's actor, and its action as drawn when it is the current step and when it is not. */
  rows: { actor: Fit; action: Fit; idle: Fit }[];
  /** Whether every row is tall enough for its actor and action, so no row runs into the next. */
  room: Fit;
  /** Each step's actor in the strip above the card, current or next. */
  strip: Fit[];
  cards: StepCard[];
  /** The card before the first step: the scene's title or its step count. */
  intro: StepCard;
}

function card(step: Pick<FlowStep, 'action' | 'payload'>, width: number, height: number, path: string): StepCard {
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

/** The list of steps on the left, the strip naming who acts, and the card with each step's payload. */
export function layoutFlow(scene: FlowScene): FlowLayout {
  const box = contentBox(Boolean(scene.title));
  const stepH = Math.min(170, box.height / scene.steps.length);
  const panelW = box.width - LIST_W - COLUMN_GAP;
  const cardH = box.height - STRIP_H - STRIP_GAP;
  const textW = LIST_W - BADGE;
  const rows = scene.steps.map((step, i) => ({
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
    ...rows.map((r) => Math.max(BADGE_H, ROW_PAD + r.actor.height + Math.max(r.action.height, r.idle.height))),
  );
  return {
    stepH,
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
    cards: scene.steps.map((step, i) => card(step, panelW, cardH, `steps[${i}].action`)),
    intro: card({ action: scene.title ?? `${scene.steps.length} steps` }, panelW, cardH, scene.title ? 'title' : ''),
  };
}
