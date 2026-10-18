// The `svg` scene's drawing: SVG markup the storyboard writes, parsed and cut down to drawing elements at the
// boundary. Shared by the scene (which renders the parsed tree, never the markup), shared/targets.mjs and
// shared/state-steps.mjs (which name its elements by id) and `validate` (which reports what it cut).

import { measure } from './textfit.mjs';

/** Elements the scene draws. Everything else (script, foreignObject, image, style, a, animate...) is cut. */
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan',
  'marker', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'use',
]);

/** Attributes any drawing element may carry. */
const COMMON = [
  'id', 'class', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'marker-start',
  'marker-mid', 'marker-end', 'font-size', 'font-weight', 'font-family', 'font-style', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'letter-spacing', 'vector-effect', 'paint-order', 'display', 'visibility',
];
const GEOMETRY = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'points', 'd', 'dx', 'dy', 'rotate', 'pathLength', 'textLength', 'lengthAdjust'];
const ATTRIBUTES = new Set([
  ...COMMON, ...GEOMETRY,
  'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'version',
  'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits',
  'href', 'xlink:href',
]);

/** Colours a drawing can name as `var(--name)`, the player's own palette. Kept in step with src/components/theme.ts and tones.ts. */
export const SVG_COLORS = {
  text: '#f2f4f8',
  muted: '#9097a8',
  faint: '#5b6172',
  bg: '#07080c',
  surface: '#1a1d28',
  border: 'rgba(255, 255, 255, 0.16)',
  accent: '#7c8cff',
  good: '#3ddc97',
  bad: '#ff6b7a',
  warn: '#fbbf24',
  neutral: '#8f98ad',
};
export const SVG_TONES = ['accent', 'good', 'bad', 'warn', 'neutral'];

/** The font size SVG text takes when nothing sets one, in viewBox units. */
export const DEFAULT_FONT = 16;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });

/**
 * A drawing element: its tag, its kept attributes, and its children; a text run is { text }.
 * @typedef {{ tag: string, attrs: Record<string, string>, children: SvgNode[] } | { text: string }} SvgNode
 */

/**
 * Parses SVG markup into elements. Throws a message on markup that does not parse: an unclosed or mismatched tag,
 * a stray `<`, or text outside the root.
 */
function parse(markup) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  const cut = [];
  while ((m = re.exec(markup))) {
    const [all, close, open, attrs, selfClose, text, stray] = m;
    const top = stack[stack.length - 1];
    if (stray) throw new Error(`the tag at character ${m.index} does not parse ("${markup.slice(m.index, m.index + 30)}"); every attribute needs a quoted value`);
    if (text !== undefined) {
      // A space between two tspans is a word break the text draws; elsewhere whitespace is only layout.
      if (text.trim() || top.tag === 'text' || top.tag === 'tspan') top.children.push({ text: decode(text) });
      continue;
    }
    if (close) {
      if (top.tag !== close) throw new Error(`</${close}> closes ${top.tag === '#root' ? 'nothing' : `<${top.tag}>`}`);
      stack.pop();
      continue;
    }
    if (!open) {
      if (all.startsWith('<![CDATA[')) cut.push('a CDATA section');
      else if (all.startsWith('<!') && !all.startsWith('<!--')) cut.push(`"${all.slice(0, 20)}"`);
      continue;
    }
    const node = { tag: open, attrs: {}, children: [] };
    for (const a of attrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[2] ?? a[3]);
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].tag}> is never closed`);
  return { root, cut };
}

/** Attributes that paint: a colour, or `url(#id)` for a gradient in the drawing. */
const PAINTS = new Set(['fill', 'stroke']);
/** Attributes that point at an element of the drawing: `none` or `url(#id)`. */
const REFERENCES = new Set(['clip-path', 'marker-start', 'marker-mid', 'marker-end']);
/** A colour: hex, a keyword such as `none`, `currentColor` or `white`, rgb() or hsl() of numbers, or a palette `var(--name)`. */
const COLOUR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|(?:rgba?|hsla?)\(\s*[-+\d.%\s,/]*\)|var\(\s*--[\w-]+\s*\))$/i;
const LOCAL_REF = /^url\(\s*(['"]?)#([\w.:-]+)\1\s*\)$/i;
/** The classes the scene reads, tones and `flow`; the player's own classes never reach a drawing. */
const TONE_CLASS = new RegExp(`^(?:(?:tone|fill|stroke)-(?:${SVG_TONES.join('|')})|flow)$`);
/** Attributes the scene sets itself on the root `<svg>`, where the drawing is placed on its stage. */
const PLACED = new Set(['transform', 'x', 'y']);

/**
 * A kept attribute's value, or a problem saying why it is cut. Paint and references are allowlisted, since CSS
 * reads `url()` in fill, stroke, clip-path and markers and would load from outside the drawing.
 * @returns {{ value: string, ref?: string } | { problem: string }}
 */
function attribute(name, value) {
  if (value.includes('\\')) return { problem: `"${value}" has a backslash, which CSS reads as an escape, so it is cut` };
  if (/javascript:|expression\s*\(|@import/i.test(value)) return { problem: `"${value}" is cut` };
  const local = LOCAL_REF.exec(value.trim());
  if (local && (PAINTS.has(name) || REFERENCES.has(name))) return { value: `url(#${local[2]})`, ref: local[2] };
  if (PAINTS.has(name) || name === 'stop-color') {
    return COLOUR.test(value.trim()) ? { value } : { problem: `"${value}" is no colour, so it is cut; a ${name} is a colour such as #7c8cff, none, currentColor or var(--good)${name === 'stop-color' ? '' : ', or url(#id) for a gradient in the drawing'}` };
  }
  if (REFERENCES.has(name)) return value.trim() === 'none' ? { value } : { problem: `"${value}" is not url(#id), so it is cut; point at a ${name === 'clip-path' ? 'clip path' : 'marker'} in the drawing, url(#id), or write none` };
  if (/url\s*\(/i.test(value)) return { problem: `"${value}" loads from outside the drawing, so it is cut; use url(#id) in fill, stroke, clip-path or a marker` };
  return { value };
}

/**
 * Parses a drawing and keeps only what draws: the elements and attributes above, `url(#id)` and `href="#id"`
 * pointing inside it, and `var(--name)` for a palette colour. Returns the kept tree (the root `<svg>`), its
 * viewBox, its elements by id, and a problem for each thing cut or broken, as words for `validate`.
 * @returns {{ root: SvgNode | null, viewBox: [number, number, number, number] | null, ids: Map<string, SvgNode>, problems: string[] }}
 */
export function readSvg(markup) {
  const problems = [];
  const ids = new Map();
  if (typeof markup !== 'string' || !markup.trim()) return { root: null, viewBox: null, ids, problems: ['is empty; give the drawing as SVG markup, "<svg viewBox=\\"0 0 400 300\\">...</svg>"'] };
  let parsed;
  try {
    parsed = parse(markup);
  } catch (e) {
    return { root: null, viewBox: null, ids, problems: [`does not parse: ${e.message}`] };
  }
  for (const c of parsed.cut) problems.push(`has ${c}, which is cut`);
  const tops = parsed.root.children;
  const root = tops.find((n) => n.tag);
  if (!root || root.tag !== 'svg' || tops.length !== 1) return { root: null, viewBox: null, ids, problems: [...problems, 'must be one <svg> element with the drawing inside it'] };
  const vb = String(root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? vb : null;
  if (!viewBox) problems.push(`<svg> needs a viewBox of four numbers with a positive width and height, such as viewBox="0 0 400 300"; ${root.attrs.viewBox === undefined ? 'it has none' : `"${root.attrs.viewBox}" is not one`}`);

  const refs = [];
  const keep = (node, path) => {
    if (!node.tag) return node;
    const where = `${path}<${node.tag}${node.attrs.id ? ` id="${node.attrs.id}"` : ''}>`;
    if (!ELEMENTS.has(node.tag) || (node.tag === 'svg' && path)) {
      problems.push(`${where} is not drawn, so it is cut; a drawing uses ${[...ELEMENTS].filter((e) => e !== 'svg').join(', ')}`);
      return null;
    }
    const attrs = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      if (/^on/i.test(name)) problems.push(`${where} ${name}: an event handler is cut`);
      else if (name === 'style') problems.push(`${where} style: a style attribute is cut; set fill, stroke and the rest as attributes`);
      else if (!ATTRIBUTES.has(name)) problems.push(`${where} ${name}: not a drawing attribute, so it is cut`);
      else if (!path && PLACED.has(name)) problems.push(`${where} ${name}: the scene places the drawing on its stage, so ${name} on the root <svg> is cut; put it on a <g> inside`);
      else if (name === 'class') {
        const [kept, cut] = [[], []];
        for (const c of value.split(/\s+/).filter(Boolean)) (TONE_CLASS.test(c) ? kept : cut).push(c);
        if (cut.length) problems.push(`${where} class: ${cut.map((c) => `"${c}"`).join(', ')} ${cut.length === 1 ? 'is no tone class, so it is' : 'are no tone classes, so they are'} cut; a class is tone-, fill- or stroke- and one of ${SVG_TONES.join(', ')}, such as tone-good, or flow for marching dashes along a line`);
        if (kept.length) attrs.class = kept.join(' ');
      } else if (name === 'href' || name === 'xlink:href') {
        if (!/^#[\w.:-]+$/.test(value)) problems.push(`${where} ${name}: "${value}" points outside the drawing, so it is cut; point at an element's id, "#arrow"`);
        else (refs.push([where, name, value.slice(1)]), (attrs.href = value));
      } else {
        const kept = attribute(name, value);
        if ('problem' in kept) problems.push(`${where} ${name}: ${kept.problem}`);
        else {
          if (kept.ref) refs.push([where, name, kept.ref]);
          attrs[name] = kept.value;
        }
      }
    }
    for (const v of Object.values(attrs)) {
      for (const [, name] of v.matchAll(/var\(\s*--([\w-]+)\s*\)/g)) {
        if (!Object.hasOwn(SVG_COLORS, name)) problems.push(`${where}: var(--${name}) is no palette colour; they are ${Object.keys(SVG_COLORS).map((c) => `--${c}`).join(', ')}`);
      }
    }
    if (attrs.id !== undefined) {
      if (ids.has(attrs.id)) problems.push(`${where}: id "${attrs.id}" is taken; every id is different`);
      ids.set(attrs.id, null);
    }
    const out = { tag: node.tag, attrs, children: [] };
    for (const child of node.children) {
      if (!child.tag && !['text', 'tspan', 'title', 'desc'].includes(node.tag)) {
        problems.push(`${where} holds text "${child.text.trim().slice(0, 30)}", which only <text> draws, so it is cut`);
        continue;
      }
      const kept = keep(child, `${where} `);
      if (kept) out.children.push(kept);
    }
    if (attrs.id !== undefined) ids.set(attrs.id, out);
    return out;
  };
  const kept = keep(root, '');
  for (const [where, name, id] of refs) if (!ids.has(id)) problems.push(`${where} ${name}: points at "#${id}", which no element has as its id`);
  return { root: kept, viewBox, ids, problems };
}

const cache = new Map();
/** readSvg, once per markup. */
export function svgOf(markup) {
  const key = String(markup ?? '');
  if (!cache.has(key)) {
    if (cache.size > 50) cache.clear();
    cache.set(key, readSvg(markup));
  }
  return cache.get(key);
}

/** The ids of a drawing's elements, in document order. */
export const svgIds = (markup) => [...svgOf(markup).ids.keys()];

/** The text an element holds, its own and its tspans', as one line. */
export function textOf(node) {
  if (!node) return '';
  if (!node.tag) return node.text;
  return node.children.map(textOf).join('').replace(/\s+/g, ' ').trim();
}

// ─── Where things land ───

/** An affine matrix [a, b, c, d, e, f], mapping (x, y) to (a x + c y + e, b x + d y + f). */
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A `transform` attribute as one matrix. */
export function transformOf(text) {
  let m = IDENTITY;
  for (const [, fn, args] of String(text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let n = IDENTITY;
    if (fn === 'translate') n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      n = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'matrix' && a.length === 6) n = a;
    else if (fn === 'skewX') n = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (fn === 'skewY') n = [1, Math.tan(rad), 0, 1, 0, 0];
    m = multiply(m, n);
  }
  return m;
}

const num = (v, d = 0) => (Number.isFinite(Number.parseFloat(v)) ? Number.parseFloat(v) : d);
const pairs = (text) => {
  const ns = String(text ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const out = [];
  for (let i = 0; i + 1 < ns.length; i += 2) out.push([ns[i], ns[i + 1]]);
  return out;
};

/** The points a path passes or bends towards, close enough to box it: every end point, control point and arc's reach. */
function pathPoints(d) {
  const out = [];
  let [x, y, sx, sy] = [0, 0, 0, 0];
  for (const [, cmd, args] of String(d ?? '').matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const at = (px, py) => (rel ? [x + px, y + py] : [px, py]);
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      [x, y] = [sx, sy];
      continue;
    }
    const size = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[C];
    for (let i = 0; i + size <= n.length; i += size) {
      const a = n.slice(i, i + size);
      if (C === 'H') x = rel ? x + a[0] : a[0];
      else if (C === 'V') y = rel ? y + a[0] : a[0];
      else if (C === 'A') {
        const [ex, ey] = at(a[5], a[6]);
        out.push([x - a[0], y - a[1]], [x + a[0], y + a[1]], [ex - a[0], ey - a[1]], [ex + a[0], ey + a[1]]);
        [x, y] = [ex, ey];
      } else {
        for (let j = 0; j + 2 < size; j += 2) out.push(at(a[j], a[j + 1]));
        [x, y] = at(a[size - 2], a[size - 1]);
      }
      out.push([x, y]);
      if (C === 'M' && i === 0) [sx, sy] = [x, y];
    }
  }
  return out;
}

/** The font an element's text draws in: its own size and weight, else its parents'. */
const fontOf = (node, inherited) => ({
  size: num(node.attrs['font-size'], inherited.size),
  weight: num(node.attrs['font-weight'] === 'bold' ? 700 : node.attrs['font-weight'], inherited.weight),
  family: /mono/i.test(node.attrs['font-family'] ?? '') ? 'mono' : node.attrs['font-family'] ? 'sans' : inherited.family,
  anchor: node.attrs['text-anchor'] ?? inherited.anchor,
});

/** The first number of an x or y list, or none. */
const firstOf = (v) => (v === undefined ? undefined : num(String(v).trim().split(/[\s,]+/)[0]));

/**
 * A text element laid out run by run, measured in the player's own font: its box, the box of each `<tspan>` with an id,
 * and its smallest font size. Whitespace collapses across the runs as SVG collapses it. A tspan's own `x` or `y` starts
 * a new chunk, which its `text-anchor` places; `dx` and `dy` shift the pen.
 */
function textLayout(node, font) {
  const chunks = [];
  const pen = { x: 0, y: 0 };
  let chunk = null;
  let smallest = font.size;
  const runs = [];
  const width = (text, f) => measure(text, { family: f.family, weight: Math.min(800, Math.max(400, f.weight)), size: f.size });
  const start = (n, f) => {
    const [x, y] = [firstOf(n.attrs.x), firstOf(n.attrs.y)];
    if (x !== undefined || y !== undefined || !chunk) {
      chunk = { anchor: f.anchor, from: (pen.x = x ?? pen.x) };
      chunks.push(chunk);
      pen.y = y ?? pen.y;
    }
    pen.x += num(n.attrs.dx);
    pen.y += num(n.attrs.dy);
  };
  const walk = (n, f, owners) => {
    for (const child of n.children) {
      if (child.tag === 'tspan') {
        const g = fontOf(child, f);
        start(child, g);
        walk(child, g, child.attrs.id !== undefined ? [...owners, child.attrs.id] : owners);
      } else if (!child.tag) {
        let text = child.text.replace(/\s+/g, ' ');
        if (!runs.length || runs.at(-1).text.endsWith(' ')) text = text.replace(/^ /, '');
        if (!text) continue;
        runs.push({ text, chunk, x: pen.x, y: pen.y, width: width(text, f), f, owners });
        smallest = Math.min(smallest, f.size);
        pen.x += runs.at(-1).width;
      }
    }
  };
  start(node, font);
  walk(node, font, []);
  // A space at the very end of the text is not drawn.
  const last = runs.at(-1);
  if (last?.text.endsWith(' ')) last.width = width(last.text.trimEnd(), last.f);
  const all = [];
  const spans = new Map();
  for (const c of chunks) {
    const mine = runs.filter((r) => r.chunk === c);
    if (!mine.length) continue;
    const span = Math.max(...mine.map((r) => r.x + r.width)) - c.from;
    const shift = c.anchor === 'middle' ? -span / 2 : c.anchor === 'end' ? -span : 0;
    for (const r of mine) {
      const corners = [[r.x + shift, r.y - 0.8 * r.f.size], [r.x + shift + r.width, r.y + 0.25 * r.f.size]];
      all.push(...corners);
      for (const id of r.owners) spans.set(id, [...(spans.get(id) ?? []), ...corners]);
    }
  }
  return { local: all, spans, smallest };
}

/**
 * Every element's box in viewBox units, by id, and every text element with its box, its size in viewBox units and
 * the ids of it and the groups it is in: what the scene's pen marks circle and what `validate` measures. `motion`
 * places the drawing as a step leaves it: a moved element's transform (outside its own) and a morphed path's `d`, by id.
 * @returns {{ boxes: Map<string, {x:number,y:number,width:number,height:number}>, texts: { id?: string, text: string, size: number, box: {x:number,y:number,width:number,height:number}, owners: string[] }[] }}
 */
export function svgGeometry(root, motion = {}) {
  const boxes = new Map();
  const texts = [];
  const moves = motion.transforms ?? {};
  const shapes = motion.shapes ?? {};
  const visit = (node, m, font, owners) => {
    if (!node?.tag || ['defs', 'marker', 'clipPath', 'linearGradient', 'radialGradient', 'title', 'desc'].includes(node.tag)) return [];
    const id = node.attrs.id;
    const moved = id !== undefined && moves[id] ? `${moves[id]} ` : '';
    const mm = multiply(m, transformOf(`${moved}${node.attrs.transform ?? ''}`));
    const mine = id !== undefined ? [...owners, id] : owners;
    const f = fontOf(node, font);
    const a = node.attrs;
    let local = [];
    if (node.tag === 'rect') local = [[num(a.x), num(a.y)], [num(a.x) + num(a.width), num(a.y) + num(a.height)]];
    else if (node.tag === 'circle') local = [[num(a.cx) - num(a.r), num(a.cy) - num(a.r)], [num(a.cx) + num(a.r), num(a.cy) + num(a.r)]];
    else if (node.tag === 'ellipse') local = [[num(a.cx) - num(a.rx), num(a.cy) - num(a.ry)], [num(a.cx) + num(a.rx), num(a.cy) + num(a.ry)]];
    else if (node.tag === 'line') local = [[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]];
    else if (node.tag === 'polyline' || node.tag === 'polygon') local = pairs(a.points);
    else if (node.tag === 'path') local = pathPoints((id !== undefined && shapes[id]) || a.d);
    const laid = node.tag === 'text' ? textLayout(node, f) : null;
    if (laid) local = laid.local;
    const pts = placed(local, mm);
    if (node.tag !== 'text') for (const child of node.children) pts.push(...visit(child, mm, f, mine));
    const box = boxOf(pts);
    for (const [span, corners] of laid?.spans ?? []) boxes.set(span, boxOf(placed(corners, mm)));
    if (node.tag === 'text' && box) texts.push({ id: a.id, text: textOf(node), size: laid.smallest * Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])), box, owners: mine });
    if (a.id !== undefined && box) boxes.set(a.id, box);
    return pts;
  };
  if (root) for (const child of root.children) visit(child, IDENTITY, { size: DEFAULT_FONT, weight: 400, family: 'sans', anchor: 'start' }, []);
  return { boxes, texts };
}

/** The four corners of the box round some points, through a matrix, so a rotation keeps the whole of it. */
function placed(local, m) {
  if (!local.length) return [];
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map((p) => apply(m, p));
}

function boxOf(pts) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Where a viewBox lands in a box: scaled to fit whole and centred, as the scene draws it. */
export function svgStage(viewBox, box) {
  const [vx, vy, vw, vh] = viewBox;
  const scale = Math.min(box.width / vw, box.height / vh);
  return { scale, left: (box.width - vw * scale) / 2 - vx * scale, top: (box.height - vh * scale) / 2 - vy * scale };
}
