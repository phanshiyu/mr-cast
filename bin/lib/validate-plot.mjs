// Checks for the `plot` scene, mirroring src/types.ts: its axes and parts, every expression (parsed by shared/expr.mjs,
// the same parser the scene draws with), the steps through shared/state-steps.mjs, and then each state as the scene
// draws it (shared/plot.mjs): lines with no value inside the range, parts that land off the plot, and labels that
// overlap or run off the stage. Each pushes human/LLM-readable strings onto `errors` and `warnings`.

import { exprOf, MAX_EVAL_TERMS, RESERVED_NAMES } from '../../shared/expr.mjs';
import {
  areaFunctions,
  labelPieces,
  PART_KINDS,
  paramNames,
  partNumbers,
  partOf,
  plotAxes,
  plotGeometry,
  plotLabels,
  plotParts,
  sampleFunction,
  stateParams,
  overlaps,
  formatNumber,
} from '../../shared/plot.mjs';
import { sceneStates } from '../../shared/state-steps.mjs';
import { cueWord, spokenTexts } from '../../shared/timing.mjs';
import { stageOf } from './validate-svg.mjs';
import { checkStateSteps } from './validate-state.mjs';
import { didYouMean } from './suggest.mjs';
import { TONES } from './tones.mjs';

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A number as a message writes it: up to 3 decimals, no trailing zeros. */
const short = (v) => formatNumber(Number(v.toFixed(3)), Number.isInteger(Number(v.toFixed(3))) ? 0 : null);
const quoted = (names) => names.map((n) => JSON.stringify(n)).join(', ');

function checkAxis(axis, q, errors) {
  if (!isRecord(axis))
    return errors.push(`${q}: required object { from, to, label?, ticks?, log?, grid? }, e.g. { "from": 0, "to": 10 }`);
  if (!isNum(axis.from) || !isNum(axis.to)) return errors.push(`${q}: from and to must be numbers`);
  if (axis.to <= axis.from) errors.push(`${q}: to (${axis.to}) must be greater than from (${axis.from})`);
  if (axis.log !== undefined && typeof axis.log !== 'boolean') errors.push(`${q}.log: must be true or false`);
  if (axis.log === true && axis.from <= 0) errors.push(`${q}.from: a log axis starts above 0, such as 1 or 0.1`);
  if (axis.grid !== undefined && typeof axis.grid !== 'boolean') errors.push(`${q}.grid: must be true or false`);
  for (const k of ['label', 'prefix', 'suffix'])
    if (axis[k] !== undefined && !isStr(axis[k])) errors.push(`${q}.${k}: must be a string`);
  const t = axis.ticks;
  if (t !== undefined && !(isNum(t) && t > 0) && t !== 'pi' && !(Array.isArray(t) && t.every(isNum)))
    errors.push(`${q}.ticks: must be a step over 0, an array of values, or "pi"`);
  if (axis.log === true && t !== undefined && !Array.isArray(t))
    errors.push(
      `${q}.ticks: a log axis puts its ticks at powers of ten; give the values as an array, or leave ticks out`,
    );
  if (isNum(t) && t > 0 && isNum(axis.from) && isNum(axis.to) && (axis.to - axis.from) / t > 40)
    errors.push(
      `${q}.ticks: a step of ${t} draws ${Math.floor((axis.to - axis.from) / t) + 1} ticks; use a step of at least ${formatNumber((axis.to - axis.from) / 40)}`,
    );
}

/**
 * An expression field: it must parse, and read only the scene's parameters and the variable the field allows
 * (x for a line's y, t for a curve's), with each problem at its column.
 */
function checkExpr(spec, q, allowed, params, errors) {
  if (isNum(spec)) return;
  if (!isStr(spec)) return errors.push(`${q}: must be a number or an expression string, e.g. "2 * x + 1"`);
  const { error, names } = exprOf(spec);
  if (error) return errors.push(`${q}: ${JSON.stringify(spec)} column ${error.at + 1}: ${error.message}`);
  for (const { name, at } of names) {
    if (allowed === name || params.includes(name)) continue;
    const reads = [allowed, ...params].filter(Boolean);
    const hint =
      name === 'x' || name === 't'
        ? `; ${name} is only read by ${name === 'x' ? "a line's y" : "a curve's x, y and t"}`
        : didYouMean(name, [...reads, ...RESERVED_NAMES]);
    errors.push(
      `${q}: ${JSON.stringify(spec)} column ${at + 1}: "${name}" is no parameter${reads.length ? `; it can read ${quoted(reads)}` : '; add it to params'}${hint}`,
    );
  }
}

const pairOf = (v, numberLine) =>
  numberLine ? isNum(v) || isStr(v) || (Array.isArray(v) && v.length === 1) : Array.isArray(v) && v.length === 2;

function checkPart(scene, part, p, params, errors) {
  const { kind, item } = part;
  const q = `${p}.${part.path}`;
  const numberLine = scene.y === undefined;
  if (!isRecord(item)) return errors.push(`${q}: must be an object with an id`);
  if (item.tone !== undefined && !TONES.includes(item.tone))
    errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  if (item.hidden !== undefined && typeof item.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
  if (item.label !== undefined && !isStr(item.label)) errors.push(`${q}.label: must be a string`);
  for (const piece of labelPieces(item.label))
    if (typeof piece !== 'string') checkExpr(piece.expr, `${q}.label`, null, params, errors);
  if (item.dashed !== undefined && typeof item.dashed !== 'boolean') errors.push(`${q}.dashed: must be true or false`);
  if (numberLine && kind !== 'points' && kind !== 'vectors')
    return errors.push(
      `${q}: a number line (a plot without y) draws points and vectors only; give the scene a y axis to draw ${kind}`,
    );
  switch (kind) {
    case 'functions':
      if (item.y === undefined) return errors.push(`${q}.y: required, an expression in x such as "x^2"`);
      if (item.x !== undefined && !(Array.isArray(item.t) && item.t.length === 2))
        return errors.push(`${q}.t: a curve (a function with x) needs t's range, e.g. [0, "2*pi"]`);
      if (item.x === undefined && item.t !== undefined)
        errors.push(`${q}.t: only a curve takes t; give x too, as an expression in t`);
      if (item.x !== undefined && (item.from !== undefined || item.to !== undefined))
        errors.push(`${q}: a curve runs over t; drop from and to`);
      break;
    case 'series':
      if (
        !Array.isArray(item.points) ||
        !item.points.length ||
        !item.points.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(isNum))
      )
        return errors.push(`${q}.points: required non-empty array of [x, y] numbers`);
      if (item.style !== undefined && !['line', 'points', 'both'].includes(item.style))
        errors.push(`${q}.style: must be "line", "points" or "both"`);
      break;
    case 'points':
      if (!pairOf(item.at, numberLine))
        return errors.push(
          `${q}.at: required ${numberLine ? 'x, a number or an expression, on a number line' : '[x, y], numbers or expressions'}`,
        );
      if (item.side !== undefined && !['above', 'below', 'left', 'right'].includes(item.side))
        errors.push(`${q}.side: must be above, below, left or right`);
      if (item.guides !== undefined && typeof item.guides !== 'boolean')
        errors.push(`${q}.guides: must be true or false`);
      break;
    case 'vectors':
      if (!pairOf(item.to, numberLine))
        return errors.push(`${q}.to: required ${numberLine ? 'x' : '[x, y]'}, numbers or expressions`);
      if (item.from !== undefined && !pairOf(item.from, numberLine))
        return errors.push(`${q}.from: must be ${numberLine ? 'x' : '[x, y]'}, numbers or expressions`);
      break;
    case 'areas': {
      if ((item.under === undefined) === (item.between === undefined))
        return errors.push(`${q}: give one of under ("f", to fill between f and y = 0) and between (["f", "g"])`);
      if (
        item.between !== undefined &&
        !(Array.isArray(item.between) && item.between.length === 2 && item.between.every(isStr))
      )
        return errors.push(`${q}.between: must be two function ids, ["f", "g"]`);
      if (item.under !== undefined && !isStr(item.under)) return errors.push(`${q}.under: must be a function id`);
      const lines = plotParts(scene)
        .filter((x) => x.kind === 'functions' && x.item?.x === undefined && isStr(x.id))
        .map((x) => x.id);
      for (const fid of areaFunctions(item)) {
        const fn = partOf(scene, fid);
        if (!fn) errors.push(`${q}: "${fid}" is no function id${didYouMean(fid, lines)}`);
        else if (fn.kind !== 'functions' || fn.item?.x !== undefined)
          errors.push(
            `${q}: "${fid}" is ${fn.kind === 'functions' ? 'a curve of t' : `a ${PART_KINDS[fn.kind]}`}; an area fills between lines of x`,
          );
      }
      break;
    }
  }
  for (const [field, spec, variable] of partNumbers(part)) checkExpr(spec, `${q}.${field}`, variable, params, errors);
}

/** A step's `when` must be words its `say` speaks. */
function checkWhen(s, p, errors) {
  const said = spokenTexts(s);
  (Array.isArray(s.steps) ? s.steps : []).forEach((step, k) => {
    if (step?.when === undefined) return;
    if (!isStr(step.when) || !step.when.trim()) errors.push(`${p}.steps[${k}].when: must be words of the step's say`);
    else if (cueWord(said[k + 1], step.when) < 0)
      errors.push(
        `${p}.steps[${k}].when: ${JSON.stringify(step.when)} is not in the step's say; copy the words its changes should start on`,
      );
  });
}

export function checkPlot(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'callout'])
    if (s[k] !== undefined && !isStr(s[k])) errors.push(`${p}.${k}: must be a string`);
  checkAxis(s.x, `${p}.x`, errors);
  if (s.y !== undefined) checkAxis(s.y, `${p}.y`, errors);
  if (s.equal !== undefined && typeof s.equal !== 'boolean') errors.push(`${p}.equal: must be true or false`);
  if (s.equal === true && (s.y === undefined || s.x?.log === true || s.y?.log === true))
    errors.push(`${p}.equal: needs a y axis, and neither axis on a log scale`);
  if (s.params !== undefined && !isRecord(s.params))
    errors.push(`${p}.params: must be an object of name to number, e.g. { "n": 1 }`);
  const params = isRecord(s.params) ? paramNames(s) : [];
  for (const name of params) {
    if (!NAME.test(name))
      errors.push(`${p}.params.${name}: a parameter's name is letters, digits and _, starting with a letter`);
    else if ([...RESERVED_NAMES, 'x', 't'].includes(name))
      errors.push(`${p}.params.${name}: "${name}" already means something in an expression; pick another name`);
    if (!isNum(s.params[name])) errors.push(`${p}.params.${name}: must be a number`);
  }
  for (const kind of Object.keys(PART_KINDS))
    if (s[kind] !== undefined && !Array.isArray(s[kind])) errors.push(`${p}.${kind}: must be an array`);
  const parts = plotParts(s);
  if (!parts.length) errors.push(`${p}: draws nothing; give it functions, series, points, vectors or areas`);
  const seen = new Set();
  for (const part of parts) {
    if (!isStr(part.id) || !part.id.trim())
      errors.push(`${p}.${part.path}.id: required string, named by steps and ink`);
    else if (seen.has(part.id)) errors.push(`${p}.${part.path}.id: "${part.id}" is taken; every part has its own id`);
    else if (params.includes(part.id))
      errors.push(`${p}.${part.path}.id: "${part.id}" is a parameter's name too; a ref must name one or the other`);
    seen.add(part.id);
  }
  if (errors.length > before) return;
  for (const part of parts) checkPart(s, part, p, params, errors);
  checkWhen(s, p, errors);
  checkStateSteps(s, p, errors, warnings);
  if (errors.length > before) return;
  checkDrawn(s, p, warnings);
}

/** What only drawing each state shows: lines with no value or never on the plot, parts off it, and labels that collide. */
function checkDrawn(s, p, warnings) {
  const axes = plotAxes(s, stageOf(s));
  const states = sceneStates(s);
  const once = new Set();
  const warn = (key, message) => {
    if (once.has(key)) return;
    once.add(key);
    warnings.push(message);
  };
  const when = (k) => (k === 0 ? 'at the start' : `from step ${k - 1}`);
  const ticks = (axis, list) => {
    for (let i = 1; i < list.length; i++) {
      if (overlaps(list[i - 1].box, list[i].box))
        return warn(
          `ticks:${axis}`,
          `${p}.${axis}.ticks: the tick labels ${JSON.stringify(list[i - 1].text)} and ${JSON.stringify(list[i].text)} overlap; use a larger step`,
        );
    }
  };
  ticks('x', axes.ticks.x);
  ticks('y', axes.ticks.y);
  states.forEach((state, k) => {
    const scope = stateParams(s, state);
    const shown = (id) => !state.hidden[`p:${id}`];
    const geometry = plotGeometry(s, axes, scope);
    const at = Object.keys(scope).length
      ? ` (with ${Object.entries(scope)
          .map(([n, v]) => `${n} = ${short(v)}`)
          .join(', ')})`
      : '';
    for (const [id, geo] of geometry) {
      const { part } = geo;
      const q = `${p}.${part.path}`;
      if (part.kind === 'functions' && shown(id)) {
        const { undefinedAt } = sampleFunction(part.item, s, scope);
        if (undefinedAt !== null) {
          const v = part.item.x !== undefined ? 't' : 'x';
          const field = ['y', 'x'].find(
            (f) =>
              typeof part.item[f] === 'string' &&
              exprOf(part.item[f]).evaluate({ ...scope, [v]: undefinedAt }).overBudget,
          );
          warn(
            `undef:${id}`,
            field
              ? `${q}.${field}: its sums add more than ${MAX_EVAL_TERMS} terms at ${v} = ${short(undefinedAt)}${at} ${when(k)}, so it has no value there; use fewer terms or smaller bounds`
              : `${q}.y: has no value at ${v} = ${short(undefinedAt)}${at} ${when(k)}, so its line breaks there; check the expression, or start it past that point with from`,
          );
        }
        if (!geo.visible)
          warn(
            `off:${id}`,
            `${q}: draws nowhere on the plot${at} ${when(k)}: every value is outside the axes' ranges; widen the y axis or check the expression`,
          );
      } else if (part.kind === 'points' && !geo.visible && shown(id)) {
        const [x, y] = geo.data;
        warn(
          `off:${id}`,
          `${q}.at: lands at ${s.y ? `(${short(x)}, ${short(y)})` : short(x)}${at} ${when(k)}, outside the plot, so it is not drawn; move it inside the axes' ranges`,
        );
      } else if (part.kind === 'vectors' && !geo.visible && shown(id))
        warn(`off:${id}`, `${q}: lies outside the plot${at} ${when(k)}, so it is not drawn`);
      if (
        shown(id) &&
        labelPieces(part.item.label).some((x) => typeof x !== 'string' && !Number.isFinite(exprOf(x.expr).fn(scope)))
      )
        warn(`label:${id}`, `${q}.label: a {…} in it has no value${at} ${when(k)}, so it reads "?"`);
    }
    for (const label of plotLabels(s, axes, geometry, scope, shown)) {
      const q = `${p}.${partOf(s, label.id).path}.label`;
      if (label.off)
        warn(
          `loff:${label.id}`,
          `${q}: ${JSON.stringify(label.text)} runs off the stage ${when(k)}; shorten it, or give it a side with more room`,
        );
      else if (label.clash)
        warn(
          `clash:${label.id}`,
          `${q}: ${JSON.stringify(label.text)} overlaps ${label.clash === 'axis' ? 'the axis text' : `the label of "${label.clash}"`} ${when(k)}; shorten one, give a point a side, or move the parts apart`,
        );
    }
  });
}
