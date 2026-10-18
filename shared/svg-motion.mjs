// Motion on the `svg` scene: a step's `move` (a new transform, tweened from the old), `morph` (one path into the shape of
// another) and `trace` (a line drawn on from its start). Shared by shared/state-steps.mjs, which checks what a step
// names, the scene, which tweens it, and `validate`.

// ─── Transforms ───

/** What `move` takes: translate, rotate and scale, each with the arguments SVG gives it. */
const ARITY = { translate: [1, 2], rotate: [1, 3], scale: [1, 2] };

/**
 * A `transform` as a list of functions, such as [{ fn: "translate", args: [300, 0] }], with each one's arguments
 * filled in (translate(10) is translate(10 0), rotate(90) is rotate(90 0 0), scale(2) is scale(2 2)). Null when it is
 * anything else, such as matrix() or skewX(), which `move` does not tween.
 * @returns {{ fn: 'translate' | 'rotate' | 'scale', args: number[] }[] | null}
 */
export function parseTransform(text) {
  const source = String(text ?? '').trim();
  const out = [];
  let rest = source;
  while (rest) {
    const m = /^(\w+)\s*\(([^)]*)\)\s*,?\s*/.exec(rest);
    if (!m || !ARITY[m[1]]) return null;
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    const [min, max] = ARITY[m[1]];
    if (args.length < min || args.length > max || (m[1] === 'rotate' && args.length === 2) || !args.every(Number.isFinite)) return null;
    out.push({ fn: m[1], args: m[1] === 'translate' ? [args[0], args[1] ?? 0] : m[1] === 'scale' ? [args[0], args[1] ?? args[0]] : [args[0], args[1] ?? 0, args[2] ?? 0] });
    rest = rest.slice(m[0].length);
  }
  return out;
}

const round = (n) => Math.round(n * 1000) / 1000;
const write = (list) => list.map(({ fn, args }) => `${fn}(${args.map(round).join(' ')})`).join(' ');

/** A function that changes nothing, of the same kind as `f`: a rotation keeps its pivot so it turns about it. */
const identityOf = (f) => ({ fn: f.fn, args: f.fn === 'scale' ? [1, 1] : f.fn === 'rotate' ? [0, f.args[1], f.args[2]] : [0, 0] });

/** An affine matrix [a, b, c, d, e, f] for a function list. */
function matrixOf(list) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
  for (const { fn, args } of list) {
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, args[0], args[1]]);
    else if (fn === 'scale') m = mul(m, [args[0], 0, 0, args[1], 0, 0]);
    else {
      const r = (args[0] * Math.PI) / 180;
      m = mul(mul(mul(m, [1, 0, 0, 1, args[1], args[2]]), [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -args[1], -args[2]]);
    }
  }
  return m;
}

/** A matrix as translate, rotate and scale, so two can be tweened when their function lists differ. */
function decompose([a, b, c, d, e, f]) {
  const sx = Math.hypot(a, b);
  const angle = Math.atan2(b, a);
  const sy = sx ? (a * d - b * c) / sx : Math.hypot(c, d);
  return { tx: e, ty: f, angle: (angle * 180) / Math.PI, sx, sy };
}

/**
 * The transform partway, `t` from 0 to 1, from `from` to `to`, as CSS tweens one: function by function when the two
 * lists name the same functions in order (a missing list counts as changing nothing), so a rotation about a pivot turns
 * about it; otherwise each is taken apart into a move, a turn and a scale.
 */
export function tweenTransform(from, to, t) {
  const a = parseTransform(from) ?? [];
  const b = parseTransform(to) ?? [];
  if (t <= 0) return write(a);
  if (t >= 1) return write(b);
  const [pa, pb] = [a.length ? a : b.map(identityOf), b.length ? b : a.map(identityOf)];
  if (pa.length === pb.length && pa.every((f, i) => f.fn === pb[i].fn)) {
    return write(pa.map((f, i) => ({ fn: f.fn, args: f.args.map((v, j) => v + (pb[i].args[j] - v) * t) })));
  }
  const [x, y] = [decompose(matrixOf(pa)), decompose(matrixOf(pb))];
  let turn = y.angle - x.angle;
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  const at = (p, q) => p + (q - p) * t;
  return write([
    { fn: 'translate', args: [at(x.tx, y.tx), at(x.ty, y.ty)] },
    { fn: 'rotate', args: [x.angle + turn * t, 0, 0] },
    { fn: 'scale', args: [at(x.sx, y.sx), at(x.sy, y.sy)] },
  ]);
}

// ─── Paths ───

/**
 * A path's `d` as outlines of cubic curves in absolute coordinates: each outline's start, its curves as
 * [c1x, c1y, c2x, c2y, x, y], and whether it closes. Lines, quadratic curves and arcs become cubics, and a closing
 * `Z` becomes a straight curve back to the start, so any two paths can be tweened point by point. Throws a message on
 * a `d` that does not read.
 * @returns {{ start: [number, number], curves: number[][], closed: boolean }[]}
 */
export function cubicOutlines(d) {
  const text = String(d ?? '');
  const tokens = text.match(/[MLHVCSQTAZmlhvcsqtaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  if (tokens.join('').length < text.replace(/[\s,]/g, '').length) throw new Error(`"${text.slice(0, 40)}" has characters a path's d does not use`);
  const outlines = [];
  let cur = null;
  let [x, y] = [0, 0];
  let [lastC, lastQ] = [null, null];
  let i = 0;
  let cmd = null;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`"${text.slice(0, 40)}" ends partway through a command`);
    return v;
  };
  const line = (nx, ny) => cur.curves.push([x + (nx - x) / 3, y + (ny - y) / 3, x + (2 * (nx - x)) / 3, y + (2 * (ny - y)) / 3, nx, ny]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error(`"${text.slice(0, 40)}" must start with M`);
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    const px = (v) => (rel ? x + v : v);
    const py = (v) => (rel ? y + v : v);
    if (!cur && C !== 'M') throw new Error(`"${text.slice(0, 40)}" must start with M`);
    let [nextC, nextQ] = [null, null];
    if (C === 'Z') {
      if (x !== cur.start[0] || y !== cur.start[1]) line(cur.start[0], cur.start[1]);
      cur.closed = true;
      outlines.push(cur);
      [x, y] = cur.start;
      cur = { start: [x, y], curves: [], closed: false, pending: true };
      cmd = null;
      [lastC, lastQ] = [null, null];
      continue;
    }
    if (C === 'M') {
      const [nx, ny] = [px(num()), py(num())];
      if (cur && !cur.pending && cur.curves.length) outlines.push(cur);
      cur = { start: [nx, ny], curves: [], closed: false };
      [x, y] = [nx, ny];
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L' || C === 'H' || C === 'V') {
      const nx = C === 'V' ? x : px(num());
      const ny = C === 'H' ? y : py(num());
      line(nx, ny);
      [x, y] = [nx, ny];
    } else if (C === 'C' || C === 'S') {
      const [c1x, c1y] = C === 'S' ? (lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]) : [px(num()), py(num())];
      const [c2x, c2y, nx, ny] = [px(num()), py(num()), px(num()), py(num())];
      cur.curves.push([c1x, c1y, c2x, c2y, nx, ny]);
      nextC = [c2x, c2y];
      [x, y] = [nx, ny];
    } else if (C === 'Q' || C === 'T') {
      const [qx, qy] = C === 'T' ? (lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]) : [px(num()), py(num())];
      const [nx, ny] = [px(num()), py(num())];
      cur.curves.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
      nextQ = [qx, qy];
      [x, y] = [nx, ny];
    } else if (C === 'A') {
      const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
      const [nx, ny] = [px(num()), py(num())];
      cur.curves.push(...arcCurves(x, y, rx, ry, rot, large, sweep, nx, ny));
      [x, y] = [nx, ny];
    }
    if (cur.pending) delete cur.pending;
    [lastC, lastQ] = [nextC, nextQ];
  }
  if (cur && !cur.pending && cur.curves.length) outlines.push(cur);
  if (!outlines.length) throw new Error(`"${text.slice(0, 40)}" draws nothing`);
  return outlines.map(({ start, curves, closed }) => ({ start, curves, closed }));
}

/** An SVG arc as cubic curves, each a quarter turn or less (the SVG spec's endpoint-to-centre conversion). */
function arcCurves(x1, y1, rx, ry, rotation, large, sweep, x2, y2) {
  if ((x1 === x2 && y1 === y2) || !rx || !ry) return x1 === x2 && y1 === y2 ? [] : [[x1, y1, x2, y2, x2, y2]];
  [rx, ry] = [Math.abs(rx), Math.abs(ry)];
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const [x1p, y1p] = [cos * dx + sin * dy, -sin * dx + cos * dy];
  const grow = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (grow > 1) [rx, ry] = [rx * Math.sqrt(grow), ry * Math.sqrt(grow)];
  const sign = Boolean(large) === Boolean(sweep) ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const k = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const [cxp, cyp] = [(k * rx * y1p) / ry, (-k * ry * x1p) / rx];
  const [cx, cy] = [cos * cxp - sin * cyp + (x1 + x2) / 2, sin * cxp + cos * cyp + (y1 + y2) / 2];
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const kappa = (4 / 3) * Math.tan(step / 4);
  const point = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const tangent = (a) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  const out = [];
  for (let n = 0; n < parts; n++) {
    const [a0, a1] = [theta + n * step, theta + (n + 1) * step];
    const [p0, p1, t0, t1] = [point(a0), point(a1), tangent(a0), tangent(a1)];
    out.push([p0[0] + kappa * t0[0], p0[1] + kappa * t0[1], p1[0] - kappa * t1[0], p1[1] - kappa * t1[1], n === parts - 1 ? x2 : p1[0], n === parts - 1 ? y2 : p1[1]]);
  }
  return out;
}

/** Splits a cubic from (x, y) in half, de Casteljau, into two cubics. */
function halve([x, y], [c1x, c1y, c2x, c2y, ex, ey]) {
  const mid = (a, b) => (a + b) / 2;
  const [ax, ay, bx, by, cx, cy] = [mid(x, c1x), mid(y, c1y), mid(c1x, c2x), mid(c1y, c2y), mid(c2x, ex), mid(c2y, ey)];
  const [dx, dy, fx, fy] = [mid(ax, bx), mid(ay, by), mid(bx, cx), mid(by, cy)];
  const [mx, my] = [mid(dx, fx), mid(dy, fy)];
  return [[ax, ay, dx, dy, mx, my], [fx, fy, cx, cy, ex, ey]];
}

/** A cubic's control polygon's length, from (x, y): a little longer than the curve. */
const legs = (from, c) => Math.hypot(c[0] - from[0], c[1] - from[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]);

/** An outline split into `n` curves, halving the longest until it has that many. */
function splitTo(outline, n) {
  const curves = [...outline.curves];
  while (curves.length < n) {
    let best = 0;
    let bestLen = -1;
    let from = outline.start;
    curves.forEach((c, i) => {
      const len = legs(from, c);
      if (len > bestLen) [best, bestLen] = [i, len];
      from = [c[4], c[5]];
    });
    const start = best === 0 ? outline.start : [curves[best - 1][4], curves[best - 1][5]];
    curves.splice(best, 1, ...halve(start, curves[best]));
  }
  return { ...outline, curves };
}

/** A closed outline started at its curve `k`'s end instead, so two shapes line up corner to corner. */
function startAt(outline, k) {
  if (!k) return outline;
  const curves = [...outline.curves.slice(k), ...outline.curves.slice(0, k)];
  const last = curves[curves.length - 1];
  return { ...outline, start: [last[4], last[5]], curves };
}

/**
 * Two paths' `d` as outlines with the same number of curves, each pair of outlines started where the two lie closest,
 * ready to tween. Throws a message when they cannot pair: a `d` that does not read, or a different number of outlines.
 */
export function pairShapes(fromD, toD) {
  const [a, b] = [cubicOutlines(fromD), cubicOutlines(toD)];
  if (a.length !== b.length) throw new Error(`draws ${a.length} outline${a.length === 1 ? '' : 's'} and the other ${b.length}; a morph pairs them one to one, so give both the same number of M…Z parts`);
  const pairs = a.map((p, i) => {
    const q = b[i];
    const n = Math.max(p.curves.length, q.curves.length);
    const [sp, sq] = [splitTo(p, n), splitTo(q, n)];
    if (!(sp.closed && sq.closed)) return [sp, sq];
    // A closed outline may start anywhere on itself: start the second where its corners sit nearest the first's.
    let best = 0;
    let bestCost = Infinity;
    for (let k = 0; k < n; k++) {
      const r = startAt(sq, k);
      const cost = r.curves.reduce((sum, c, j) => sum + Math.hypot(c[4] - sp.curves[j][4], c[5] - sp.curves[j][5]), 0);
      if (cost < bestCost) [best, bestCost] = [k, cost];
    }
    return [sp, startAt(sq, best)];
  });
  return { from: pairs.map((p) => p[0]), to: pairs.map((p) => p[1]) };
}

/** Outlines partway, `t` from 0 to 1, from one paired shape to the other, as a `d`. */
export function tweenShape(paired, t) {
  const at = (p, q) => round(p + (q - p) * t);
  return paired.from
    .map((p, i) => {
      const q = paired.to[i];
      const start = `M${at(p.start[0], q.start[0])} ${at(p.start[1], q.start[1])}`;
      const curves = p.curves.map((c, j) => `C${c.map((v, k) => at(v, q.curves[j][k])).join(' ')}`).join('');
      return `${start}${curves}${(t < 0.5 ? p.closed : q.closed) ? 'Z' : ''}`;
    })
    .join('');
}

/** About how long a path is, in its own units: each curve's chord and control polygon averaged. */
export function pathLength(d) {
  try {
    return cubicOutlines(d).reduce((sum, o) => {
      let from = o.start;
      for (const c of o.curves) {
        sum += (Math.hypot(c[4] - from[0], c[5] - from[1]) + legs(from, c)) / 2;
        from = [c[4], c[5]];
      }
      return sum;
    }, 0);
  } catch {
    return 0;
  }
}

/** A state's moves and morphs by element id, as svgGeometry takes them: each moved transform, and each morphed path's new `d`. */
export function stateMotion(ids, state) {
  const byId = (record, value) => Object.fromEntries(Object.entries(record ?? {}).map(([key, v]) => [key.slice(2), value(v)]));
  return { transforms: byId(state.transforms, (v) => v), shapes: byId(state.shapes, (target) => ids.get(target)?.attrs?.d ?? '') };
}

const attrNum = (node, name) => Number.parseFloat(node.attrs[name] ?? '0') || 0;
const pointList = (text) => {
  const ns = String(text ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const out = [];
  for (let i = 0; i + 1 < ns.length; i += 2) out.push([ns[i], ns[i + 1]]);
  return out;
};
const along = (pts, closed) => pts.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0) + (closed && pts.length > 1 ? Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) : 0);

/** About how long the line a trace draws on an element is, in its own units; a group's is its longest line's. */
export function traceLength(node, d) {
  if (!node?.tag) return 0;
  const n = (name) => attrNum(node, name);
  switch (node.tag) {
    case 'path':
      return pathLength(d ?? node.attrs.d);
    case 'line':
      return Math.hypot(n('x2') - n('x1'), n('y2') - n('y1'));
    case 'polyline':
    case 'polygon':
      return along(pointList(node.attrs.points), node.tag === 'polygon');
    case 'rect':
      return 2 * (n('width') + n('height'));
    case 'circle':
      return 2 * Math.PI * n('r');
    case 'ellipse': {
      const [a, b] = [n('rx'), n('ry')];
      return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    }
    default:
      return Math.max(0, ...node.children.map((child) => traceLength(child)));
  }
}
