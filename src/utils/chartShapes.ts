import { fitText, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { ChartScene } from '../types';
import { chartStates, formatValue, labelTotal, VALUE_FONT, type ChartState } from './chartLayout';

/** Widest a series name runs in the legend. */
const LEGEND_NAME_W = 240;
const legendFits = (scene: ChartScene) =>
  scene.series.map((series, i) => fitText(series.name, sized(SLOTS.legend, LEGEND_NAME_W), `series[${i}].name`));
const valueStyle = (size: number) => ({ family: 'mono', weight: 700, size }) as const;

/** The value printed for each label in a state: its bar's, or a stack's total. */
const printedValues = (scene: ChartScene, state: ChartState) =>
  scene.stacked ? scene.labels.map((_, l) => labelTotal(state.values, l)) : state.values.flat();

/** A horizontal bar chart: labels in a column at the left, one row a label, each bar's value printed past its end. */
export interface BarRowsLayout {
  width: number;
  /** Width of the label column; bars start at `x0`. */
  labelW: number;
  x0: number;
  /** Length of the longest bar on screen, which the largest value fills. */
  barMax: number;
  rowH: number;
  /** Top of the first row. */
  top: number;
  /** Thickness of one bar, and the room between the bars of one row. */
  barH: number;
  barGap: number;
  labels: Fit[];
  labelFont: number;
  valueFont: number;
  legend: Fit[];
}

const ROW_MAX = 92;
const LABEL_GAP = 22;
const VALUE_GAP = 12;

export function layoutBarRows(scene: ChartScene, width: number, height: number): BarRowsLayout {
  const n = scene.labels.length;
  const k = scene.stacked ? 1 : scene.series.length;
  const rowH = Math.min(ROW_MAX, height / n);
  const top = Math.max(0, (height - rowH * n) / 2) * 0.3;
  const barGap = k > 1 ? 6 : 0;
  const barH = Math.min(60, (rowH * 0.74 - (k - 1) * barGap) / k);
  const valueFont = barH < 30 ? 17 : VALUE_FONT;
  const widest = Math.max(
    ...scene.labels.map((l) => fitText(l, sized({ ...SLOTS.chartLabel, lines: 1 }, Infinity), '').width),
  );
  const labelW = Math.round(Math.min(width * 0.28, Math.max(120, widest + LABEL_GAP)));
  const slot = { ...sized(SLOTS.chartLabel, labelW - LABEL_GAP), lines: 1 };
  const labelFont = Math.min(...scene.labels.map((l) => fitText(l, slot, '').size));
  const labels = scene.labels.map((l, i) => fitTextAt(l, slot, `labels[${i}]`, labelFont));
  const values = chartStates(scene).flatMap((state) => printedValues(scene, state));
  const valueW = Math.max(...values.map((v) => measure(formatValue(v, scene), valueStyle(valueFont))));
  const x0 = labelW;
  return {
    width,
    labelW,
    x0,
    barMax: Math.max(40, width - x0 - valueW - VALUE_GAP - 8),
    rowH,
    top,
    barH,
    barGap,
    labels,
    labelFont,
    valueFont,
    legend: legendFits(scene),
  };
}

/** Top of series `s`'s bar in the row whose top is `rowTop`; a stack's series share one bar. */
export function rowBarY(layout: BarRowsLayout, rowTop: number, s: number, k: number): number {
  const group = k * layout.barH + (k - 1) * layout.barGap;
  return rowTop + (layout.rowH - group) / 2 + s * (layout.barH + layout.barGap);
}

export const VALUE_PAD = VALUE_GAP;

/** A pie or donut at the left, and a legend of its slices at the right. */
export interface PieLayout {
  cx: number;
  cy: number;
  r: number;
  /** Radius of a donut's hole; 0 for a pie. */
  hole: number;
  legendX: number;
  legendTop: number;
  rowH: number;
  /** Each slice's label in the legend, at one shared size. */
  labels: Fit[];
  labelW: number;
  /** Width of the column of values and shares at the legend's right. */
  valueW: number;
  valueFont: number;
  /** The series name in a donut's hole, under its total. */
  centre: Fit | null;
}

const PIE_LEGEND_ROW = 64;
export const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const SWATCH = 24;
const SWATCH_GAP = 18;

/** "40%" or "120 ms · 40%": what the legend prints for a slice, a share alone when the unit is already one. */
export function sliceText(scene: ChartScene, value: number, total: number): string {
  const share = total > 0 ? (value / total) * 100 : 0;
  const pct = `${share >= 10 || share === 0 ? Math.round(share) : Math.round(share * 10) / 10}%`;
  return scene.unit === '%' ? formatValue(value, scene) : `${formatValue(value, scene)} · ${pct}`;
}

export function layoutPie(scene: ChartScene, width: number, height: number): PieLayout {
  const n = scene.labels.length;
  const r = Math.round(Math.min(height / 2 - 24, width * 0.24));
  const cx = Math.round(width * 0.27);
  const cy = Math.round(height / 2);
  const legendX = Math.round(cx + r + 110);
  const rowH = Math.min(PIE_LEGEND_ROW, height / n);
  const valueFont = rowH < 48 ? 18 : 21;
  const states = chartStates(scene);
  const valueW =
    Math.max(
      ...states.flatMap((state) =>
        state.values[0]!.map((v) => measure(sliceText(scene, v, sum(state.values[0]!)), valueStyle(valueFont))),
      ),
    ) + 8;
  const labelW = Math.max(60, width - legendX - SWATCH - SWATCH_GAP - valueW - 24);
  const slot = { ...sized(SLOTS.chartLabel, labelW), lines: 1 };
  const labelFont = Math.min(...scene.labels.map((l) => fitText(l, slot, '').size));
  const hole = scene.kind === 'donut' ? Math.round(r * 0.58) : 0;
  return {
    cx,
    cy,
    r,
    hole,
    legendX,
    legendTop: Math.round((height - rowH * n) / 2),
    rowH,
    labels: scene.labels.map((l, i) => fitTextAt(l, slot, `labels[${i}]`, labelFont)),
    labelW,
    valueW,
    valueFont,
    centre: hole
      ? fitText(scene.series[0]!.name, { ...sized(SLOTS.legend, hole * 1.6), lines: 2 }, 'series[0].name')
      : null,
  };
}

export const PIE_SWATCH = { size: SWATCH, gap: SWATCH_GAP };
