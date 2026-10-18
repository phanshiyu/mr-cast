// The map scene's world: the bundled country outlines, what a scene's places, routes, lines and regions are on the
// globe, the projection, and where each view puts the camera. Shared by the scene, which draws them, and `validate`,
// which checks them. A storyboard writes points as [lat, lng]; everything here keeps GeoJSON's [lng, lat].

import {
  geoArea,
  geoBounds,
  geoCentroid,
  geoDistance,
  geoEqualEarth,
  geoInterpolate,
  geoMercator,
  geoNaturalEarth1,
  geoPath,
} from 'd3-geo';
import { plainText } from './markup.mjs';
import { tintEntries } from './storyboard-json.mjs';
import { measure } from './textfit.mjs';

export const PROJECTIONS = { 'equal-earth': geoEqualEarth, 'natural-earth': geoNaturalEarth1, mercator: geoMercator };
const DEFAULT_PROJECTION = 'equal-earth';
export const MAP_SIDES = ['right', 'left', 'above', 'below'];
/** The narrowest view, in degrees: the 1:50m outline shows no more detail inside it. */
export const MIN_SPAN = 0.5;
/** How many degrees a view of a single point frames. */
const POINT_SPAN = 8;
/** Above this zoom on the whole world the scene draws the 1:50m outline instead of the 1:110m. */
const FINE_ZOOM = 4;
/** Share of the stage a view leaves round what it frames, on each side. */
const PAD = 0.08;
/** Degrees between the points a route or line is drawn through, so each short piece is near its true path. */
const ROUTE_STEP = 1;
const LINE_STEP = 0.5;
const EDGE_STEP = 1;
export const LABEL_FONT = { family: 'sans', weight: 600, size: 26 };
export const DOT_RADIUS = 9;
const LABEL_GAP = 10;

const list = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** A storyboard point: [lat, lng] with lat in -90..90 and lng in -180..180. */
export const isLatLng = (v) =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;

function decode(data) {
  const q = data.quantum;
  // Natural Earth draws an edge straight in longitude and latitude, and d3-geo as a great circle, which bows away from
  // a long parallel such as the 49th; points every EDGE_STEP degrees keep each edge on its parallel.
  const ring = (r) => {
    const out = [];
    for (let i = 0, x = 0, y = 0; i < r.length; i += 2) {
      const [px, py] = [x, y];
      [x, y] = [x + r[i], y + r[i + 1]];
      const n = i ? Math.ceil(Math.max(Math.abs(x - px), Math.abs(y - py)) / q / EDGE_STEP) : 1;
      for (let j = 1; j < n; j++) out.push([(px + ((x - px) * j) / n) / q, (py + ((y - py) * j) / n) / q]);
      out.push([x / q, y / q]);
    }
    return out;
  };
  return new Map(
    data.countries.map(([code, names, label, polygons]) => [
      code,
      { code, names, label, geometry: { type: 'MultiPolygon', coordinates: polygons.map((p) => p.map(ring)) } },
    ]),
  );
}
/** The bundled outline once loadWorld has read it: { coarse, fine }, the 1:110m and 1:50m countries. */
let world = null;
/**
 * Reads the bundled outline, once. Every function here that names or draws a country needs it, so a caller with a map
 * scene awaits this first. It is a dynamic import, so the player's main chunk carries no outline and a storyboard
 * without a map never parses it.
 */
export async function loadWorld() {
  if (world) return;
  const [coarse, fine] = await Promise.all([import('./world/ne-110m.mjs'), import('./world/ne-50m.mjs')]);
  world = { coarse: coarse.default, fine: fine.default };
}
export const worldLoaded = () => world !== null;
/** Whether a storyboard has a map scene, so its reader must loadWorld first. */
export const needsWorld = (storyboard) => list(storyboard?.scenes).some((s) => s?.type === 'map');
const decoded = {};
/** The countries at a detail, "110m" or "50m", by code. */
export function countriesAt(detail) {
  if (!world) throw new Error('the world outline is not loaded; await loadWorld() before reading a map scene');
  return (decoded[detail] ??= decode(detail === '110m' ? world.coarse : world.fine));
}

/** The code a ref names a country by: its code ("CAN") or one of its names, any case ("Canada"); null otherwise. */
export function countryCode(ref) {
  if (typeof ref !== 'string') return null;
  const all = countriesAt('50m');
  if (all.has(ref)) return ref;
  const want = ref.trim().toLowerCase();
  for (const c of all.values()) if (c.names.some((n) => n.toLowerCase() === want)) return c.code;
  return null;
}
/** Every country code and name, for "did you mean" hints. */
export const countryNames = () => [...countriesAt('50m').values()].flatMap((c) => [c.code, ...c.names]);
/** A country's first name, such as "Canada". */
export const countryName = (code) => countriesAt('50m').get(code)?.names[0] ?? code;

const KINDS = [
  ['places', 'mp:', 'place'],
  ['routes', 'mr:', 'route'],
  ['lines', 'ml:', 'line'],
  ['regions', 'mg:', 'region'],
];
/** The item keys a ref names: "map" for the whole map, a country by code or name, or a place, route, line or region id. */
export function mapRef(scene, ref) {
  if (typeof ref !== 'string') return null;
  if (ref === 'map') return ['m:map'];
  for (const [field, prefix] of KINDS)
    if (list(scene?.[field]).some((item) => item?.id === ref)) return [`${prefix}${ref}`];
  const code = countryCode(ref);
  return code ? [`mc:${code}`] : null;
}
/** The refs worth suggesting: every id, "map", and every country code and name. */
export const mapRefNames = (scene) => [
  'map',
  ...KINDS.flatMap(([field]) => list(scene?.[field]).map((item) => item?.id)),
  ...countryNames(),
];

/** A place's point as [lng, lat]: its own, or its country's label point. */
export function placePoint(at) {
  if (isLatLng(at)) return [at[1], at[0]];
  const code = countryCode(at);
  return code ? countriesAt('50m').get(code).label : null;
}

/**
 * Whether a and b, both [lng, lat], are opposite each other on the globe, where every great circle through one passes
 * through the other, so a leg between them has no one way to go.
 */
export const antipodal = (a, b) => geoDistance(a, b) > Math.PI - 1e-6;

/** Points every `step` degrees along the great circle from a to b, both [lng, lat], ends included. */
function greatCircle(a, b, step) {
  const n = Math.max(1, Math.ceil((geoDistance(a, b) * 180) / Math.PI / step));
  const at = geoInterpolate(a, b);
  return Array.from({ length: n + 1 }, (_, i) => at(i / n));
}

/** A polygon ring closed and wound as d3-geo reads an area smaller than half the globe. */
function polygonOf(points) {
  const ring = [...points, points[0]];
  return geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI
    ? { type: 'Polygon', coordinates: [ring.reverse()] }
    : { type: 'Polygon', coordinates: [ring] };
}

const cache = new WeakMap();
/**
 * A scene's places, routes, lines and regions on the globe, by item key: each one's geometry, label and tone, and for a
 * route or line its path as points in drawing order. Items that do not resolve are left out (validate names them).
 */
export function mapItems(scene) {
  if (cache.has(scene)) return cache.get(scene);
  const items = new Map();
  const places = new Map();
  for (const p of list(scene.places)) {
    const point = placePoint(p?.at);
    if (!point || typeof p.id !== 'string') continue;
    places.set(p.id, point);
    items.set(`mp:${p.id}`, {
      kind: 'place',
      id: p.id,
      point,
      geometry: { type: 'Point', coordinates: point },
      label: p.label ?? '',
      dot: p.dot ?? isLatLng(p.at),
      side: MAP_SIDES.includes(p.side) ? p.side : (p.dot ?? isLatLng(p.at)) ? 'right' : null,
      tone: p.tone,
    });
  }
  const stop = (s) => (isLatLng(s) ? [s[1], s[0]] : (places.get(s) ?? null));
  for (const r of list(scene.routes)) {
    const stops = list(r?.stops).map(stop);
    if (typeof r?.id !== 'string' || stops.length < 2 || stops.some((s) => !s)) continue;
    const path = stops.slice(1).flatMap((b, i) => greatCircle(stops[i], b, ROUTE_STEP).slice(i ? 1 : 0));
    items.set(`mr:${r.id}`, {
      kind: 'route',
      id: r.id,
      path,
      geometry: { type: 'LineString', coordinates: path },
      label: r.label ?? '',
      tone: r.tone,
    });
  }
  for (const l of list(scene.lines)) {
    if (typeof l?.id !== 'string') continue;
    const parallel = isNum(l.lat);
    if (parallel === isNum(l.lng)) continue;
    const [lo, hi] = parallel ? [-180, 180] : [-90, 90];
    const [from, to] = [isNum(l.from) ? l.from : lo, isNum(l.to) ? l.to : hi];
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / LINE_STEP));
    const path = Array.from({ length: n + 1 }, (_, i) => {
      const v = from + ((to - from) * i) / n;
      return parallel ? [v, l.lat] : [l.lng, v];
    });
    items.set(`ml:${l.id}`, {
      kind: 'line',
      id: l.id,
      path,
      geometry: { type: 'LineString', coordinates: path },
      label: l.label ?? '',
      tone: l.tone,
    });
  }
  for (const g of list(scene.regions)) {
    if (typeof g?.id !== 'string') continue;
    let geometry = null;
    if (Array.isArray(g.outline) && g.outline.length >= 3 && g.outline.every(isLatLng))
      geometry = polygonOf(g.outline.map(([lat, lng]) => [lng, lat]));
    else if (Array.isArray(g.countries) && g.countries.length) {
      const codes = g.countries.map(countryCode);
      if (codes.every(Boolean))
        geometry = {
          type: 'MultiPolygon',
          coordinates: codes.flatMap((c) => countriesAt('50m').get(c).geometry.coordinates),
        };
    }
    if (geometry)
      items.set(`mg:${g.id}`, {
        kind: 'region',
        id: g.id,
        geometry,
        countries: Array.isArray(g.countries) && !g.outline ? g.countries.map(countryCode) : null,
        center: geoCentroid(geometry),
        label: g.label ?? '',
        tone: g.tone,
      });
  }
  cache.set(scene, items);
  return items;
}

/** Route and line keys some step traces: they start undrawn, as though hidden, until their first trace. */
export function tracedKeys(scene) {
  const ids = new Set(
    list(scene.steps).flatMap((s) => list(s?.trace).map((t) => (t && typeof t === 'object' ? t.ref : t))),
  );
  return [...list(scene.routes).map((r) => ['mr', r?.id]), ...list(scene.lines).map((l) => ['ml', l?.id])].flatMap(
    ([kind, id]) => (ids.has(id) ? [`${kind}:${id}`] : []),
  );
}

/** The geometry an item key names, a country's at the 1:50m outline. */
function keyGeometry(scene, key) {
  if (key.startsWith('mc:')) return countriesAt('50m').get(key.slice(3))?.geometry ?? null;
  return mapItems(scene).get(key)?.geometry ?? null;
}

/**
 * What a view frames on the globe, as [[west, south], [east, north]] (west past east when it crosses 180°), or null
 * for the whole world: "world", refs it fits round, or { box: [[lat, lng], [lat, lng]] } from south-west to north-east.
 */
function viewBounds(scene, view) {
  if (view === undefined || view === 'world') return null;
  let bounds = null;
  if (Array.isArray(view)) {
    const geometries = view
      .flatMap((ref) => (mapRef(scene, ref) ?? []).flatMap((key) => (key === 'm:map' ? [] : [keyGeometry(scene, key)])))
      .filter(Boolean);
    if (!geometries.length) return null;
    bounds = geoBounds({ type: 'GeometryCollection', geometries });
  } else if (
    view &&
    typeof view === 'object' &&
    Array.isArray(view.box) &&
    view.box.length === 2 &&
    view.box.every(isLatLng)
  ) {
    const [[s, w], [n, e]] = view.box;
    bounds = [
      [w, s],
      [e, n],
    ];
  } else return null;
  const [[w, s], [e, n]] = bounds;
  const width = e >= w ? e - w : e + 360 - w;
  // A view of points alone, such as one place, frames the land round it.
  const least = width === 0 && n === s ? POINT_SPAN : MIN_SPAN;
  const grow = (lo, hi, span) => (span >= least ? [lo, hi] : [lo - (least - span) / 2, hi + (least - span) / 2]);
  const [w2, e2] = grow(w, e >= w ? e : e + 360, width);
  const [s2, n2] = grow(s, n, n - s);
  return [
    [w2, Math.max(-89, s2)],
    [e2 > 180 ? e2 - 360 : e2, Math.min(89, n2)],
  ];
}

/** How many degrees across and up a view frames, before MIN_SPAN widens it; null for the whole world. */
export function viewSpan(scene, view) {
  if (view === undefined || view === 'world') return null;
  if (view && typeof view === 'object' && !Array.isArray(view) && Array.isArray(view.box) && view.box.every(isLatLng)) {
    const [[s, w], [n, e]] = view.box;
    return [e >= w ? e - w : e + 360 - w, n - s];
  }
  if (!Array.isArray(view)) return null;
  const geometries = view
    .flatMap((ref) => (mapRef(scene, ref) ?? []).filter((k) => k !== 'm:map').map((key) => keyGeometry(scene, key)))
    .filter(Boolean);
  if (!geometries.length) return null;
  const [[w, s], [e, n]] = geoBounds({ type: 'GeometryCollection', geometries });
  return [e >= w ? e - w : e + 360 - w, n - s];
}

/** The views each state shows: the scene's, then each step's from that step on. */
function mapViews(scene) {
  const views = [scene.view ?? 'world'];
  for (const step of list(scene.steps)) views.push(step?.view ?? views[views.length - 1]);
  return views;
}

/** The central meridian: the scene's own, else the middle of what its views frame when none is the whole world. */
function meridianOf(scene) {
  if (isNum(scene.meridian)) return scene.meridian;
  const views = mapViews(scene);
  if (views.some((v) => viewBounds(scene, v) === null)) return 0;
  const all = views.map((v) => viewBounds(scene, v));
  const [[w], [e]] = geoBounds({
    type: 'MultiPoint',
    coordinates: all.flatMap(([[w0, s], [e0, n]]) => [
      [w0, s],
      [e0, n],
    ]),
  });
  const mid = e >= w ? (w + e) / 2 : (w + e + 360) / 2;
  return Math.round(mid > 180 ? mid - 360 : mid);
}

/**
 * The projection a scene draws through, fitted so the whole world fills `stage` at zoom 1, and the world's box on
 * it. A camera { k, x, y } then puts projected point p at p * k + [x, y].
 */
export function mapProjection(scene, stage) {
  const make = PROJECTIONS[Object.hasOwn(PROJECTIONS, scene.projection) ? scene.projection : DEFAULT_PROJECTION];
  const meridian = meridianOf(scene);
  const mercator = make === geoMercator;
  const world = mercator
    ? {
        type: 'MultiPoint',
        coordinates: [
          [meridian - 179.9, -58],
          [meridian + 179.9, 84],
        ],
      }
    : { type: 'Sphere' };
  const projection = make().rotate([-meridian, 0]).fitSize([stage.width, stage.height], world);
  const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(world);
  return { projection, meridian, world, worldBox: { x0, y0, x1, y1 } };
}

/** The camera that frames `view` on a stage, kept inside the world's box where the world is bigger than the stage. */
export function cameraOf(scene, view, stage, proj) {
  const bounds = viewBounds(scene, view);
  const { worldBox } = proj;
  if (!bounds) return { k: 1, x: 0, y: 0 };
  const [[w, s], [e0, n]] = bounds;
  const e = e0 >= w ? e0 : e0 + 360;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = proj.projection([w + ((e - w) * i) / 10, s + ((n - s) * j) / 10]);
      if (!p || !isNum(p[0]) || !isNum(p[1])) continue;
      [x0, y0, x1, y1] = [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])];
    }
  }
  if (!(x1 > x0) && !(y1 > y0)) return { k: 1, x: 0, y: 0 };
  const k = Math.max(
    1,
    Math.min(
      (stage.width * (1 - 2 * PAD)) / Math.max(1e-6, x1 - x0),
      (stage.height * (1 - 2 * PAD)) / Math.max(1e-6, y1 - y0),
    ),
  );
  const keep = (c, half, lo, hi) => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)));
  const cx = keep((x0 + x1) / 2, stage.width / 2 / k, worldBox.x0, worldBox.x1);
  const cy = keep((y0 + y1) / 2, stage.height / 2 / k, worldBox.y0, worldBox.y1);
  return { k, x: stage.width / 2 - cx * k, y: stage.height / 2 - cy * k };
}

/**
 * A camera partway, `t` from 0 to 1, from a to b along the smooth zoom of van Wijk and Nuij (2003), as d3's
 * interpolateZoom takes it: out and back in when the two are far apart, so the move never sweeps past at full zoom.
 */
export function zoomBetween(a, b, t, stage) {
  const window = (c) => [(stage.width / 2 - c.x) / c.k, (stage.height / 2 - c.y) / c.k, stage.width / c.k];
  const [[ux0, uy0, w0], [ux1, uy1, w1]] = [window(a), window(b)];
  const rho = Math.SQRT2;
  const [dx, dy] = [ux1 - ux0, uy1 - uy0];
  const d2 = dx * dx + dy * dy;
  let cx;
  let cy;
  let w;
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    [cx, cy, w] = [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d2) / (2 * w0 * rho * rho * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d2) / (2 * w1 * rho * rho * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    const s = (t * (r1 - r0)) / rho;
    const u = (w0 / (rho * rho * d1)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
    [cx, cy, w] = [ux0 + u * dx, uy0 + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)];
  }
  const k = stage.width / w;
  return { k, x: stage.width / 2 - cx * k, y: stage.height / 2 - cy * k };
}

/** Where a [lng, lat] point lands on the stage under a camera, or null when the projection cannot place it. */
export function onScreen(proj, camera, point) {
  const p = proj.projection(point);
  return p && isNum(p[0]) && isNum(p[1]) ? [p[0] * camera.k + camera.x, p[1] * camera.k + camera.y] : null;
}

/** The first `t` (0 to 1) of a path by its length on the globe, ending partway along a piece. */
export function partialPath(path, t) {
  if (t >= 1) return path;
  if (t <= 0 || path.length < 2) return path.slice(0, 1);
  const lengths = path.slice(1).map((p, i) => geoDistance(path[i], p));
  let left = lengths.reduce((a, b) => a + b, 0) * t;
  const out = [path[0]];
  for (let i = 0; i < lengths.length; i++) {
    if (left >= lengths[i]) {
      out.push(path[i + 1]);
      left -= lengths[i];
      continue;
    }
    out.push(geoInterpolate(path[i], path[i + 1])(lengths[i] ? left / lengths[i] : 0));
    break;
  }
  return out;
}

/** The countries a scene names anywhere: in a tint, a focus, a view, a place's `at` or a region. */
export function namedCountries(scene) {
  const viewRefs = (view) => (Array.isArray(view) ? view : []);
  const tintKeys = (tint) => (tint && typeof tint === 'object' ? tintEntries(tint).map(([ref]) => ref) : []);
  return [
    ...tintKeys(scene.tint),
    ...viewRefs(scene.view),
    ...list(scene.places).map((p) => p?.at),
    ...list(scene.regions).flatMap((r) => list(r?.countries)),
    ...list(scene.steps).flatMap((s) => [
      ...(Array.isArray(s?.focus) ? s.focus : [s?.focus]),
      ...tintKeys(s?.tint),
      ...viewRefs(s?.view),
    ]),
  ]
    .map(countryCode)
    .filter(Boolean);
}

/** The detail a scene draws: 1:50m when a view zooms in far or it names a country only that outline has, else 1:110m. */
function mapDetail(scene, cameras) {
  if (namedCountries(scene).some((code) => !countriesAt('110m').has(code))) return '50m';
  return cameras.some((c) => c.k > FINE_ZOOM) ? '50m' : '110m';
}

/** Each state's camera on a stage, and the detail the scene draws at. */
export function mapLayout(scene, stage) {
  const proj = mapProjection(scene, stage);
  const cameras = mapViews(scene).map((view) => cameraOf(scene, view, stage, proj));
  return { proj, cameras, detail: mapDetail(scene, cameras) };
}

/** Where a label sits beside its anchor: its box on the stage for a side, or centred on it with no side. */
function labelBox(at, width, side, gap) {
  const h = LABEL_FONT.size * 1.2;
  if (!side) return { x: at[0] - width / 2, y: at[1] - h / 2, width, height: h };
  if (side === 'left') return { x: at[0] - gap - width, y: at[1] - h / 2, width, height: h };
  if (side === 'above') return { x: at[0] - width / 2, y: at[1] - gap - h, width, height: h };
  if (side === 'below') return { x: at[0] - width / 2, y: at[1] + gap, width, height: h };
  return { x: at[0] + gap, y: at[1] - h / 2, width, height: h };
}

/** The point a route or line writes its label at: the middle of the part of it on the stage, or null when none is. */
function pathAnchor(proj, camera, path, stage) {
  const shown = path
    .map((p) => onScreen(proj, camera, p))
    .filter((p) => p && p[0] >= 0 && p[1] >= 0 && p[0] <= stage.width && p[1] <= stage.height);
  return shown.length ? shown[Math.floor(shown.length / 2)] : null;
}

/** An SVG path of a geometry through the projection at zoom 1, or "" when none of it shows. */
export const geoPathOf = (proj, geometry) => geoPath(proj.projection)(geometry) ?? '';

/** The box of a geometry through the projection at zoom 1. */
function geoBoxOf(proj, geometry) {
  const [[x0, y0], [x1, y1]] = geoPath(proj.projection).bounds(geometry);
  return [x0, y0, x1, y1].every(isNum) ? { x0, y0, x1, y1 } : null;
}

const clipBox = (b, stage) => {
  const [x0, y0] = [Math.max(0, b.x), Math.max(0, b.y)];
  const [x1, y1] = [Math.min(stage.width, b.x + b.width), Math.min(stage.height, b.y + b.height)];
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
};

/**
 * The labels a state shows under a camera: each labelled item that is shown, its text, the point it hangs from, its
 * box, and for a place with a dot the dot's box. Places hang from their point, routes and lines from the middle of
 * their part on the stage, regions from their centre.
 */
export function mapLabels(scene, proj, camera, stage, state) {
  const out = [];
  for (const [key, item] of mapItems(scene)) {
    if (state.hidden[key]) continue;
    const text = plainText(String(state.values[key] ?? item.label ?? ''));
    let anchor = null;
    let side = null;
    let gap = LABEL_GAP;
    if (item.kind === 'place') {
      anchor = onScreen(proj, camera, item.point);
      side = item.side;
      if (item.dot) gap += DOT_RADIUS;
    } else if (item.kind === 'region') anchor = onScreen(proj, camera, item.center);
    else {
      anchor = pathAnchor(proj, camera, item.path, stage);
      side = 'above';
    }
    if (!anchor) continue;
    const dot =
      item.kind === 'place' && item.dot
        ? { x: anchor[0] - DOT_RADIUS, y: anchor[1] - DOT_RADIUS, width: 2 * DOT_RADIUS, height: 2 * DOT_RADIUS }
        : null;
    out.push({
      key,
      kind: item.kind,
      text,
      anchor,
      dot,
      box: text ? labelBox(anchor, measure(text, LABEL_FONT), side, gap) : null,
    });
  }
  return out;
}

/**
 * Where each shown item lies on the stage under a camera, clipped to it, by item key: a place's dot and label, the part
 * of a route, line or region on the stage, and every country `keys` names. An item wholly off the stage has no box.
 */
export function mapBoxes(scene, proj, camera, stage, state, keys = []) {
  const boxes = new Map();
  const screenBox = (geometry) => {
    const b = geoBoxOf(proj, geometry);
    if (!b) return null;
    // A parallel draws flat, so its box gets the thickness of its stroke.
    const [w, h] = [(b.x1 - b.x0) * camera.k, (b.y1 - b.y0) * camera.k];
    const [padX, padY] = [Math.max(0, (6 - w) / 2), Math.max(0, (6 - h) / 2)];
    return clipBox(
      {
        x: b.x0 * camera.k + camera.x - padX,
        y: b.y0 * camera.k + camera.y - padY,
        width: w + 2 * padX,
        height: h + 2 * padY,
      },
      stage,
    );
  };
  const labels = new Map(mapLabels(scene, proj, camera, stage, state).map((l) => [l.key, l]));
  for (const [key, item] of mapItems(scene)) {
    if (state.hidden[key]) continue;
    let box = null;
    if (item.kind === 'place') {
      const l = labels.get(key);
      const parts = [l?.dot, l?.box].filter(Boolean);
      if (parts.length) {
        const [x0, y0] = [Math.min(...parts.map((b) => b.x)), Math.min(...parts.map((b) => b.y))];
        box = clipBox(
          {
            x: x0,
            y: y0,
            width: Math.max(...parts.map((b) => b.x + b.width)) - x0,
            height: Math.max(...parts.map((b) => b.y + b.height)) - y0,
          },
          stage,
        );
      }
    } else box = screenBox(item.geometry);
    if (box) boxes.set(key, box);
  }
  for (const key of keys) {
    const geometry = key.startsWith('mc:') ? countriesAt('50m').get(key.slice(3))?.geometry : null;
    const box = geometry ? screenBox(geometry) : null;
    if (box) boxes.set(key, box);
  }
  return boxes;
}
