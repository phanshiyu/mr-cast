// Where each item of a chart is at each step, for its pen, its camera and `validate`: every kind of chart, at the
// values and order each step settles on.

import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { headerBox } from '../fit/shell';
import type { ChartScene } from '../types';
import { ANNOTATION_BAND, barX, chartOrder, chartStateOf, formatValue, labelTotal, layoutChart, shownBetween, valuesBetween, VALUE_FONT, withValues, type ChartLayout } from './chartLayout';
import { layoutBarRows, layoutPie, rowBarY, sum, VALUE_PAD, type BarRowsLayout, type PieLayout } from './chartShapes';
import { areaOf, union, type Box, type MarkTargets } from './penGeometry';
import type { StateFrame } from './stateTrack';

export const BADGE_H = 34;

export const showsBadges = (scene: ChartScene) => scene.series.length === 2 && scene.badges !== false && !scene.stacked;

/** The top of the labels above a slot's highest value, where its change badge sits. */
export function slotTop(scene: ChartScene, layout: ChartLayout, i: number): number {
  const valueH = VALUE_FONT * 1.25 + 14;
  if (scene.kind === 'line') {
    const [a, b] = [scene.series[0]!.values[i]!, scene.series[1]!.values[i]!];
    return layout.y(Math.max(a, b)) - valueH - 10;
  }
  return layout.y(scene.stacked ? labelTotal(scene.series.map((s) => s.values), i) : Math.max(...scene.series.map((s) => s.values[i]!))) - valueH - 6;
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs: a value's number and the top
 * of its bar or its point, a label's text, a series' values together. A note keeps off the bars, the
 * numbers, the labels, the change badges and the annotation.
 */
function chartTargets(scene: ChartScene, layout: ChartLayout, size: { width: number; height: number }): MarkTargets {
  const font = scene.kind === 'bar' && layout.barW < 64 ? 17 : VALUE_FONT;
  const valueH = font * 1.25 + 14;
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  const lines = scene.kind === 'line' ? scene.series.flatMap((s) => s.values.slice(1).flatMap((v, i) => Array.from({ length: 8 }, (_, t) => ({ x: layout.xs[i]! + ((layout.xs[i + 1]! - layout.xs[i]!) * t) / 8, y: layout.y(s.values[i]!) + ((layout.y(v) - layout.y(s.values[i]!)) * t) / 8 })))) : [];
  scene.series.forEach((series, s) =>
    series.values.forEach((v, l) => {
      const below = scene.stacked ? labelTotal(scene.series.slice(0, s).map((o) => o.values), l) : 0;
      const top = layout.y(below + v);
      const value =
        scene.kind === 'bar'
          ? scene.stacked
            ? { x: barX(layout, layout.xs[l]!, s, 1, true) - 6, y: top - (s === scene.series.length - 1 ? valueH : 0), width: layout.barW + 12, height: layout.y(below) - top + (s === scene.series.length - 1 ? valueH : 0) }
            : { x: barX(layout, layout.xs[l]!, s, scene.series.length) - 6, y: top - valueH, width: layout.barW + 12, height: valueH + Math.min(40, layout.plot.y1 - top) }
          : { x: layout.xs[l]! - 34, y: top - valueH, width: 68, height: valueH + 16 };
      boxes.set(`p:${s}/${l}`, value);
      obstacles.push(scene.kind === 'bar' ? { x: value.x, y: value.y, width: value.width, height: layout.plot.y1 - value.y } : value);
    }),
  );
  scene.labels.forEach((_, i) => {
    const text = layout.xLabels[i]!;
    const width = Math.min(layout.slotW, text.width + 8);
    const label = { x: layout.xs[i]! - width / 2, y: layout.xLabelTop - 4, width, height: text.lines.length * layout.xLabelFont * 1.3 + 8 };
    boxes.set(`l:${i}`, label);
    obstacles.push(label);
    if (showsBadges(scene)) obstacles.push({ x: layout.xs[i]! - 60, y: slotTop(scene, layout, i) - BADGE_H, width: 120, height: BADGE_H });
  });
  scene.series.forEach((_, s) => boxes.set(`s:${s}`, union(scene.labels.map((__, l) => boxes.get(`p:${s}/${l}`)))!));
  if (scene.annotation) obstacles.push({ x: layout.plot.x0, y: 0, width: layout.plot.x1 - layout.plot.x0, height: ANNOTATION_BAND });
  return { boxes, obstacles, lines, area: areaOf(size) };
}

/** The chart as the step at `frame` shows it: its values partway to the step's, and each label's slot sliding to its place. */
export function chartAt(source: ChartScene, base: ChartLayout, f: StateFrame): { scene: ChartScene; layout: ChartLayout; shown: number[][] } {
  const [before, now] = [chartStateOf(source, f.before), chartStateOf(source, f.now)];
  const scene = withValues(source, valuesBetween(before.values, now.values, f.t));
  const [from, to] = [chartOrder(source, before.values, before.sort), chartOrder(source, now.values, now.sort)];
  const xs = source.labels.map((_, i) => base.xs[from[i]!]! + (base.xs[to[i]!]! - base.xs[from[i]!]!) * f.t);
  return { scene, layout: { ...base, xs }, shown: shownBetween(before.values, now.values, f.t) };
}

/** Where a step leaves the chart: values partway from the step's start to its own, and each label's place in the order. */
export function framed(scene: ChartScene, f: StateFrame) {
  const [before, now] = [chartStateOf(scene, f.before), chartStateOf(scene, f.now)];
  const values = valuesBetween(before.values, now.values, f.t);
  const shown = shownBetween(before.values, now.values, f.t);
  const [from, to] = [chartOrder(scene, before.values, before.sort), chartOrder(scene, now.values, now.sort)];
  return { before, now, values, shown, from, to, place: (i: number) => from[i]! + (to[i]! - from[i]!) * f.t };
}

export const settledFrame = (state: SceneState): StateFrame => ({ before: state, now: state, t: 1, lit: 0 });

/** Angles are radians clockwise from twelve o'clock. */
export const point = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;

/** The box around a wedge, from points along its arcs. */
function wedgeBox(layout: PieLayout, from: number, to: number): Box {
  const steps = 16;
  const pts = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps).flatMap((a) => [point(layout.cx, layout.cy, layout.r, a), point(layout.cx, layout.cy, layout.hole, a)]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Each slice's start angle, clockwise from the top in the given order, and its sweep. */
export function sliceAngles(values: readonly number[], order: readonly number[]): { from: number; span: number }[] {
  const total = sum(values) || 1;
  const byPlace = values.map((_, i) => i).sort((a, b) => order[a]! - order[b]!);
  const out = new Array<{ from: number; span: number }>(values.length);
  let at = 0;
  for (const i of byPlace) {
    const span = (values[i]! / total) * Math.PI * 2;
    out[i] = { from: at, span };
    at += span;
  }
  return out;
}

/** Each row's bars and value, by item key, as a step leaves them; a note keeps off the labels, bars and values. */
function rowTargets(scene: ChartScene, layout: BarRowsLayout, values: number[][], place: (i: number) => number, box: { width: number; height: number }): MarkTargets {
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  const k = scene.stacked ? 1 : scene.series.length;
  const longest = Math.max(1e-9, ...scene.labels.map((_, l) => (scene.stacked ? labelTotal(values, l) : Math.max(...values.map((row) => row[l]!)))));
  scene.labels.forEach((_, l) => {
    const top = layout.top + place(l) * layout.rowH;
    const label = layout.labels[l]!;
    const labelBox = { x: layout.labelW - 18 - label.width, y: top + (layout.rowH - label.height) / 2, width: label.width, height: label.height };
    boxes.set(`l:${l}`, labelBox);
    obstacles.push(labelBox);
    let run = 0;
    scene.series.forEach((_, s) => {
      const v = values[s]![l]!;
      const x = layout.x0 + (scene.stacked ? (run / longest) * layout.barMax : 0);
      const w = (v / longest) * layout.barMax;
      run += v;
      const valueW = (scene.stacked && s < scene.series.length - 1 ? 0 : formatValue(scene.stacked ? labelTotal(values, l) : v, scene.unit).length * layout.valueFont * 0.62) + VALUE_PAD;
      const bar = { x, y: rowBarY(layout, top, scene.stacked ? 0 : s, k), width: Math.max(8, w) + valueW, height: layout.barH };
      boxes.set(`p:${s}/${l}`, bar);
      obstacles.push(bar);
    });
  });
  scene.series.forEach((_, s) => boxes.set(`s:${s}`, union(scene.labels.map((__, l) => boxes.get(`p:${s}/${l}`)))!));
  return { boxes, obstacles, area: areaOf(box) };
}

/** Each slice and its legend row, by item key, where `state` leaves them. */
function pieTargets(scene: ChartScene, layout: PieLayout, at: SceneState, box: { width: number; height: number }): MarkTargets {
  const state = chartStateOf(scene, at);
  const settled = sliceAngles(state.values[0]!, chartOrder(scene, state.values, state.sort));
  const order = chartOrder(scene, state.values, state.sort);
  const boxes = new Map<string, Box>();
  scene.labels.forEach((_, i) => {
    const wedgeAt = wedgeBox(layout, settled[i]!.from, settled[i]!.from + settled[i]!.span);
    const row = { x: layout.legendX, y: layout.legendTop + order[i]! * layout.rowH + 6, width: box.width - layout.legendX, height: layout.rowH - 12 };
    boxes.set(`l:${i}`, wedgeAt);
    boxes.set(`p:0/${i}`, wedgeAt);
    boxes.set(`x:${i}`, row);
  });
  boxes.set('s:0', { x: layout.cx - layout.r, y: layout.cy - layout.r, width: 2 * layout.r, height: 2 * layout.r });
  return { boxes, obstacles: [boxes.get('s:0')!, ...scene.labels.map((_, i) => boxes.get(`x:${i}`)!)], area: areaOf(box) };
}

/** Each step's item boxes as its values settle, for a column, line, horizontal, pie or donut chart. */
export function chartStepTargets(scene: ChartScene): MarkTargets[] {
  const box = headerBox(scene);
  const steps = sceneStates(scene).slice(1);
  if (scene.kind === 'pie' || scene.kind === 'donut') {
    const layout = layoutPie(scene, box.width, box.height);
    return steps.map((state) => pieTargets(scene, layout, state, box));
  }
  if (scene.horizontal) {
    const layout = layoutBarRows(scene, box.width, box.height);
    return steps.map((state) => {
      const settled = framed(scene, settledFrame(state));
      return rowTargets(scene, layout, settled.values, settled.place, box);
    });
  }
  const base = layoutChart(scene, box.width, box.height);
  return steps.map((state) => {
    const settled = chartAt(scene, base, settledFrame(state));
    return chartTargets(settled.scene, settled.layout, box);
  });
}
