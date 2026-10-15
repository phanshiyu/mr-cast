import type { ChartScene } from '../types';
import { wrapLabel } from './wrapLabel';

const MINUS = '−';
/** Units that sit against the number rather than after a space. */
const TIGHT_UNITS = new Set(['%', 'x', '×', '°']);

function trimmed(v: number, digits: number): string {
  return Number(v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "1,250 ms", "3.4M req/s", "12%": three significant digits, thousands grouped, big numbers compacted. */
export function formatValue(v: number, unit: string | undefined): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  let text: string;
  if (abs >= 1e9) text = `${trimmed(abs / 1e9, 3)}B`;
  else if (abs >= 1e6) text = `${trimmed(abs / 1e6, 3)}M`;
  else if (abs >= 1e4) text = `${trimmed(abs / 1e3, 3)}k`;
  else text = Number.isInteger(abs) ? abs.toLocaleString('en-US') : trimmed(abs, 3);
  if (!unit) return sign + text;
  return sign + text + (TIGHT_UNITS.has(unit) ? '' : ' ') + unit;
}

function ticksOf(lo: number, span: number, count: number): number[] {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t < lo + span + step - step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
}

/** Round ticks covering [min, max] from zero or below, with 3 to 6 intervals, whichever wastes least room above the top value. */
export function niceTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min);
  const span = max > lo ? max - lo : 1;
  const options = [4, 5, 3, 6].map((count) => ticksOf(lo, span, count));
  const waste = (ticks: number[]) => ticks[ticks.length - 1]! - (lo + span);
  return options.reduce((best, t) => (waste(t) < waste(best) - span * 0.02 ? t : best));
}

export type Direction = 'good' | 'bad' | 'neutral';

/** The change from `a` to `b` as a badge: "−42%", or "×3.1" past a tripling. Null when `a` is 0. */
export function delta(a: number, b: number, better: ChartScene['better']): { text: string; direction: Direction } | null {
  if (a === 0) return null;
  const pct = ((b - a) / Math.abs(a)) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const text = pct >= 200 ? `×${trimmed(b / a, 2)}` : rounded === 0 ? '±0%' : `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded)}%`;
  if (rounded === 0 || !better) return { text, direction: 'neutral' };
  const improved = better === 'lower' ? pct < 0 : pct > 0;
  return { text, direction: improved ? 'good' : 'bad' };
}

const X_LABEL_FONTS = [22, 20, 18];
const TICK_CHAR_W = 10.5;
/** Room above the highest value for its label and a change badge. */
const HEADROOM = 84;
export const ANNOTATION_BAND = 112;
const PLOT_RIGHT_PAD = 24;

export interface ChartLayout {
  plot: { x0: number; x1: number; y0: number; y1: number };
  /** Width of the tick labels left of the plot. */
  axisW: number;
  xLabelFont: number;
  /** Top of the x labels: lower under a two-series line, whose lower values label below their points. */
  xLabelTop: number;
  ticks: number[];
  /** Screen y of a value. */
  y: (v: number) => number;
  /** Centre x of each label's slot. */
  xs: number[];
  slotW: number;
  /** Width of one bar; 0 for a line chart. */
  barW: number;
  barGap: number;
  xLabels: string[][];
}

export function layoutChart(scene: ChartScene, width: number, height: number): ChartLayout {
  const values = scene.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const n = scene.labels.length;
  const axisW = Math.max(...ticks.map((t) => formatValue(t, scene.unit).length)) * TICK_CHAR_W + 30;
  const x0 = axisW;
  const x1 = width - PLOT_RIGHT_PAD;
  const slotW = (x1 - x0) / n;
  // The largest font at which every label fits on two lines without a cut.
  let xLabelFont = X_LABEL_FONTS[0]!;
  let xLabels: string[][] = [];
  for (const font of X_LABEL_FONTS) {
    const chars = Math.max(6, Math.floor((slotW - 12) / (font * 0.5)));
    xLabels = scene.labels.map((l) => wrapLabel(l, chars));
    xLabelFont = font;
    if (xLabels.every((lines, i) => !lines[lines.length - 1]!.endsWith('…') || scene.labels[i]!.trim().endsWith('…'))) break;
  }
  const labelLines = Math.max(...xLabels.map((l) => l.length));
  const belowLabels = scene.kind === 'line' && scene.series.length === 2 ? 36 : 0;
  const y0 = (scene.annotation ? ANNOTATION_BAND : 0) + HEADROOM;
  const y1 = height - 18 - belowLabels - labelLines * Math.round(xLabelFont * 1.3);
  const k = scene.series.length;
  const barGap = k > 1 ? 10 : 0;
  const barW = scene.kind === 'bar' ? Math.min(150, (slotW * 0.72 - (k - 1) * barGap) / k) : 0;
  return {
    plot: { x0, x1, y0, y1 },
    axisW,
    xLabelFont,
    xLabelTop: y1 + 14 + belowLabels,
    ticks,
    y: (v) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0),
    xs: scene.labels.map((_, i) => x0 + slotW * (i + 0.5)),
    slotW,
    barW,
    barGap,
    xLabels,
  };
}

/** Left edge of series `s`'s bar in a slot centred on `cx`. */
export function barX(layout: ChartLayout, cx: number, s: number, seriesCount: number): number {
  const group = seriesCount * layout.barW + (seriesCount - 1) * layout.barGap;
  return cx - group / 2 + s * (layout.barW + layout.barGap);
}
