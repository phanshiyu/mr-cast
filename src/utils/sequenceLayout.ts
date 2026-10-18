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
    const next = messages.findIndex(
      (m, j) => j > span.start && indexOf.get(m.from) === span.participant && m.from !== m.to,
    );
    spans.push({ ...span, end: next === -1 ? messages.length - 1 : next, open: next === -1 });
  }
  return spans.sort((a, b) => a.start - b.start || a.participant - b.participant);
}

/**
 * Fits a message label in a chip `width` wide. It shrinks to keep one line, then wraps onto two at the
 * largest font that fits `room`, the height its row leaves it; failing that, onto up to three lines at
 * the row's font, and the row grows to hold them.
 */
function fitLabel(text: string, width: number, room: number, max: number, path: string): Fit {
  const textW = width - CHIP_PAD_X * 2;
  const min = SLOTS.messageLabel.min;
  const slot = { ...SLOTS.messageLabel, size: max, min, oneLineMin: undefined, width: textW };
  const one = fitText(text, { ...slot, lines: 1 }, path);
  if (one.fits) return one;
  const tallest = Math.floor((room - 2 * CHIP_PAD_Y) / (2 * LABEL_LINE_HEIGHT));
  const two = tallest >= min ? fitText(text, { ...slot, size: Math.min(max, tallest), lines: 2 }, path) : null;
  return two?.fits ? two : fitText(text, slot, path);
}

/** A label chip's width and height: its text and padding. */
const chipWidth = (fit: Fit) => fit.width + CHIP_PAD_X * 2;
const chipHeight = (fit: Fit) => fit.lines.length * fit.size * LABEL_LINE_HEIGHT + 2 * CHIP_PAD_Y + 2;

/** Width of a note's text: its card less padding, border and icon; and its height. */
const NOTE_CHROME = 24 + 2 + 17 + 8;
const noteHeight = (fit: Fit) => fit.height + 10 + 2;
/** Room kept between a row's note and the rows around it. */
const NOTE_CLEAR = 12;
/** How far a label may rise into the row above, as a share of a row. */
const LABEL_RISE = 0.2;

/** Rows a short sequence takes are at least this tall; past what fits the frame, the scene scrolls. */
const MIN_UNIT = 46;

/**
 * Lays a sequence out at a readable size. Rows share the frame's height down to MIN_UNIT and grow to
 * hold a label or note that wraps; a sequence taller than the frame keeps that spacing, and the scene
 * scrolls it under its pinned participants.
 */
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
  const totalWeight = Math.max(
    1,
    weights.reduce((a, b) => a + b, 0),
  );
  const unit = Math.max(MIN_UNIT, Math.min(MAX_UNIT, (box.height - rowsTop - BOTTOM_PAD) / totalWeight));
  const baseFont = Math.round(Math.max(17, Math.min(24, unit * 0.36)));
  /** A label may rise from its arrow to just short of the arrow in the row above. */
  const labelRoom = (1 - 0.28 + LABEL_RISE) * unit - LABEL_GAP;

  const spans = pairActivations(messages, indexOf);
  const covering = (p: number, row: number) =>
    spans.filter((s) => s.participant === p && s.start <= row && s.end >= row).length;
  /** Where an arrow leaves or reaches a lifeline: the outer edge of its activation bars, if any. */
  const edgeX = (p: number, row: number, dir: 1 | -1) => {
    const depth = covering(p, row);
    if (depth === 0) return xs[p]!;
    return dir > 0 ? xs[p]! + (depth - 1) * BAR_STEP + BAR_W / 2 : xs[p]! - BAR_W / 2;
  };

  // Across first: where each arrow runs and its label and note sit, and the height each needs.
  const across = messages.map((m, i) => {
    const kind = m.kind ?? 'call';
    const at = allMessages.indexOf(m);
    const path = `messages[${at}].label`;
    const from = indexOf.get(m.from)!;
    const to = indexOf.get(m.to)!;
    let label: Omit<PlacedLabel, 'y'>;
    let occupied: [number, number];
    let geometry:
      | { self: true; x: number; depth: number; start: number; tip: number; loopX: number }
      | { self: false; x1: number; x2: number };
    if (from === to) {
      const x = xs[from]!;
      const depth = covering(from, i);
      const start = edgeX(from, i, 1);
      const tip = x + depth * BAR_STEP + BAR_W / 2;
      const loopX = Math.max(start, tip) + LOOP_W;
      const rightRoom = width - (loopX + 12);
      const leftRoom = x - BAR_W - 8;
      const want = chipWidth(
        fitText(
          m.label,
          { ...SLOTS.messageLabel, size: baseFont, min: baseFont, oneLineMin: undefined, lines: 1, width: Infinity },
          path,
        ),
      );
      const onRight = rightRoom >= Math.min(want, colW * 0.9) || rightRoom >= leftRoom;
      const maxWidth = Math.min(onRight ? rightRoom : leftRoom, Math.max(colW * 0.9, want));
      const text = fitLabel(m.label, maxWidth, labelRoom, baseFont, path);
      const used = Math.min(maxWidth, chipWidth(text));
      label = onRight
        ? { x: loopX + 12, align: 'left', maxWidth, text }
        : { x: leftRoom, align: 'right', maxWidth, text };
      occupied = onRight ? [x - BAR_W, loopX + 12 + used] : [leftRoom - used, loopX];
      geometry = { self: true, x, depth, start, tip, loopX };
    } else {
      const dir = to > from ? 1 : -1;
      const x1 = edgeX(from, i, dir);
      const x2 = edgeX(to, i, dir === 1 ? -1 : 1);
      const span = Math.abs(x2 - x1) - 12;
      label = {
        x: (x1 + x2) / 2,
        align: 'center',
        maxWidth: span,
        text: fitLabel(m.label, span, labelRoom, baseFont, path),
      };
      occupied = [Math.min(x1, x2), Math.max(x1, x2)];
      geometry = { self: false, x1, x2 };
    }
    let note: Omit<PlacedNote, 'y'> | null = null;
    if (m.note) {
      const left = occupied[0] - NOTE_GAP;
      const right = width - (occupied[1] + NOTE_GAP);
      const side = right >= left ? 'right' : 'left';
      const maxWidth = Math.min(NOTE_MAX_W, Math.max(left, right));
      const slot = { ...SLOTS.messageNote, width: maxWidth - NOTE_CHROME };
      const usual = fitText(m.note, { ...slot, lines: weights[i]! * unit >= 62 ? 2 : 1 }, `messages[${at}].note`);
      note = {
        x: side === 'right' ? occupied[1] + NOTE_GAP : occupied[0] - NOTE_GAP,
        side,
        maxWidth,
        text: usual.fits ? usual : fitText(m.note, { ...slot, lines: 3 }, `messages[${at}].note`),
      };
    }
    // Down a row: a plain arrow sits 0.72 of a row down with its label above it; a self-call starts 0.3
    // down and loops 0.6 further, its label beside the loop. A tall label or note pushes the arrow down
    // and the row's end with it.
    const labelH = chipHeight(label.text);
    const noteH = note ? noteHeight(note.text) + NOTE_CLEAR : 0;
    const base = weights[i]! * unit;
    let arrow: number;
    let height: number;
    if (geometry.self) {
      const mid = Math.max(0.6 * unit, labelH / 2 - LABEL_RISE * unit, noteH / 2);
      arrow = mid - 0.3 * unit;
      height = Math.max(base, mid + Math.max(labelH, noteH) / 2 + 0.1 * unit);
    } else {
      arrow = Math.max(0.72 * unit, labelH + LABEL_GAP - LABEL_RISE * unit);
      height = Math.max(base, arrow + 0.28 * unit, noteH);
    }
    return { message: m, kind, from, to, label, note, geometry, arrow, height };
  });

  const rowTops: number[] = [];
  across.reduce((top, row) => (rowTops.push(top), top + row.height), rowsTop);
  const arrowY = across.map((row, i) => rowTops[i]! + row.arrow);

  const activations: PlacedActivation[] = spans.map((s) => {
    const depth = spans.filter((o) => o.participant === s.participant && o.start < s.start && o.end >= s.start).length;
    return {
      x: xs[s.participant]! + depth * BAR_STEP,
      y0: arrowY[s.start]!,
      y1: arrowY[s.end]! + (s.open ? 16 : 0),
      opener: s.start,
    };
  });

  const placed: PlacedMessage[] = across.map((row, i) => {
    const top = rowTops[i]!;
    const bottom = top + row.height;
    const y = arrowY[i]!;
    const g = row.geometry;
    let points: Pt[];
    let label: PlacedLabel;
    if (g.self) {
      const yEnd = y + 0.6 * unit;
      points = [
        { x: g.start, y },
        { x: g.loopX, y },
        { x: g.loopX, y: yEnd },
        { x: g.tip, y: yEnd },
      ];
      activations.push({ x: g.x + g.depth * BAR_STEP, y0: yEnd - 8, y1: yEnd + 14, opener: i });
      label = { ...row.label, y: (y + yEnd) / 2 };
    } else {
      points = [
        { x: g.x1, y },
        { x: g.x2, y },
      ];
      label = { ...row.label, y: y - LABEL_GAP };
    }
    const note = row.note ? { ...row.note, y: g.self ? label.y : (top + bottom) / 2 } : null;
    return { message: row.message, kind: row.kind, self: g.self, top, bottom, points, label, note };
  });

  const rowsEnd = rowTops.length ? rowTops[rowTops.length - 1]! + across[across.length - 1]!.height : rowsTop + unit;
  return {
    width,
    height: rowsEnd + BOTTOM_PAD,
    colW,
    cardW,
    cardTop: CARD_TOP,
    lifelineTop,
    participants: participants.map((participant, i) => ({ participant, x: xs[i]! })),
    texts: cardTexts(participants, cardW, CARD_H, cardW < 290 ? 'compact' : 'small', (i) => `participants[${i}]`, {
      shared: false,
    }),
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

/** The scale a sequence draws at in `box`. It keeps its rows readable: it scales only to fit across, and scrolls when it is taller than the frame. */
export function sequenceScale(layout: SequenceLayout, box: { width: number; height: number }): number {
  const across = Math.min(1, box.width / layout.width);
  return layout.height <= box.height / across ? Math.min(across, box.height / layout.height) : across;
}
