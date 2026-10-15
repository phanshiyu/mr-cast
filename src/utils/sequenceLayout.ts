import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS } from '../fit/slots';
import type { MessageKind, SequenceMessage, SequenceParticipant } from '../types';
import { badgeWords } from './marks';
import { cardTexts, type CardText } from './nodeText';
import type { Box, LayoutBoxes } from './penGeometry';

export const CARD_H = 84;
/** Room above the cards for the "changed" pill. */
const CARD_TOP = 18;
const CARD_MAX_W = 300;
const MAX_COL_W = 520;
const ROWS_GAP = 20;
const BOTTOM_PAD = 24;
const MAX_UNIT = 92;
/** A self-call needs room for its loop, so its row is taller than a plain one. */
const SELF_WEIGHT = 1.5;
export const BAR_W = 14;
const BAR_STEP = 8;
const LOOP_W = 40;
const LABEL_GAP = 6;
const NOTE_GAP = 18;
const NOTE_MAX_W = 460;
const CHIP_PAD_X = 12;
export const LABEL_LINE_HEIGHT = 1.35;
/** Chip padding and border above and below the text. */
const CHIP_PAD_Y = 3;

export interface Pt {
  x: number;
  y: number;
}

export interface PlacedParticipant {
  participant: SequenceParticipant;
  /** Lifeline x. */
  x: number;
}

export interface PlacedLabel {
  /** Anchor point; `align` says which edge of the chip sits on it. Center labels sit above the anchor. */
  x: number;
  y: number;
  align: 'center' | 'left' | 'right';
  maxWidth: number;
  /** One line, shrunk to fit; two when one would not fit even at the smallest font. */
  text: Fit;
}

export interface PlacedNote {
  /** Vertical centre of the card, and the x of its edge nearest the arrow. */
  x: number;
  y: number;
  side: 'left' | 'right';
  maxWidth: number;
  text: Fit;
}

export interface PlacedMessage {
  message: SequenceMessage;
  kind: MessageKind;
  self: boolean;
  /** Row band, for the "current message" highlight. */
  top: number;
  bottom: number;
  /** Source to arrow tip: two points, or four for a self-call loop. */
  points: Pt[];
  label: PlacedLabel;
  note: PlacedNote | null;
}

export interface PlacedActivation {
  x: number;
  y0: number;
  y1: number;
  /** Index of the message that opens it; it appears with that message. */
  opener: number;
}

export interface SequenceLayout {
  width: number;
  height: number;
  colW: number;
  cardW: number;
  cardTop: number;
  lifelineTop: number;
  participants: PlacedParticipant[];
  /** Each participant card's title and caption, by id. */
  texts: Map<string, CardText>;
  messages: PlacedMessage[];
  activations: PlacedActivation[];
}

interface Span {
  participant: number;
  start: number;
  end: number;
  /** Still open after the last message, so the bar runs past it. */
  open: boolean;
}

/**
 * Pairs each call with the next return its callee sends, stack-wise. A call never returned ends at
 * the next message its callee sends, or at the last message.
 */
function pairActivations(messages: readonly SequenceMessage[], indexOf: Map<string, number>): Span[] {
  const pending = new Map<number, Span[]>();
  const spans: Span[] = [];
  const unmatched: Span[] = [];
  messages.forEach((m, i) => {
    const from = indexOf.get(m.from)!;
    const to = indexOf.get(m.to)!;
    if (from === to) return;
    const kind = m.kind ?? 'call';
    if (kind === 'call') {
      const span = { participant: to, start: i, end: -1, open: false };
      pending.set(to, [...(pending.get(to) ?? []), span]);
    } else if (kind === 'return') {
      const span = pending.get(from)?.pop();
      if (span) spans.push({ ...span, end: i });
    }
  });
  for (const stack of pending.values()) unmatched.push(...stack);
  for (const span of unmatched) {
    const next = messages.findIndex((m, j) => j > span.start && indexOf.get(m.from) === span.participant && m.from !== m.to);
    spans.push({ ...span, end: next === -1 ? messages.length - 1 : next, open: next === -1 });
  }
  return spans.sort((a, b) => a.start - b.start || a.participant - b.participant);
}

/**
 * Fits `text` in a chip `width` wide and at most `height` tall. It shrinks to keep one line; a label that
 * does not fit on one line at `min` wraps onto two at the largest font that fits both ways.
 */
function fitLabel(text: string, width: number, height: number, min: number, max: number, path: string): Fit {
  const textW = width - CHIP_PAD_X * 2;
  const one = fitText(text, { ...SLOTS.messageLabel, size: max, min, oneLineMin: undefined, lines: 1, width: textW }, path);
  if (one.fits) return one;
  const tallest = Math.floor((height - 2 * CHIP_PAD_Y) / (2 * LABEL_LINE_HEIGHT));
  if (tallest < min) return one;
  return fitText(text, { ...SLOTS.messageLabel, size: Math.min(max, tallest), min, oneLineMin: undefined, lines: 2, width: textW }, path);
}

/** A label chip's width: its widest line and padding. */
const chipWidth = (fit: Fit) => fit.width + CHIP_PAD_X * 2;

/** Width of a note's text: its card less padding, border and icon. */
const NOTE_CHROME = 24 + 2 + 17 + 8;

export function layoutSequence(
  participants: readonly SequenceParticipant[],
  allMessages: readonly SequenceMessage[],
  box: { width: number; height: number },
): SequenceLayout {
  const indexOf = new Map(participants.map((p, i) => [p.id, i]));
  const messages = allMessages.filter((m) => indexOf.has(m.from) && indexOf.has(m.to));
  const n = Math.max(1, participants.length);
  const colW = Math.min(MAX_COL_W, box.width / n);
  const width = colW * n;
  const cardW = Math.min(CARD_MAX_W, colW - 16);
  const xs = participants.map((_, i) => colW * (i + 0.5));
  const lifelineTop = CARD_TOP + CARD_H;
  const rowsTop = lifelineTop + ROWS_GAP;

  const isSelf = (m: SequenceMessage) => m.from === m.to;
  const weights = messages.map((m) => (isSelf(m) ? SELF_WEIGHT : 1));
  const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));
  const unit = Math.min(MAX_UNIT, (box.height - rowsTop - BOTTOM_PAD) / totalWeight);
  const baseFont = Math.round(Math.max(17, Math.min(24, unit * 0.36)));
  /** A label may rise from its arrow to just short of the arrow in the row above. */
  const labelRoom = 0.92 * unit - LABEL_GAP;

  const rowTops: number[] = [];
  weights.reduce((top, w) => (rowTops.push(top), top + w * unit), rowsTop);
  const arrowY = messages.map((m, i) => rowTops[i]! + (isSelf(m) ? 0.3 : 0.72) * unit);

  const spans = pairActivations(messages, indexOf);
  const covering = (p: number, row: number) => spans.filter((s) => s.participant === p && s.start <= row && s.end >= row).length;
  /** Where an arrow leaves or reaches a lifeline: the outer edge of its activation bars, if any. */
  const edgeX = (p: number, row: number, dir: 1 | -1) => {
    const depth = covering(p, row);
    if (depth === 0) return xs[p]!;
    return dir > 0 ? xs[p]! + (depth - 1) * BAR_STEP + BAR_W / 2 : xs[p]! - BAR_W / 2;
  };

  const activations: PlacedActivation[] = spans.map((s) => {
    const depth = spans.filter((o) => o.participant === s.participant && o.start < s.start && o.end >= s.start).length;
    return {
      x: xs[s.participant]! + depth * BAR_STEP,
      y0: arrowY[s.start]!,
      y1: arrowY[s.end]! + (s.open ? 16 : 0),
      opener: s.start,
    };
  });

  const placed: PlacedMessage[] = messages.map((m, i) => {
    const kind = m.kind ?? 'call';
    const path = `messages[${allMessages.indexOf(m)}].label`;
    const from = indexOf.get(m.from)!;
    const to = indexOf.get(m.to)!;
    const top = rowTops[i]!;
    const bottom = top + weights[i]! * unit;
    const y = arrowY[i]!;
    let points: Pt[];
    let label: PlacedLabel;
    let occupied: [number, number];

    if (from === to) {
      const x = xs[from]!;
      const depth = covering(from, i);
      const start = edgeX(from, i, 1);
      const tip = x + depth * BAR_STEP + BAR_W / 2;
      const loopX = Math.max(start, tip) + LOOP_W;
      const yEnd = y + 0.6 * unit;
      points = [{ x: start, y }, { x: loopX, y }, { x: loopX, y: yEnd }, { x: tip, y: yEnd }];
      activations.push({ x: x + depth * BAR_STEP, y0: yEnd - 8, y1: yEnd + 14, opener: i });
      const rightRoom = width - (loopX + 12);
      const leftRoom = x - BAR_W - 8;
      const want = chipWidth(fitText(m.label, { ...SLOTS.messageLabel, size: baseFont, min: baseFont, oneLineMin: undefined, lines: 1, width: Infinity }, path));
      const onRight = rightRoom >= Math.min(want, colW * 0.9) || rightRoom >= leftRoom;
      const maxWidth = Math.min(onRight ? rightRoom : leftRoom, Math.max(colW * 0.9, want));
      const text = fitLabel(m.label, maxWidth, labelRoom, SLOTS.messageLabel.min, baseFont, path);
      const used = Math.min(maxWidth, chipWidth(text));
      label = onRight ? { x: loopX + 12, y: (y + yEnd) / 2, align: 'left', maxWidth, text } : { x: leftRoom, y: (y + yEnd) / 2, align: 'right', maxWidth, text };
      occupied = onRight ? [x - BAR_W, loopX + 12 + used] : [leftRoom - used, loopX];
    } else {
      const dir = to > from ? 1 : -1;
      const x1 = edgeX(from, i, dir);
      const x2 = edgeX(to, i, dir === 1 ? -1 : 1);
      points = [{ x: x1, y }, { x: x2, y }];
      const span = Math.abs(x2 - x1) - 12;
      label = {
        x: (x1 + x2) / 2,
        y: y - LABEL_GAP,
        align: 'center',
        maxWidth: span,
        text: fitLabel(m.label, span, labelRoom, SLOTS.messageLabel.min, baseFont, path),
      };
      occupied = [Math.min(x1, x2), Math.max(x1, x2)];
    }

    let note: PlacedNote | null = null;
    if (m.note) {
      const left = occupied[0] - NOTE_GAP;
      const right = width - (occupied[1] + NOTE_GAP);
      const side = right >= left ? 'right' : 'left';
      const maxWidth = Math.min(NOTE_MAX_W, Math.max(left, right));
      note = {
        x: side === 'right' ? occupied[1] + NOTE_GAP : occupied[0] - NOTE_GAP,
        y: from === to ? label.y : (top + bottom) / 2,
        side,
        maxWidth,
        text: fitText(m.note, { ...SLOTS.messageNote, lines: bottom - top >= 62 ? 2 : 1, width: maxWidth - NOTE_CHROME }, `messages[${allMessages.indexOf(m)}].note`),
      };
    }
    return { message: m, kind, self: from === to, top, bottom, points, label, note };
  });

  const rowsEnd = rowTops.length ? rowTops[rowTops.length - 1]! + weights[weights.length - 1]! * unit : rowsTop + unit;
  return {
    width,
    height: rowsEnd + BOTTOM_PAD,
    colW,
    cardW,
    cardTop: CARD_TOP,
    lifelineTop,
    participants: participants.map((participant, i) => ({ participant, x: xs[i]! })),
    texts: cardTexts(participants, cardW, CARD_H, cardW < 290 ? 'compact' : 'small', (i) => `participants[${i}]`, { shared: false }),
    messages: placed,
    activations,
  };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a
 * participant's card, and a message's row between the lifelines it joins. A note keeps off both.
 */
export function sequenceBoxes(layout: SequenceLayout): LayoutBoxes {
  const card = (p: PlacedParticipant): Box => {
    const lift = badgeWords(p.participant).length ? 14 : 0;
    return { x: p.x - layout.cardW / 2, y: layout.cardTop - lift, width: layout.cardW, height: CARD_H + lift };
  };
  const message = (m: PlacedMessage): Box => {
    const xs = m.points.map((p) => p.x);
    const [x0, x1] = [Math.min(...xs) - (m.self ? 10 : 0), Math.max(...xs) + (m.self ? LOOP_W : 0)];
    return { x: x0, y: m.top, width: Math.max(40, x1 - x0), height: m.bottom - m.top };
  };
  const boxes = new Map<string, Box>([
    ...layout.participants.map((p): [string, Box] => [`p:${p.participant.id}`, card(p)]),
    ...layout.messages.map((m, i): [string, Box] => [`m:${i}`, message(m)]),
  ]);
  return { boxes, obstacles: [...boxes.values()] };
}
