import type { ChartScene } from '../types';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { fitText, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';

/** What a chart shows at one step: each series' values by label, whether bars and slices are sorted, and the callout. */
export interface ChartState {
  values: number[][];
  sort: boolean;
  callout: string;
}

/** A chart's state as the shared step model holds it, by item key, as values by series and label. */
export const chartStateOf = (scene: ChartScene, state: SceneState): ChartState => ({
  values: scene.series.map((series, s) => series.values.map((v, l) => Number(state.values[`p:${s}/${l}`] ?? v))),
  sort: state.sort === true,
  callout: state.callout,
});

/** Every state of a chart, `[initial, during step 0, ...]`. */
export const chartStates = (scene: ChartScene): ChartState[] =>
  sceneStates(scene).map((state) => chartStateOf(scene, state));

/** The scene with its series holding `values`, for the layout of one state. */
export const withValues = (scene: ChartScene, values: readonly (readonly number[])[]): ChartScene =>
  values.every((v, s) => v === scene.series[s]!.values)
    ? scene
    : { ...scene, series: scene.series.map((series, s) => ({ ...series, values: [...values[s]!] })) };

/** Decimal places a value is written with, so a value partway between two keeps no more digits than they have. */
const places = (v: number) => {
  const text = String(v);
  return text.includes('e') ? 6 : (text.split('.')[1]?.length ?? 0);
};

/** A value `t` of the way from `a` to `b`, rounded to the places the two are written with. */
export function between(a: number, b: number, t: number): number {
  if (t >= 1 || a === b) return b;
  if (t <= 0) return a;
  const digits = Math.max(places(a), places(b));
  return Number((a + (b - a) * t).toFixed(digits));
}

/** Values `t` of the way from one state's to another's: exact, for the bars and points to move smoothly. */
export const valuesBetween = (
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
  t: number,
): number[][] =>
  t >= 1 ? b.map((row) => [...row]) : b.map((row, s) => row.map((v, l) => a[s]![l]! + (v - a[s]![l]!) * t));

/** The same values as printed: rounded to the places their two ends are written with, so a label counts. */
export const shownBetween = (
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
  t: number,
): number[][] => b.map((row, s) => row.map((v, l) => between(a[s]![l]!, v, t)));

/** A label's total over every series, as a stack draws it. */
export const labelTotal = (values: readonly (readonly number[])[], label: number) =>
  values.reduce((sum, row) => sum + row[label]!, 0);

/**
 * Each label's place, 0 first, in one state: in the order of `labels`, or sorted by value, largest first, by the
 * label's total when stacked, else by the last series. Ties keep the order of `labels`.
 */
export function chartOrder(scene: ChartScene, values: readonly (readonly number[])[], sort: boolean): number[] {
  const n = scene.labels.length;
  if (!sort) return Array.from({ length: n }, (_, i) => i);
  const key = (i: number) => (scene.stacked ? labelTotal(values, i) : values[values.length - 1]![i]!);
  const ranked = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(b) - key(a) || a - b);
  const place = new Array<number>(n);
  ranked.forEach((label, rank) => (place[label] = rank));
  return place;
}

const MINUS = '−';
/** Units that sit against the number rather than after a space. */
const TIGHT_UNITS = new Set(['%', 'x', '×', '°']);

function trimmed(v: number, digits: number): string {
  return Number(v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** What a value prints with: a `prefix` before the number, such as "$", and a `unit` after it, such as "ms". */
export type Affix = { unit?: string; prefix?: string };

/**
 * "1,250 ms", "$35", "3.125 s", "0.0243%", "0.6667", "3.4M req/s": a value below 10,000 to four significant digits, so
 * a value written with four or fewer prints as written and an unrounded float does not run on; thousands grouped.
 * Bigger values are compacted to three significant digits.
 */
export function formatValue(v: number, { unit, prefix }: Affix): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  let text: string;
  if (abs >= 1e9) text = `${trimmed(abs / 1e9, 3)}B`;
  else if (abs >= 1e6) text = `${trimmed(abs / 1e6, 3)}M`;
  else if (abs >= 1e4) text = `${trimmed(abs / 1e3, 3)}k`;
  else text = abs.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  const head = sign + (prefix ?? '') + text;
  if (!unit) return head;
  return head + (TIGHT_UNITS.has(unit) ? '' : ' ') + unit;
}

function ticksOf(lo: number, span: number, count: number): number[] {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t < lo + span + step - step * 1e-9; t += step)
    ticks.push(Number(t.toPrecision(12)));
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
export function delta(
  a: number,
  b: number,
  better: ChartScene['better'],
): { text: string; direction: Direction } | null {
  if (a === 0) return null;
  const pct = ((b - a) / Math.abs(a)) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const text =
    pct >= 200 ? `×${trimmed(b / a, 2)}` : rounded === 0 ? '±0%' : `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded)}%`;
  if (rounded === 0 || !better) return { text, direction: 'neutral' };
  const improved = better === 'lower' ? pct < 0 : pct > 0;
  return { text, direction: improved ? 'good' : 'bad' };
}

/** A value label's size: smaller over a narrow bar. */
export const VALUE_FONT = 21;
const NARROW_VALUE_FONT = 17;
/** Least room between two value labels side by side, in px. */
const VALUE_GAP = 6;

/** Widest a series name runs in the legend, and the annotation's note. */
const LEGEND_NAME_W = 240;
const NOTE_MAX_W = 620;
const NOTE_PAD_X = 52;
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
  /** Every label at one shared size. */
  xLabels: Fit[];
  legend: Fit[];
  note: Fit | null;
  /** Each value label beside one drawn before it at the same height, fitted into the room it leaves. */
  valueFits: Fit[];
}

/** A value label: its text centred on `x`, `top` its top edge, above its bar or point, or below the lower of two lines. */
export interface ValueLabel {
  series: number;
  label: number;
  text: string;
  x: number;
  y: number;
  top: number;
  size: number;
  below: boolean;
}

/** The value labels a chart draws: every bar's, and a line's at each point, or at its last point past two series or eight labels. */
export function valueLabels(
  scene: ChartScene,
  layout: Omit<ChartLayout, 'valueFits'>,
  shown: readonly (readonly number[])[] = scene.series.map((s) => s.values),
): ValueLabel[] {
  const k = scene.series.length;
  if (scene.stacked) {
    // A stack carries its total, labelled as its top series.
    const size = layout.barW < 64 ? NARROW_VALUE_FONT : VALUE_FONT;
    const values = scene.series.map((s) => s.values);
    return scene.labels.map((_, i) => {
      const y = layout.y(labelTotal(values, i));
      return {
        series: k - 1,
        label: i,
        text: formatValue(labelTotal(shown, i), scene),
        x: layout.xs[i]!,
        y,
        top: y - 14 - size * 1.25,
        size,
        below: false,
      };
    });
  }
  const size = scene.kind === 'bar' && layout.barW < 64 ? NARROW_VALUE_FONT : VALUE_FONT;
  const labelEvery = k <= 2 && scene.labels.length <= 8;
  return scene.series.flatMap((series, s) =>
    series.values.flatMap((v, i) => {
      if (scene.kind === 'line' && !labelEvery && i !== series.values.length - 1) return [];
      const below = scene.kind === 'line' && k === 2 && scene.series.some((o, j) => j !== s && o.values[i]! > v);
      const x = scene.kind === 'bar' ? barX(layout, layout.xs[i]!, s, k) + layout.barW / 2 : layout.xs[i]!;
      const y = layout.y(v);
      return [
        {
          series: s,
          label: i,
          text: formatValue(shown[s]?.[i] ?? v, scene),
          x,
          y,
          top: below ? y + 14 : y - 14 - size * 1.25,
          size,
          below,
        },
      ];
    }),
  );
}

/** Each value label's fit in the room the labels left of it leave at its height, so two that run into each other warn. */
function valueFits(labels: ValueLabel[]): Fit[] {
  const widths = labels.map((l) => measure(l.text, { family: 'mono', weight: SLOTS.chartValue.weight, size: l.size }));
  return labels.flatMap((l, a) => {
    const rooms = labels.flatMap((o, b) => {
      const sameHeight = o.top < l.top + l.size * 1.25 && l.top < o.top + o.size * 1.25;
      return b !== a && o.x < l.x && sameHeight ? [2 * (l.x - o.x - widths[b]! / 2 - VALUE_GAP)] : [];
    });
    if (!rooms.length) return [];
    return [
      fitTextAt(
        l.text,
        sized(SLOTS.chartValue, Math.max(0, Math.min(...rooms))),
        `series[${l.series}].values[${l.label}]`,
        l.size,
      ),
    ];
  });
}

/** A vertical bar or line chart: one axis for every state, and each state's value labels fitted in the room they leave. */
export function layoutChart(scene: ChartScene, width: number, height: number): ChartLayout {
  const states = chartStates(scene);
  const layout = placeChart(scene, width, height, states);
  const same = (a: ChartState, b: ChartState) =>
    a.sort === b.sort && a.values.every((row, s) => row.every((v, l) => v === b.values[s]![l]));
  const fits = states.flatMap((state, k) => {
    if (k > 0 && same(state, states[k - 1]!)) return [];
    const order = chartOrder(scene, state.values, state.sort);
    const fitted = valueFits(
      valueLabels(withValues(scene, state.values), { ...layout, xs: order.map((place) => layout.xs[place]!) }),
    );
    // A later state's labels are reported at the step that sets them, and only when they run together.
    return k === 0 ? fitted : fitted.flatMap((fit) => (fit.fits ? [] : [{ ...fit, path: `steps[${k - 1}].set` }]));
  });
  return { ...layout, valueFits: fits };
}

/** Every value the chart's axis must reach in any state: each bar or point, or each stack's total. */
function axisValues(scene: ChartScene, states: readonly ChartState[]): number[] {
  return states.flatMap((state) =>
    scene.stacked ? scene.labels.map((_, l) => labelTotal(state.values, l)) : state.values.flat(),
  );
}

function placeChart(
  scene: ChartScene,
  width: number,
  height: number,
  states: readonly ChartState[],
): Omit<ChartLayout, 'valueFits'> {
  const values = axisValues(scene, states);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const n = scene.labels.length;
  const axisW = Math.max(...ticks.map((t) => formatValue(t, scene).length)) * TICK_CHAR_W + 30;
  const x0 = axisW;
  const x1 = width - PLOT_RIGHT_PAD;
  const slotW = (x1 - x0) / n;
  // The largest size at which every label fits on two lines.
  const labelSlot = sized(SLOTS.chartLabel, slotW - 12);
  const xLabelFont = Math.min(...scene.labels.map((l) => fitText(l, labelSlot, '').size));
  const xLabels = scene.labels.map((l, i) => fitTextAt(l, labelSlot, `labels[${i}]`, xLabelFont));
  const labelLines = Math.max(...xLabels.map((l) => l.lines.length));
  const belowLabels = scene.kind === 'line' && scene.series.length === 2 ? 36 : 0;
  const y0 = (scene.annotation ? ANNOTATION_BAND : 0) + HEADROOM;
  const y1 = height - 18 - belowLabels - labelLines * Math.round(xLabelFont * 1.3);
  // A stack is one bar a label, as wide as a single series' bar.
  const k = scene.stacked ? 1 : scene.series.length;
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
    legend: scene.series.map((series, i) =>
      fitText(series.name, sized(SLOTS.legend, LEGEND_NAME_W), `series[${i}].name`),
    ),
    note: scene.annotation
      ? fitText(scene.annotation.text, sized(SLOTS.annotation, NOTE_MAX_W - NOTE_PAD_X), 'annotation.text')
      : null,
  };
}

/** Left edge of series `s`'s bar in a slot centred on `cx`; every series of a stack shares one bar. */
export function barX(
  layout: Pick<ChartLayout, 'barW' | 'barGap'>,
  cx: number,
  s: number,
  seriesCount: number,
  stacked = false,
): number {
  if (stacked) return cx - layout.barW / 2;
  const group = seriesCount * layout.barW + (seriesCount - 1) * layout.barGap;
  return cx - group / 2 + s * (layout.barW + layout.barGap);
}
