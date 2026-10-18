// The plot scene's model and layout, shared by the scene (which draws each frame from it), `validate` (which checks
// its expressions, samples its curves and fits its labels) and the ink targets. A plot is numeric axes and parts,
// each part with an id: functions of x (or curves of t), data series, points, vectors and shaded areas. Numbers a
// part is placed by may be expressions in the scene's parameters, which steps `set`, so a part moves or reshapes.

import { exprOf } from './expr.mjs';
import { measure } from './textfit.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The scene's fields that hold parts, and what one of each is called. */
export const PART_KINDS = { functions: 'function', series: 'series', points: 'point', vectors: 'vector', areas: 'area' };
/** Parts a step can trace on: everything with a line or an extent. */
export const TRACEABLE = ['functions', 'series', 'vectors', 'areas'];
/** Line colours in the order parts without a tone take them. */
export const LINE_TONES = ['accent', 'good', 'warn', 'bad', 'neutral'];

export const TICK_FONT = { family: 'sans', weight: 500, size: 22 };
export const AXIS_FONT = { family: 'sans', weight: 600, size: 24 };
export const LABEL_FONT = { family: 'sans', weight: 600, size: 26 };
const lineHeight = (font) => Math.round(font.size * 1.3);
const SAMPLES = 480;
export const POINT_R = 9;

/** Every part with its kind, index, id and the field path it is written at, in drawing order. */
export function plotParts(scene) {
  return Object.keys(PART_KINDS).flatMap((kind) => list(scene?.[kind]).map((item, index) => ({ kind, index, id: item?.id, item, path: `${kind}[${index}]` })));
}

/** The part a ref names by id, or undefined. */
export const partOf = (scene, id) => plotParts(scene).find((p) => p.id === id && typeof id === 'string');

/** The scene's parameter names. */
export const paramNames = (scene) => (isRecord(scene?.params) ? Object.keys(scene.params) : []);

/** A number written as a number or as an expression: its function of a scope, and the names it reads. */
function numOf(spec) {
  if (typeof spec === 'number') return { fn: () => spec, names: [], error: null };
  if (typeof spec === 'string') return exprOf(spec);
  return { fn: () => NaN, names: [], error: null };
}

/**
 * Every number field of a part that may be an expression, as [field path, spec, the variable it may read besides
 * the parameters]. A function's y reads x; a curve's x and y read t.
 */
export function partNumbers(part) {
  const { kind, item } = part;
  if (!isRecord(item)) return [];
  const pair = (field, v) => (Array.isArray(v) ? v.map((s, i) => [`${field}[${i}]`, s, null]) : v === undefined ? [] : [[field, v, null]]);
  const ends = [...(item.from !== undefined ? [['from', item.from, null]] : []), ...(item.to !== undefined && kind !== 'vectors' ? [['to', item.to, null]] : [])];
  switch (kind) {
    case 'functions':
      return item.x !== undefined ? [['x', item.x, 't'], ['y', item.y, 't'], ...pair('t', item.t)] : [['y', item.y, 'x'], ...ends];
    case 'points':
      return pair('at', item.at);
    case 'vectors':
      return [...pair('from', item.from), ...pair('to', item.to)];
    case 'areas':
      return ends;
    default:
      return [];
  }
}

/** The pieces of a label: text, and `{expr}` or `{expr:2}` holes, an expression and the decimals it is shown with. */
export function labelPieces(label) {
  if (typeof label !== 'string') return [];
  const pieces = [];
  let at = 0;
  for (const m of label.matchAll(/\{([^{}]*)\}/g)) {
    if (m.index > at) pieces.push(label.slice(at, m.index));
    const spec = /^(.*?)(?::(\d))?$/s.exec(m[1]);
    pieces.push({ expr: spec[1], digits: spec[2] === undefined ? null : Number(spec[2]) });
    at = m.index + m[0].length;
  }
  if (at < label.length) pieces.push(label.slice(at));
  return pieces;
}

/** "12,345.6" with a real minus sign; `digits` decimals, or up to 2 with trailing zeros dropped. */
export function formatNumber(v, digits = null) {
  if (!Number.isFinite(v)) return '?';
  const fixed = Math.abs(v).toFixed(digits ?? 2);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = digits === null ? (frac ?? '').replace(/0+$/, '') : (frac ?? '');
  const text = tail ? `${grouped}.${tail}` : grouped;
  return v < 0 && Number(fixed) !== 0 ? `−${text}` : text;
}

/** A label's text with its holes filled from `scope`. */
export function labelText(label, scope) {
  return labelPieces(label).map((p) => (typeof p === 'string' ? p : formatNumber(exprOf(p.expr).fn(scope), p.digits))).join('');
}

const models = new WeakMap();
/**
 * The parameters' first values, and the ids of the parts that read each parameter. Cached per scene object.
 * @returns {{ params: Record<string, number>, dependents: Map<string, string[]> }}
 */
export function plotModel(scene) {
  let model = models.get(scene);
  if (model) return model;
  const params = Object.fromEntries(paramNames(scene).map((name) => [name, Number(scene.params[name])]));
  const dependents = new Map();
  for (const part of plotParts(scene)) {
    const read = new Set([
      ...partNumbers(part).flatMap(([, spec]) => numOf(spec).names.map((n) => n.name)),
      ...labelPieces(part.item?.label).flatMap((p) => (typeof p === 'string' ? [] : exprOf(p.expr).names.map((n) => n.name))),
    ]);
    // An area reads what the functions it fills between read.
    const filled = part.kind === 'areas' ? areaFunctions(part.item).map((fid) => partOf(scene, fid)).filter(Boolean) : [];
    for (const fn of filled) for (const [, spec] of partNumbers(fn)) for (const n of numOf(spec).names) read.add(n.name);
    for (const name of read) if (Object.hasOwn(params, name) && typeof part.id === 'string') dependents.set(name, [...(dependents.get(name) ?? []), part.id]);
  }
  model = { params, dependents };
  models.set(scene, model);
  return model;
}

/** The function ids an area fills between: its `under`, or both of its `between`. */
export const areaFunctions = (area) => (typeof area?.under === 'string' ? [area.under] : Array.isArray(area?.between) ? area.between.filter((id) => typeof id === 'string') : []);

/** The parameters in a state, by name: its `k:` values, falling back on the scene's own. */
export function stateParams(scene, state) {
  const { params } = plotModel(scene);
  return Object.fromEntries(Object.keys(params).map((name) => [name, Number(state?.values?.[`k:${name}`] ?? params[name])]));
}

/** The item keys a ref lights: a part by its id, or the parts a parameter moves by the parameter's name. */
export function resolvePlotRef(scene, ref) {
  if (typeof ref !== 'string') return null;
  if (partOf(scene, ref)) return [`p:${ref}`];
  const moved = plotModel(scene).dependents.get(ref);
  return moved?.length ? moved.map((id) => `p:${id}`) : null;
}

// ─── Axes ───

/** Where values land along an axis between two pixel ends; log axes in powers of ten. NaN for a value a log axis cannot place. */
function scaleOf(axis, a, b) {
  const log = axis.log === true;
  const t = (v) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);
  const [lo, hi] = [t(axis.from), t(axis.to)];
  return (v) => a + ((t(v) - lo) / (hi - lo)) * (b - a);
}

const niceStep = (span) => {
  const raw = span / 6;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.75) ?? 10 * p;
};

/** How a multiple of pi over 2 reads: "π/2", "π", "3π/2", "−2π". */
function piLabel(halves) {
  if (halves === 0) return '0';
  const sign = halves < 0 ? '−' : '';
  const h = Math.abs(halves);
  if (h % 2 === 0) return `${sign}${h === 2 ? '' : h / 2}π`;
  return `${sign}${h === 1 ? '' : h}π/2`;
}

/** A tick value as text: compact past ten thousand ("20k", "1.5M"), with the axis's prefix and suffix. */
function tickText(v, step, axis) {
  const abs = Math.abs(v);
  const digits = (s) => Math.max(0, Math.min(6, -Math.floor(Math.log10(s) + 1e-9)));
  let text;
  if (abs >= 1e6 && step >= 1e5) text = `${formatNumber(v / 1e6, digits(step / 1e6))}M`;
  else if (abs >= 1e4 && step >= 1e3) text = `${formatNumber(v / 1e3, digits(step / 1e3))}k`;
  else text = formatNumber(v, digits(step));
  return `${axis.prefix ?? ''}${text}${axis.suffix ?? ''}`;
}

/** An axis's ticks as values and their text. At most 200, so a tiny step cannot stall a frame. */
export function axisTicks(axis) {
  const { from, to } = axis;
  const inRange = (v) => v >= Math.min(from, to) - 1e-9 && v <= Math.max(from, to) + 1e-9;
  if (Array.isArray(axis.ticks)) {
    const vals = axis.ticks.filter((v) => typeof v === 'number' && inRange(v));
    const step = vals.length > 1 ? Math.min(...vals.slice(1).map((v, i) => Math.abs(v - vals[i])).filter((d) => d > 0)) : 1;
    return vals.map((v) => ({ value: v, text: tickText(v, step || 1, axis) }));
  }
  if (axis.log === true) {
    const [a, b] = [Math.floor(Math.log10(from) + 1e-9), Math.ceil(Math.log10(to) - 1e-9)];
    const few = b - a < 3;
    const out = [];
    for (let k = a; k <= b && out.length < 200; k++) for (const m of few ? [1, 2, 5] : [1]) if (inRange(m * 10 ** k)) out.push({ value: m * 10 ** k, text: tickText(m * 10 ** k, 10 ** k, axis) });
    return out;
  }
  if (axis.ticks === 'pi') {
    const halves = Math.abs(to - from) / (Math.PI / 2) > 12 ? 2 : 1;
    const step = (halves * Math.PI) / 2;
    const out = [];
    for (let m = Math.ceil(from / step - 1e-9); m * step <= to + 1e-9 && out.length < 200; m++) out.push({ value: m * step, text: `${axis.prefix ?? ''}${piLabel(m * halves)}${axis.suffix ?? ''}` });
    return out;
  }
  const step = typeof axis.ticks === 'number' && axis.ticks > 0 ? axis.ticks : niceStep(Math.abs(to - from));
  const out = [];
  for (let m = Math.ceil(from / step - 1e-9); m * step <= to + 1e-9 && out.length < 200; m++) {
    const v = Math.abs(m * step) < step * 1e-9 ? 0 : m * step;
    out.push({ value: v, text: tickText(v, step, axis) });
  }
  return out;
}

const textBox = (text, font, x, y, anchor = 'start') => {
  const width = measure(text, font);
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return { x: left, y, width, height: lineHeight(font) };
};

/** Gap between an axis and its tick text, and the length of a tick mark. */
const TICK_GAP = 14;
export const TICK_LEN = 10;

/**
 * The axes in a content box: the plot rectangle, the value-to-pixel maps, where each axis line runs, the ticks with
 * their text boxes, and the axis labels. Without a y axis the plot is a number line through the box's middle.
 */
export function plotAxes(scene, box) {
  const x = scene.x;
  const y = scene.y ?? null;
  const xTicks = axisTicks(x);
  const yTicks = y ? axisTicks(y) : [];
  const yTickWidth = Math.max(0, ...yTicks.map((t) => measure(t.text, TICK_FONT)));
  const zeroInside = (axis) => axis.log !== true && Math.min(axis.from, axis.to) < 0 && Math.max(axis.from, axis.to) > 0;
  const yAxisInside = y ? zeroInside(x) : false;
  const xAxisInside = y ? zeroInside(y) : false;
  const lastTick = xTicks.at(-1);
  const left = y && !yAxisInside ? Math.ceil(yTickWidth + TICK_GAP + 8) : 16;
  const right = Math.max(24, lastTick ? Math.ceil(measure(lastTick.text, TICK_FONT) / 2) + 8 : 24);
  const top = y ? 20 : 0;
  const bottom = y && !xAxisInside ? TICK_GAP + lineHeight(TICK_FONT) + 8 : 20;
  const plot = { x: left, y: top, width: Math.max(1, box.width - left - right), height: Math.max(1, box.height - top - bottom) };
  // Equal units on both axes: the plot narrows (or shortens) to the smaller scale and sits centred, so a circle is round.
  if (scene.equal === true && y && x.log !== true && y.log !== true) {
    const unit = Math.min(plot.width / (x.to - x.from), plot.height / (y.to - y.from));
    const [w, h] = [unit * (x.to - x.from), unit * (y.to - y.from)];
    Object.assign(plot, { x: plot.x + (plot.width - w) / 2, y: plot.y + (plot.height - h) / 2, width: w, height: h });
  }
  const sx = scaleOf(x, plot.x, plot.x + plot.width);
  const sy = y ? scaleOf(y, plot.y + plot.height, plot.y) : () => plot.y + plot.height / 2;
  const xAxisY = y ? (xAxisInside ? sy(0) : plot.y + plot.height) : plot.y + plot.height / 2;
  const yAxisX = y ? (yAxisInside ? sx(0) : plot.x) : null;
  const ticks = {
    x: xTicks.map((t) => ({ ...t, at: sx(t.value), box: textBox(t.text, TICK_FONT, sx(t.value), xAxisY + TICK_GAP, 'middle') })),
    y: yTicks.map((t) => ({ ...t, at: sy(t.value), box: textBox(t.text, TICK_FONT, yAxisX - TICK_GAP, sy(t.value) - lineHeight(TICK_FONT) / 2, 'end') })),
  };
  // A y tick whose text lands on an x tick's, such as the two zeros at a corner, gives way, as does the y axis's 0
  // where the x axis crosses it, which the x axis's own 0 names.
  ticks.y = ticks.y.filter((t) => !ticks.x.some((u) => overlaps(t.box, u.box)) && !(xAxisInside && yAxisInside && t.value === 0));
  const labels = {
    x: typeof x.label === 'string' && x.label ? { text: x.label, box: textBox(x.label, AXIS_FONT, plot.x + plot.width, xAxisY - 10 - lineHeight(AXIS_FONT), 'end') } : null,
    y: y && typeof y.label === 'string' && y.label ? { text: y.label, box: textBox(y.label, AXIS_FONT, yAxisX + 14, plot.y - 4) } : null,
  };
  return { box, plot, sx, sy, xAxisY, yAxisX, ticks, labels, numberLine: !y };
}

export const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

// ─── Parts in a frame ───

/**
 * A function's or curve's samples in data space, as runs between the places it has no value, over `progress` of its
 * domain. `pieces`, given two neighbouring samples, says into how many pieces to split the stretch between them.
 */
export function sampleFunction(item, scene, scope, progress = 1, pieces = null) {
  const runs = [];
  let run = [];
  let undefinedAt = null;
  const push = ([px, py, at]) => {
    if (Number.isFinite(px) && Number.isFinite(py)) return run.push([px, py]);
    if (undefinedAt === null) undefinedAt = at;
    if (run.length) runs.push(run);
    run = [];
  };
  /** Samples `pointAt(u)` for u from 0 to 1, SAMPLES evenly, and `pieces` more between two where it asks. */
  const sweep = (pointAt) => {
    let prev = pointAt(0);
    push(prev);
    for (let i = 1; i <= SAMPLES; i++) {
      const next = pointAt(i / SAMPLES);
      const n = pieces ? pieces(prev, next) : 1;
      for (let j = 1; j < n; j++) push(pointAt((i - 1 + j / n) / SAMPLES));
      push(next);
      prev = next;
    }
  };
  if (item.x !== undefined) {
    const [t0, t1] = list(item.t).map((s) => numOf(s).fn(scope));
    const [fx, fy] = [numOf(item.x).fn, numOf(item.y).fn];
    const end = t0 + (t1 - t0) * progress;
    sweep((u) => {
      const t = t0 + (end - t0) * u;
      const s = { ...scope, t };
      return [fx(s), fy(s), t];
    });
  } else {
    const ax = scene.x;
    const lo = Math.max(Math.min(ax.from, ax.to), item.from !== undefined ? numOf(item.from).fn(scope) : -Infinity);
    const hi = Math.min(Math.max(ax.from, ax.to), item.to !== undefined ? numOf(item.to).fn(scope) : Infinity);
    const f = numOf(item.y).fn;
    const end = lo + (hi - lo) * progress;
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      const log = ax.log === true;
      sweep((u) => {
        const x = log ? 10 ** (Math.log10(lo) + (Math.log10(end) - Math.log10(lo)) * u) : lo + (end - lo) * u;
        return [x, f({ ...scope, x }), x];
      });
    }
  }
  if (run.length) runs.push(run);
  return { runs, undefinedAt };
}

/** Screen pixels between the points a line is drawn through where the camera shows it, so a zoomed line stays smooth. */
const DRAW_PX = 2;

/**
 * How finely a line is drawn under a camera: a stretch between two samples on screen is split so its points are
 * DRAW_PX apart at the view's zoom, along x for a function of x and along either axis for a curve, and a stretch off
 * screen is not split.
 */
function screenPieces(item, axes, view) {
  const { rect, zoom } = view;
  const curve = item.x !== undefined;
  return (a, b) => {
    const [ax, bx, ay, by] = [axes.sx(a[0]), axes.sx(b[0]), axes.sy(a[1]), axes.sy(b[1])];
    if (!Number.isFinite(ax) || !Number.isFinite(bx) || (curve && !(Number.isFinite(ay) && Number.isFinite(by)))) return 1;
    const span = curve ? Math.max(Math.abs(bx - ax), Math.abs(by - ay)) : Math.abs(bx - ax);
    if (Math.max(ax, bx) + span < rect.x || Math.min(ax, bx) - span > rect.x + rect.width) return 1;
    if (curve && (Math.max(ay, by) + span < rect.y || Math.min(ay, by) - span > rect.y + rect.height)) return 1;
    return Math.min(64, Math.max(1, Math.ceil((span * zoom) / DRAW_PX)));
  };
}

/** Data-space runs as pixel runs, broken where a jump leaves the plot (a pole), and held near it so huge values stay drawable. */
function toPixels(runs, axes) {
  const { plot, sx, sy } = axes;
  const out = [];
  const [lo, hi] = [plot.y - plot.height, plot.y + 2 * plot.height];
  for (const r of runs) {
    let cur = [];
    for (const [x, y] of r) {
      const p = [sx(x), Math.min(hi, Math.max(lo, sy(y)))];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        if (cur.length) out.push(cur);
        cur = [];
        continue;
      }
      const prev = cur.at(-1);
      if (prev && Math.abs(p[1] - prev[1]) > plot.height && (prev[1] <= plot.y || prev[1] >= plot.y + plot.height || p[1] <= plot.y || p[1] >= plot.y + plot.height)) {
        out.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

const insidePlot = (p, plot) => p[0] >= plot.x - 0.5 && p[0] <= plot.x + plot.width + 0.5 && p[1] >= plot.y - 0.5 && p[1] <= plot.y + plot.height + 0.5;
const boundsOf = (pts) => {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};
const pointOf = (pair, scope, axes) => {
  const [vx, vy] = Array.isArray(pair) ? [numOf(pair[0]).fn(scope), axes.numberLine ? 0 : numOf(pair[1]).fn(scope)] : [numOf(pair).fn(scope), 0];
  return { data: [vx, vy], px: [axes.sx(vx), axes.numberLine ? axes.xAxisY : axes.sy(vy)] };
};

/** The tone a part draws in: its own, or the next line colour by its place among the lines. */
export function partTone(scene, part) {
  if (typeof part.item?.tone === 'string') return part.item.tone;
  if (part.kind === 'areas') {
    const fn = partOf(scene, areaFunctions(part.item)[0]);
    return fn ? partTone(scene, fn) : 'accent';
  }
  if (part.kind === 'points' || part.kind === 'vectors') return 'accent';
  const lines = plotParts(scene).filter((p) => p.kind === 'functions' || p.kind === 'series');
  return LINE_TONES[Math.max(0, lines.indexOf(part)) % LINE_TONES.length];
}

/**
 * Where each part draws at a set of parameter values: its pixel runs (a line), polygon (an area), dot (a point) or
 * arrow (a vector), its box on the plot, and the data-space facts validate reports. `progress` maps an id to how
 * much of it a trace has drawn. `view`, the part of the box the camera shows and its zoom, draws lines finely enough
 * to stay smooth there; a line's box, end and label spots do not depend on it, so the camera never moves a label.
 */
export function plotGeometry(scene, axes, scope, progress = () => 1, view = null) {
  const { plot } = axes;
  const out = new Map();
  const parts = plotParts(scene).filter((p) => typeof p.id === 'string' && isRecord(p.item));
  const lineOf = (fid) => {
    const fn = partOf(scene, fid);
    return fn && fn.kind === 'functions' && fn.item.x === undefined ? fn.item : null;
  };
  for (const part of parts) {
    const { kind, item, id } = part;
    const p = progress(id);
    if (kind === 'functions') {
      const { runs, undefinedAt } = sampleFunction(item, scene, scope, p);
      const px = toPixels(runs, axes);
      const visible = px.flatMap((r) => r.filter((q) => insidePlot(q, plot)));
      const drawn = view ? toPixels(sampleFunction(item, scene, scope, p, screenPieces(item, axes, view)).runs, axes) : px;
      out.set(id, { part, runs: drawn, undefinedAt, visible: visible.length > 0, box: boundsOf(visible), end: visible.at(-1) ?? null, along: visible });
    } else if (kind === 'series') {
      const pts = list(item.points).filter((q) => Array.isArray(q)).map((q) => [axes.sx(q[0]), axes.numberLine ? axes.xAxisY : axes.sy(q[1])]);
      const shown = pts.slice(0, Math.max(1, Math.ceil(pts.length * p - 1e-9)));
      if (p < 1 && shown.length > 1) {
        const exact = (pts.length - 1) * p;
        const [i, f] = [Math.floor(exact), exact - Math.floor(exact)];
        const [a, b] = [pts[i], pts[Math.min(i + 1, pts.length - 1)]];
        shown.splice(i + 1, shown.length, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
      const visible = shown.filter((q) => insidePlot(q, plot));
      out.set(id, { part, runs: [shown], dots: item.style === 'line' ? [] : shown.slice(0, p < 1 ? Math.floor((pts.length - 1) * p) + 1 : pts.length), visible: visible.length > 0, box: boundsOf(visible), end: visible.at(-1) ?? null, along: visible });
    } else if (kind === 'points') {
      const at = pointOf(item.at, scope, axes);
      const ok = at.px.every(Number.isFinite) && insidePlot(at.px, plot);
      out.set(id, { part, dot: at.px, data: at.data, visible: ok, box: ok ? { x: at.px[0] - POINT_R, y: at.px[1] - POINT_R, width: 2 * POINT_R, height: 2 * POINT_R } : null });
    } else if (kind === 'vectors') {
      const from = item.from !== undefined ? pointOf(item.from, scope, axes) : pointOf(axes.numberLine ? 0 : [0, 0], scope, axes);
      const to = pointOf(item.to, scope, axes);
      const tip = [from.px[0] + (to.px[0] - from.px[0]) * p, from.px[1] + (to.px[1] - from.px[1]) * p];
      const ok = [...from.px, ...tip].every(Number.isFinite);
      out.set(id, { part, arrow: ok ? [from.px, tip] : null, data: [from.data, to.data], visible: ok && (insidePlot(from.px, plot) || insidePlot(tip, plot)), box: ok ? boundsOf([from.px, tip]) : null });
    }
  }
  // Areas last: they fill between functions already sampled.
  for (const part of parts.filter((q) => q.kind === 'areas')) {
    const { item, id } = part;
    const [f, g] = areaFunctions(item).map(lineOf);
    if (!f) {
      out.set(id, { part, polygon: null, visible: false, box: null });
      continue;
    }
    const lo = Math.max(Math.min(scene.x.from, scene.x.to), item.from !== undefined ? numOf(item.from).fn(scope) : -Infinity, f.from !== undefined ? numOf(f.from).fn(scope) : -Infinity);
    const hi = Math.min(Math.max(scene.x.from, scene.x.to), item.to !== undefined ? numOf(item.to).fn(scope) : Infinity, f.to !== undefined ? numOf(f.to).fn(scope) : Infinity);
    const end = lo + (hi - lo) * progress(id);
    const top = [];
    const bottom = [];
    if (Number.isFinite(lo) && Number.isFinite(end) && end > lo) {
      const n = 240;
      for (let i = 0; i <= n; i++) {
        const x = lo + ((end - lo) * i) / n;
        const [a, b] = [numOf(f.y).fn({ ...scope, x }), g ? numOf(g.y).fn({ ...scope, x }) : 0];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        top.push([axes.sx(x), clampY(axes.sy(a), plot)]);
        bottom.push([axes.sx(x), clampY(axes.sy(b), plot)]);
      }
    }
    const polygon = top.length > 1 ? [...top, ...bottom.reverse()] : null;
    const mid = top.length ? Math.floor(top.length / 2) : 0;
    out.set(id, { part, polygon, visible: Boolean(polygon), box: polygon ? boundsOf(polygon) : null, centre: polygon ? [top[mid][0], (top[mid][1] + bottom[bottom.length - 1 - mid][1]) / 2] : null });
  }
  return out;
}

const clampY = (y, plot) => Math.min(plot.y + plot.height, Math.max(plot.y, y));

// ─── Labels ───

/** Where a part's label may go, best first, as boxes of the label's size. */
function labelSpots(geo, w, h, side) {
  const gap = 12;
  if (geo.dot) {
    const [x, y] = geo.dot;
    const spots = {
      above: { x: x - w / 2, y: y - POINT_R - gap - h },
      right: { x: x + POINT_R + gap, y: y - h / 2 },
      left: { x: x - POINT_R - gap - w, y: y - h / 2 },
      below: { x: x - w / 2, y: y + POINT_R + gap },
    };
    return (side ? [side] : ['above', 'right', 'left', 'below']).map((s) => spots[s]);
  }
  if (geo.arrow) {
    const [[x0, y0], [x1, y1]] = geo.arrow;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
    const c = [x1 + ux * (gap + w / 2), y1 + uy * (gap + h / 2)];
    return [{ x: c[0] - w / 2, y: c[1] - h / 2 }, { x: x1 + gap, y: y1 - h - gap }, { x: x1 - w - gap, y: y1 - h - gap }];
  }
  if (geo.centre) return [{ x: geo.centre[0] - w / 2, y: geo.centre[1] - h / 2 }];
  if (geo.end) {
    const [x, y] = geo.end;
    // By the line's end first, then above or below it further back along it.
    const back = [0.8, 0.6, 0.4, 0.2].flatMap((f) => {
      const [ax, ay] = geo.along[Math.floor((geo.along.length - 1) * f)];
      return [{ x: ax - w / 2, y: ay - h - gap }, { x: ax - w / 2, y: ay + gap }];
    });
    return [{ x: x - w, y: y - h - gap }, { x: x - w, y: y + gap }, { x: x + gap, y: y - h / 2 }, ...back];
  }
  return [];
}

/**
 * Each shown part's label at a set of parameter values, placed on the first spot that stays on the stage and clear
 * of the labels before it and the axis text; `clash` names a label it could not keep clear of, `off` one that runs
 * past the stage.
 */
export function plotLabels(scene, axes, geometry, scope, shown = () => true) {
  const placed = [];
  const fixed = [...axes.ticks.x.map((t) => t.box), ...axes.ticks.y.map((t) => t.box), ...[axes.labels.x, axes.labels.y].filter(Boolean).map((l) => l.box)];
  const stage = { x: 0, y: 0, width: axes.box.width, height: axes.box.height };
  const order = ['points', 'vectors', 'functions', 'series', 'areas'];
  const parts = [...geometry.values()].filter((g) => g.visible && typeof g.part.item.label === 'string' && g.part.item.label && shown(g.part.id)).sort((a, b) => order.indexOf(a.part.kind) - order.indexOf(b.part.kind));
  for (const geo of parts) {
    const text = labelText(geo.part.item.label, scope);
    const [w, h] = [measure(text, LABEL_FONT), lineHeight(LABEL_FONT)];
    const spots = labelSpots(geo, w, h, geo.part.item.side).map((s) => ({ ...s, width: w, height: h }));
    const clear = (b) => inside(b, stage) && !placed.some((l) => overlaps(l.box, b)) && !fixed.some((f) => overlaps(f, b)) && !(geo.part.kind !== 'points' && [...geometry.values()].some((g) => g !== geo && g.dot && g.visible && overlaps(g.box, b)));
    const box = spots.find(clear) ?? spots.find((b) => inside(b, stage)) ?? spots[0];
    if (!box) continue;
    const clash = clear(box) ? null : (placed.find((l) => overlaps(l.box, box))?.id ?? (fixed.some((f) => overlaps(f, box)) ? 'axis' : null));
    placed.push({ id: geo.part.id, text, box, tone: partTone(scene, geo.part), clash, off: !inside(box, stage) });
  }
  return placed;
}
