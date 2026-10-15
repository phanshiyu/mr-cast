import type { MessageKind, SequenceMessage, SequenceParticipant } from '../types';

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
const NOTE_MAX_W = 380;
/** Monospace advance per em, as in theme.ts, plus chip padding. */
const MONO_ADVANCE = 0.61;
const CHIP_PAD_X = 12;

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
  fontSize: number;
}

export interface PlacedNote {
  /** Vertical centre of the card, and the x of its edge nearest the arrow. */
  x: number;
  y: number;
  side: 'left' | 'right';
  maxWidth: number;
  lines: 1 | 2;
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

function monoWidth(text: string, fontSize: number): number {
  return text.length * fontSize * MONO_ADVANCE + CHIP_PAD_X * 2;
}

/** Largest font in [min, max] that fits `text` in `width`, so short spans shrink before they truncate. */
function fitLabelFont(text: string, width: number, min: number, max: number): number {
  const fit = Math.floor((width - CHIP_PAD_X * 2) / Math.max(1, text.length * MONO_ADVANCE));
  return Math.max(min, Math.min(max, fit));
}

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
  const cardW = Math.min(CARD_MAX_W, colW - 24);
  const xs = participants.map((_, i) => colW * (i + 0.5));
  const lifelineTop = CARD_TOP + CARD_H;
  const rowsTop = lifelineTop + ROWS_GAP;

  const isSelf = (m: SequenceMessage) => m.from === m.to;
  const weights = messages.map((m) => (isSelf(m) ? SELF_WEIGHT : 1));
  const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));
  const unit = Math.min(MAX_UNIT, (box.height - rowsTop - BOTTOM_PAD) / totalWeight);
  const baseFont = Math.round(Math.max(17, Math.min(24, unit * 0.36)));
  const noteLines: 1 | 2 = unit >= 70 ? 2 : 1;

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
      const font = baseFont;
      const want = monoWidth(m.label, font);
      const onRight = rightRoom >= Math.min(want, colW * 0.9) || rightRoom >= leftRoom;
      const maxWidth = Math.min(onRight ? rightRoom : leftRoom, Math.max(colW * 0.9, want));
      const labelFont = fitLabelFont(m.label, maxWidth, 15, font);
      const used = Math.min(maxWidth, monoWidth(m.label, labelFont));
      label = onRight
        ? { x: loopX + 12, y: (y + yEnd) / 2, align: 'left', maxWidth, fontSize: labelFont }
        : { x: leftRoom, y: (y + yEnd) / 2, align: 'right', maxWidth, fontSize: labelFont };
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
        fontSize: fitLabelFont(m.label, span, 15, baseFont),
      };
      occupied = [Math.min(x1, x2), Math.max(x1, x2)];
    }

    let note: PlacedNote | null = null;
    if (m.note) {
      const left = occupied[0] - NOTE_GAP;
      const right = width - (occupied[1] + NOTE_GAP);
      const side = right >= left ? 'right' : 'left';
      note = {
        x: side === 'right' ? occupied[1] + NOTE_GAP : occupied[0] - NOTE_GAP,
        y: from === to ? label.y : (top + bottom) / 2,
        side,
        maxWidth: Math.min(NOTE_MAX_W, Math.max(left, right)),
        lines: noteLines,
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
    messages: placed,
    activations,
  };
}
