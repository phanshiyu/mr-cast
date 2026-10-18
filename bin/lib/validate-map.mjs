// Checks for the `map` scene, mirroring src/types.ts: its places, routes, lines, regions and views, the countries they
// name, the changes its steps make (through shared/state-steps.mjs), and where its labels land at each view (through
// shared/map.mjs, the same code the scene draws from). Each pushes human/LLM-readable strings onto `errors` and
// `warnings`.

import { countryCode, countryNames, isLatLng, MAP_SIDES, mapBoxes, mapLabels, mapLayout, mapRef, MIN_SPAN, PROJECTIONS, viewSpan } from '../../shared/map.mjs';
import { focusSteps } from '../../shared/normalize.mjs';
import { sceneStates, traceRef } from '../../shared/state-steps.mjs';
import { stepTargets } from '../../shared/targets.mjs';
import { cueWord } from '../../shared/timing.mjs';
import { didYouMean } from './suggest.mjs';
import { checkStateSteps } from './validate-state.mjs';
import { stageOf } from './validate-svg.mjs';
import { TONES } from './validate-scenes.mjs';

const FIELDS = ['places', 'routes', 'lines', 'regions'];
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const overlap = (a, b, by = 4) => a.x + by < b.x + b.width && b.x + by < a.x + a.width && a.y + by < b.y + b.height && b.y + by < a.y + a.height;
const fmt = (n) => String(Math.round(n * 100) / 100);

/** A [lat, lng] point, with the swap named when it reads as [lng, lat]. */
function checkPoint(v, at, errors) {
  if (isLatLng(v)) return true;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) return errors.push(`${at}: must be [lat, lng] in degrees, e.g. [1.36, 103.99]`), false;
  const swapped = Math.abs(v[0]) > 90 && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;
  errors.push(`${at}: [${v.join(', ')}] is no point; latitude runs -90 to 90 and longitude -180 to 180${swapped ? `, so this reads as [lng, lat]; write [${v[1]}, ${v[0]}]` : ''}`);
  return false;
}

function checkCountry(ref, at, errors) {
  if (countryCode(ref)) return true;
  errors.push(`${at}: ${JSON.stringify(ref)} is no country; name one by its ISO 3166-1 alpha-3 code, such as "CAN", or its name${typeof ref === 'string' ? didYouMean(ref, countryNames()) : ''}`);
  return false;
}

function checkView(s, v, at, errors) {
  if (v === 'world') return;
  if (Array.isArray(v)) {
    if (!v.length) return errors.push(`${at}: an empty list frames nothing; name what to frame, or write "world"`);
    v.forEach((ref, i) => {
      if (ref === 'map') errors.push(`${at}[${i}]: "map" is the whole map; write "world" as the view instead`);
      else if (!mapRef(s, ref)) errors.push(`${at}[${i}]: ${JSON.stringify(ref)} names no country, place, route, line or region${typeof ref === 'string' ? didYouMean(ref, [...FIELDS.flatMap((f) => (s[f] ?? []).map((x) => x?.id)), ...countryNames()].filter(isStr)) : ''}`);
    });
    return;
  }
  if (isRecord(v) && Array.isArray(v.box) && v.box.length === 2 && Object.keys(v).length === 1) {
    if (checkPoint(v.box[0], `${at}.box[0]`, errors) && checkPoint(v.box[1], `${at}.box[1]`, errors) && v.box[0][0] >= v.box[1][0]) errors.push(`${at}.box: runs from its south-west corner to its north-east one, so the first latitude must be the smaller`);
    return;
  }
  errors.push(`${at}: must be "world", a list of refs to frame, or { "box": [[south, west], [north, east]] }`);
}

/** The id, label, tone and hidden of a place, route, line or region. */
function checkItem(item, q, ids, errors) {
  if (!isStr(item.id)) errors.push(`${q}.id: required string, e.g. "sin"`);
  else if (item.id === 'map' || item.id === 'world') errors.push(`${q}.id: "${item.id}" is a ref of its own; pick another id`);
  else if (countryCode(item.id)) errors.push(`${q}.id: "${item.id}" names the country ${countryCode(item.id)}; pick an id no country is named by`);
  else if (ids.has(item.id)) errors.push(`${q}.id: "${item.id}" is taken by ${ids.get(item.id)}; every place, route, line and region has its own id`);
  else ids.set(item.id, q);
  if (item.label !== undefined && typeof item.label !== 'string') errors.push(`${q}.label: must be a string`);
  if (item.tone !== undefined && !TONES.includes(item.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  if (item.hidden !== undefined && typeof item.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
}

export function checkMap(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'callout']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (s.projection !== undefined && !(s.projection in PROJECTIONS)) errors.push(`${p}.projection: must be one of ${Object.keys(PROJECTIONS).join(', ')}`);
  if (s.meridian !== undefined && !(isNum(s.meridian) && Math.abs(s.meridian) <= 180)) errors.push(`${p}.meridian: must be a longitude from -180 to 180`);
  for (const f of FIELDS) if (s[f] !== undefined && !Array.isArray(s[f])) errors.push(`${p}.${f}: must be an array`);
  if (errors.length > before) return;
  const ids = new Map();
  (s.places ?? []).forEach((pl, j) => {
    const q = `${p}.places[${j}]`;
    if (!isRecord(pl)) return errors.push(`${q}: must be { id, at, label?, dot?, side?, tone?, hidden? }`);
    checkItem(pl, q, ids, errors);
    if (typeof pl.at === 'string') checkCountry(pl.at, `${q}.at`, errors);
    else if (pl.at === undefined) errors.push(`${q}.at: required, [lat, lng] or a country code such as "CAN"`);
    else checkPoint(pl.at, `${q}.at`, errors);
    if (pl.dot !== undefined && typeof pl.dot !== 'boolean') errors.push(`${q}.dot: must be true or false`);
    if (pl.side !== undefined && !MAP_SIDES.includes(pl.side)) errors.push(`${q}.side: must be one of ${MAP_SIDES.join(', ')}`);
  });
  const placeIds = (s.places ?? []).map((pl) => pl?.id).filter(isStr);
  (s.routes ?? []).forEach((r, j) => {
    const q = `${p}.routes[${j}]`;
    if (!isRecord(r)) return errors.push(`${q}: must be { id, stops, label?, tone?, hidden? }`);
    checkItem(r, q, ids, errors);
    if (!Array.isArray(r.stops) || r.stops.length < 2) return errors.push(`${q}.stops: required, two or more place ids or [lat, lng] points, in the order the route goes`);
    const where = r.stops.map((stop, k) => {
      if (typeof stop === 'string') {
        if (placeIds.includes(stop)) return stop;
        errors.push(`${q}.stops[${k}]: "${stop}" is no place id${placeIds.length ? `; places are ${placeIds.map((id) => JSON.stringify(id)).join(', ')}${didYouMean(stop, placeIds)}` : '; add it to places, or write [lat, lng]'}`);
        return null;
      }
      return checkPoint(stop, `${q}.stops[${k}]`, errors) ? stop.join(',') : null;
    });
    where.forEach((w, k) => {
      if (k > 0 && w !== null && w === where[k - 1]) errors.push(`${q}.stops[${k}]: is the same place as the stop before it, so that leg has no length; drop one`);
    });
  });
  (s.lines ?? []).forEach((l, j) => {
    const q = `${p}.lines[${j}]`;
    if (!isRecord(l)) return errors.push(`${q}: must be { id, lat or lng, from?, to?, label?, tone?, hidden? }`);
    checkItem(l, q, ids, errors);
    if ((l.lat === undefined) === (l.lng === undefined)) return errors.push(`${q}: give lat for a parallel, such as 49, or lng for a meridian, such as 0; one of them`);
    const parallel = l.lat !== undefined;
    const [value, limit, ends] = parallel ? [l.lat, 90, 180] : [l.lng, 180, 90];
    if (!isNum(value) || Math.abs(value) > limit) errors.push(`${q}.${parallel ? 'lat' : 'lng'}: must be a number from -${limit} to ${limit}`);
    for (const end of ['from', 'to']) if (l[end] !== undefined && !(isNum(l[end]) && Math.abs(l[end]) <= ends)) errors.push(`${q}.${end}: must be a ${parallel ? 'longitude' : 'latitude'} from -${ends} to ${ends}`);
    if (isNum(l.from) && l.from === l.to) errors.push(`${q}: from and to are the same, so the line has no length`);
    if (parallel && isNum(value) && Math.abs(value) > 85 && s.projection === 'mercator') errors.push(`${q}.lat: a Mercator map ends near 85°, so ${value}° is off it`);
  });
  (s.regions ?? []).forEach((g, j) => {
    const q = `${p}.regions[${j}]`;
    if (!isRecord(g)) return errors.push(`${q}: must be { id, outline or countries, label?, tone?, hidden? }`);
    checkItem(g, q, ids, errors);
    if ((g.outline === undefined) === (g.countries === undefined)) return errors.push(`${q}: give outline, its corners as [lat, lng], or countries, the countries it covers; one of them`);
    if (g.outline !== undefined) {
      if (!Array.isArray(g.outline) || g.outline.length < 3) errors.push(`${q}.outline: needs three or more [lat, lng] corners, in order`);
      else g.outline.forEach((pt, k) => checkPoint(pt, `${q}.outline[${k}]`, errors));
    } else if (!Array.isArray(g.countries) || !g.countries.length) errors.push(`${q}.countries: must be a non-empty array of country codes or names`);
    else g.countries.forEach((c, k) => checkCountry(c, `${q}.countries[${k}]`, errors));
  });
  if (errors.length > before) return;
  if (s.view !== undefined) checkView(s, s.view, `${p}.view`, errors);
  (Array.isArray(s.steps) ? s.steps : []).forEach((step, i) => {
    const q = `${p}.steps[${i}]`;
    if (!isRecord(step)) return;
    if (step.view !== undefined) checkView(s, step.view, `${q}.view`, errors);
    if (!Array.isArray(step.trace)) return;
    step.trace.forEach((t, k) => {
      if (isRecord(t)) {
        const extra = Object.keys(t).filter((key) => key !== 'ref' && key !== 'when');
        if (extra.length) errors.push(`${q}.trace[${k}]: takes ref and when; ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} unknown`);
        if (t.when !== undefined && !(isStr(t.when) && cueWord(String(step.say ?? ''), t.when) >= 0)) errors.push(`${q}.trace[${k}].when: ${JSON.stringify(t.when)} is not in the step's say; copy the words the route should arrive on`);
      } else if (typeof t !== 'string') errors.push(`${q}.trace[${k}]: must be a route or line id, or { "ref": "...", "when": "words of the say" }`);
      if (!isStr(traceRef(t))) errors.push(`${q}.trace[${k}].ref: required, the id of a route or line`);
    });
  });
  if (errors.length > before) return;
  checkStateSteps(s, p, errors, warnings);
  if (errors.length > before) return;
  checkGeometry(s, p, warnings);
}

/** Where things land at each view: views too narrow to show detail, labels off the stage or on each other, lit items out of view. */
function checkGeometry(s, p, warnings) {
  const stage = stageOf(s);
  const { proj, cameras } = mapLayout(s, stage);
  const states = sceneStates(s);
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const atState = (i) => (i === 0 ? `${p}` : `${p}.steps[${i - 1}]`);
  [[s.view, `${p}.view`], ...steps.map((st, i) => [st?.view, `${p}.steps[${i}].view`])].forEach(([view, at]) => {
    const span = view === undefined ? null : viewSpan(s, view);
    if (span && Math.max(...span) > 0 && Math.max(...span) < MIN_SPAN) warnings.push(`${at}: frames ${fmt(Math.max(...span))}° across, narrower than the ${MIN_SPAN}° the outline has detail in, so the scene widens it to ${MIN_SPAN}°; frame a wider box`);
  });
  const reported = new Set();
  const once = (key, text) => {
    if (reported.has(key)) return;
    reported.add(key);
    warnings.push(text);
  };
  const lit = stepTargets({ ...s, steps: focusSteps(s) });
  states.forEach((state, i) => {
    const camera = cameras[i];
    const labels = mapLabels(s, proj, camera, stage, state).filter((l) => l.box);
    const inside = (b) => b.x < stage.width && b.y < stage.height && b.x + b.width > 0 && b.y + b.height > 0;
    const on = labels.filter((l) => inside(l.box));
    for (const l of on) {
      const { x, y, width, height } = l.box;
      if (x < 0 || y < 0 || x + width > stage.width || y + height > stage.height) once(`edge:${l.key}`, `${atState(i)}: the label "${l.text}" runs off the edge of the map at this view, so part of it is cut off; ${l.kind === 'place' ? 'set its side to face into the map, or ' : ''}frame a wider view`);
    }
    on.forEach((a, j) => {
      for (const b of on.slice(j + 1)) {
        const hit = overlap(a.box, b.box) || (a.dot && overlap(a.dot, b.box, 1)) || (b.dot && overlap(b.dot, a.box, 1));
        if (hit) once(`over:${a.key}/${b.key}`, `${atState(i)}: the labels "${a.text}" and "${b.text}" overlap at this view; give one a side that points away, or frame a closer view`);
      }
    });
    if (i === 0) return;
    const keys = (lit[i - 1] ?? []).filter((key) => key !== 'm:map');
    const boxes = mapBoxes(s, proj, camera, stage, state, keys);
    for (const key of keys) if (!state.hidden[key] && !boxes.has(key)) once(`off:${i}:${key}`, `${atState(i)}: lights ${key.startsWith('mc:') ? key.slice(3) : `"${key.slice(3)}"`}, which this step's view leaves off the map; frame it with view, or light something on screen`);
  });
}
