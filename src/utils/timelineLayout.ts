import type { TimelineEvent, TimelineScene, TimelineSpan } from '../types';
import { formatValue, niceTicks } from './chartLayout';
import { fitText, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { Box, LayoutBoxes } from './penGeometry';

export const LABEL_FONT = 23;
export const DETAIL_FONT = 19;
export const STAMP_FONT = 17;
const STAMP_LINE = 24;
const BOX_PAD_X = 18;
const BOX_PAD_Y = 12;
const BOX_MAX_W = 330;
const BOX_MIN_W = 120;
const BOX_GAP = 14;
const SIDE_PAD = 40;
/** Space between the axis and the row of event cards, crossed by each event's stem. */
const STEM_MIN = 34;
/** The same space when a card had to move off its event, so the leader has room to bend. */
const STEM_LEAD = 96;
/** Height of a leader's straight rise from the axis, and of its straight drop into the card. */
const LEAD_STRAIGHT = 18;
const TICK_ZONE = 44;
export const SPAN_H = 44;
const SPAN_GAP = 14;

export interface PlacedEvent {
  event: TimelineEvent;
  index: number;
  x: number;
  stamp: string;
  label: Fit;
  detail: Fit | null;
  box: { x: number; y: number; w: number; h: number };
  /**
   * The leader from the event's dot on the axis to the bottom of its card, as points from the dot up. Straight
   * when the card sits over its event. Every bend is at the same two heights and the cards keep the events'
   * order, so no two leaders cross.
   */
  stem: { x: number; y: number }[];
}

export interface PlacedSpan {
  span: TimelineSpan;
  x0: number;
  x1: number;
  y: number;
  /** Its label, inside the bar when it fits there, else beside it. */
  label: Fit;
  inside: boolean;
}

export interface TimelineLayout {
  axisY: number;
  x: (v: number) => number;
  ticks: { x: number; text: string }[];
  events: PlacedEvent[];
  spans: PlacedSpan[];
  width: number;
  height: number;
}

/** Room a span keeps inside its bar around its label. */
const SPAN_PAD = 24;

/** Caps the widest cards at one width, so the row of cards fits in `room`. No card goes under BOX_MIN_W. */
function capWidths(wanted: number[], room: number): number[] {
  if (wanted.reduce((a, b) => a + b, 0) <= room) return wanted;
  const sorted = [...wanted].sort((a, b) => a - b);
  let cap = BOX_MIN_W;
  let below = 0;
  for (let i = 0; i < sorted.length; i++) {
    const even = (room - below) / (sorted.length - i);
    if (even <= sorted[i]!) {
      cap = even;
      break;
    }
    below += sorted[i]!;
  }
  return wanted.map((w) => Math.max(BOX_MIN_W, Math.min(w, cap)));
}

/**
 * Lays boxes in one row in their given order, `gap` apart and inside 0..width, each as near its wanted left
 * edge as the others allow. Boxes that would overlap join a cluster, which centers on its boxes' wishes.
 */
export function packRow(items: { want: number; w: number }[], gap: number, width: number): number[] {
  type Cluster = { first: number; last: number; left: number; w: number; wish: number };
  const clusters: Cluster[] = [];
  const place = (c: Cluster) => {
    c.left = Math.max(0, Math.min(width - c.w, c.wish / (c.last - c.first + 1)));
  };
  items.forEach((item, i) => {
    const c: Cluster = { first: i, last: i, left: 0, w: item.w, wish: item.want };
    place(c);
    clusters.push(c);
    for (let prev = clusters[clusters.length - 2]; prev && prev.left + prev.w + gap > clusters[clusters.length - 1]!.left; prev = clusters[clusters.length - 2]) {
      const next = clusters.pop()!;
      // Each box wishes for the cluster's left edge to sit at its own wanted left minus its offset in the cluster.
      const offset = prev.w + gap;
      prev.wish += next.wish - offset * (next.last - next.first + 1);
      prev.w += gap + next.w;
      prev.last = next.last;
      place(prev);
    }
  });
  const lefts: number[] = [];
  for (const c of clusters) {
    let at = c.left;
    for (let i = c.first; i <= c.last; i++) {
      lefts.push(at);
      at += items[i]!.w + gap;
    }
  }
  return lefts;
}

/** Puts each item in the first lane where it does not overlap the items already there, scanning left to right. */
function assignLanes<T>(items: T[], range: (item: T) => [number, number], gap: number): number[] {
  const ends: number[] = [];
  return items.map((item) => {
    const [a, b] = range(item);
    let lane = ends.findIndex((end) => a >= end + gap);
    if (lane < 0) lane = ends.length;
    ends[lane] = Math.max(ends[lane] ?? -Infinity, b);
    return lane;
  });
}

export function layoutTimeline(scene: TimelineScene, width: number): TimelineLayout {
  const spans = scene.spans ?? [];
  const points = [...scene.events.map((e) => e.at), ...spans.flatMap((s) => [s.from, s.to])];
  const ticks = niceTicks(Math.min(...points), Math.max(...points));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x0 = SIDE_PAD + 30;
  const x1 = width - SIDE_PAD - 30;
  const x = (v: number) => x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0);

  const order = scene.events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at - b.event.at || a.index - b.index);
  const wanted = order.map(({ event }) => {
    const one = (text: string, slot: typeof SLOTS.eventLabel) => fitText(text, sized(slot, Infinity), '').width;
    const stampW = measure(formatValue(event.at, scene.unit), { family: 'mono', weight: 700, size: STAMP_FONT }) * 1.2;
    const text = Math.max(one(event.label, SLOTS.eventLabel), event.detail ? one(event.detail, SLOTS.eventDetail) : 0, stampW);
    return Math.max(BOX_MIN_W, Math.min(BOX_MAX_W, text + 2 * BOX_PAD_X));
  });
  const widths = capWidths(wanted, width - BOX_GAP * Math.max(0, order.length - 1));
  const boxes = order.map(({ event, index }, i) => {
    const w = widths[i]!;
    const label = fitText(event.label, sized(SLOTS.eventLabel, w - 2 * BOX_PAD_X), `events[${index}].label`);
    const detail = event.detail ? fitText(event.detail, sized(SLOTS.eventDetail, w - 2 * BOX_PAD_X), `events[${index}].detail`) : null;
    const h = 2 * BOX_PAD_Y + STAMP_LINE + label.height + (detail?.height ?? 0);
    return { event, index, cx: x(event.at), stamp: formatValue(event.at, scene.unit), label, detail, w, h };
  });
  // One row of cards in the events' order, each as near its event as the cards beside it allow.
  const lefts = packRow(boxes.map((b) => ({ want: b.cx - b.w / 2, w: b.w })), BOX_GAP, width);
  const anchors = boxes.map((b, i) => Math.min(lefts[i]! + b.w - 2 * BOX_PAD_X, Math.max(lefts[i]! + 2 * BOX_PAD_X, b.cx)));
  const moved = boxes.some((b, i) => Math.abs(anchors[i]! - b.cx) > 0.5);
  const stemH = moved ? STEM_LEAD : STEM_MIN;
  const rowH = Math.max(0, ...boxes.map((b) => b.h));
  const axisY = rowH + stemH;
  const cardBottom = axisY - stemH;
  const events: PlacedEvent[] = boxes.map((b, i) => {
    const ax = anchors[i]!;
    const stem = Math.abs(ax - b.cx) <= 0.5
      ? [{ x: b.cx, y: axisY }, { x: b.cx, y: cardBottom }]
      : [{ x: b.cx, y: axisY }, { x: b.cx, y: axisY - LEAD_STRAIGHT }, { x: ax, y: cardBottom + LEAD_STRAIGHT }, { x: ax, y: cardBottom }];
    return { event: b.event, index: b.index, x: b.cx, stamp: b.stamp, label: b.label, detail: b.detail, box: { x: lefts[i]!, y: cardBottom - b.h, w: b.w, h: b.h }, stem };
  });

  const spanOrder = [...spans].sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  const fitted = spanOrder.map((span) => {
    const a = x(Math.min(span.from, span.to));
    const b = x(Math.max(span.from, span.to));
    const path = `spans[${spans.indexOf(span)}].label`;
    const within = fitText(span.label, { ...sized(SLOTS.spanLabel, b - a - SPAN_PAD), min: SLOTS.spanLabel.size }, path);
    // A label too long for its bar sits after it, so the next span in the lane must start past the label.
    const inside = within.fits;
    const label = inside ? within : fitText(span.label, sized(SLOTS.spanLabel, width - (b + 12)), path);
    const reach = inside ? b : b + SPAN_PAD + label.width;
    return { span, a, b, inside, label, reach };
  });
  // Spans that only touch, like consecutive waits, share a lane and read as one bar in segments.
  const spanLanes = assignLanes(fitted, (f) => [f.a, f.reach], -0.5);
  const spansTop = axisY + TICK_ZONE;
  const placedSpans: PlacedSpan[] = fitted.map((f, i) => ({ span: f.span, x0: f.a, x1: f.b, y: spansTop + spanLanes[i]! * (SPAN_H + SPAN_GAP), label: f.label, inside: f.inside }));
  const spanLaneCount = spans.length ? Math.max(...spanLanes) + 1 : 0;
  const height = spansTop + spanLaneCount * (SPAN_H + SPAN_GAP);

  return {
    axisY,
    x,
    ticks: ticks.map((t) => ({ x: x(t), text: formatValue(t, scene.unit) })),
    events,
    spans: placedSpans,
    width,
    height,
  };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: an event's
 * card and a span's bar. A note keeps off the cards, the bars, their labels and the axis.
 */
export function timelineBoxes(layout: TimelineLayout): LayoutBoxes {
  const card = (e: PlacedEvent): Box => ({ x: e.box.x, y: e.box.y, width: e.box.w, height: e.box.h });
  const bar = (s: PlacedSpan): Box => ({ x: s.x0, y: s.y, width: Math.max(8, s.x1 - s.x0), height: SPAN_H });
  const boxes = new Map<string, Box>([
    ...layout.events.map((e): [string, Box] => [`ev:${e.index}`, card(e)]),
    ...layout.spans.map((s, i): [string, Box] => [`sp:${i}`, bar(s)]),
  ]);
  const labels = layout.spans.flatMap((s) => (s.inside ? [] : [{ x: s.x1 + 12, y: s.y, width: s.label.width, height: SPAN_H }]));
  const axis = { x: 0, y: layout.axisY - 26, width: layout.width, height: 70 };
  return { boxes, obstacles: [...boxes.values(), ...labels, axis] };
}
