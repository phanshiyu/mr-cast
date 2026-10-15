import type { TimelineEvent, TimelineScene, TimelineSpan } from '../types';
import { formatValue, niceTicks } from './chartLayout';
import { wrapLabel } from './wrapLabel';

export const LABEL_FONT = 23;
export const DETAIL_FONT = 19;
export const STAMP_FONT = 17;
const LABEL_LINE = 30;
const DETAIL_LINE = 25;
const STAMP_LINE = 24;
const BOX_PAD_X = 18;
const BOX_PAD_Y = 12;
const BOX_MAX_W = 330;
const BOX_MIN_W = 120;
const LANE_GAP = 18;
const SIDE_PAD = 40;
/** Space between the axis and the first lane of event boxes, crossed by each event's stem. */
const STEM_MIN = 34;
export const TICK_ZONE = 44;
export const SPAN_H = 44;
const SPAN_GAP = 14;
const LANES_MAX = 4;

export interface PlacedEvent {
  event: TimelineEvent;
  index: number;
  x: number;
  stamp: string;
  label: string[];
  detail: string[];
  box: { x: number; y: number; w: number; h: number };
}

export interface PlacedSpan {
  span: TimelineSpan;
  x0: number;
  x1: number;
  y: number;
  /** Label text, cut to fit inside the bar; drawn beside it when the bar is too narrow. */
  label: string;
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

const textW = (chars: number, font: number) => chars * font * 0.5;

/** Puts each item in the first lane where it does not overlap the items already there, scanning left to right. */
function assignLanes<T>(items: T[], range: (item: T) => [number, number], gap: number, maxLanes = Infinity): number[] {
  const ends: number[] = [];
  return items.map((item) => {
    const [a, b] = range(item);
    let lane = ends.findIndex((end) => a >= end + gap);
    if (lane < 0) lane = ends.length < maxLanes ? ends.length : ends.indexOf(Math.min(...ends));
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
  const boxes = order.map(({ event, index }) => {
    const stamp = formatValue(event.at, scene.unit);
    const wanted = Math.max(textW(event.label.length, LABEL_FONT), textW((event.detail ?? '').length, DETAIL_FONT), textW(stamp.length, STAMP_FONT) * 1.2);
    const w = Math.max(BOX_MIN_W, Math.min(BOX_MAX_W, wanted + 2 * BOX_PAD_X));
    const label = wrapLabel(event.label, Math.floor((w - 2 * BOX_PAD_X) / (LABEL_FONT * 0.5)));
    const detail = event.detail ? wrapLabel(event.detail, Math.floor((w - 2 * BOX_PAD_X) / (DETAIL_FONT * 0.5))) : [];
    const h = 2 * BOX_PAD_Y + STAMP_LINE + label.length * LABEL_LINE + detail.length * DETAIL_LINE;
    const cx = x(event.at);
    const left = Math.min(width - w, Math.max(0, cx - w / 2));
    return { event, index, cx, stamp, label, detail, w, h, left };
  });
  const lanes = assignLanes(boxes, (b) => [b.left, b.left + b.w], 14, LANES_MAX);
  const laneCount = Math.max(0, ...lanes) + 1;
  const laneH = Array.from({ length: laneCount }, (_, l) => Math.max(...boxes.filter((_, i) => lanes[i] === l).map((b) => b.h)));
  const eventsH = laneH.reduce((a, b) => a + b + LANE_GAP, 0);
  const axisY = eventsH + STEM_MIN;
  // Lane 0 sits nearest the axis; each further lane stacks above it.
  const laneBottom = (l: number) => axisY - STEM_MIN - laneH.slice(0, l).reduce((a, b) => a + b + LANE_GAP, 0);
  const events: PlacedEvent[] = boxes.map((b, i) => ({
    event: b.event,
    index: b.index,
    x: b.cx,
    stamp: b.stamp,
    label: b.label,
    detail: b.detail,
    box: { x: b.left, y: laneBottom(lanes[i]!) - b.h, w: b.w, h: b.h },
  }));

  const spanOrder = [...spans].sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  // Spans that only touch, like consecutive waits, share a lane and read as one bar in segments.
  const spanLanes = assignLanes(spanOrder, (s) => [x(Math.min(s.from, s.to)), x(Math.max(s.from, s.to))], -0.5);
  const spansTop = axisY + TICK_ZONE;
  const placedSpans: PlacedSpan[] = spanOrder.map((span, i) => {
    const a = x(Math.min(span.from, span.to));
    const b = x(Math.max(span.from, span.to));
    const chars = Math.floor((b - a - 24) / (DETAIL_FONT * 0.52));
    const inside = chars >= Math.min(span.label.length, 8);
    const label = inside && span.label.length > chars ? `${span.label.slice(0, chars - 1).trimEnd()}…` : span.label;
    return { span, x0: a, x1: b, y: spansTop + spanLanes[i]! * (SPAN_H + SPAN_GAP), label, inside };
  });
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
