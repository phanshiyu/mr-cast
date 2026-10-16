// What a step's `focus` can point at in each scene type, shared by the scenes (which light it) and
// `validate` (which checks it). A ref resolves to item keys such as "n:api" or "e:2"; a scene lights
// every item whose key a step's refs resolve to. Keys are internal; refs are what a storyboard writes.

import { sceneFiles } from './files.mjs';
import { indexRange } from './steps.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const isIndex = (ref, count) => Number.isInteger(ref) && ref >= 0 && ref < count;

/**
 * Edges a pair ref names. "a->b" is an edge from a to b, or from b to a when `undirected(edge)`;
 * "a-b" and "a<->b" are an edge between them either way. Ids may contain "-", so every split is tried.
 */
function pairEdges(ref, edges, ids, undirected = () => false) {
  if (typeof ref !== 'string') return null;
  const directed = ref.includes('->') && !ref.includes('<->');
  const sep = directed ? '->' : ref.includes('<->') ? '<->' : '-';
  const pairs = [];
  for (let at = ref.indexOf(sep); at > 0; at = ref.indexOf(sep, at + 1)) {
    const [a, b] = [ref.slice(0, at).trim(), ref.slice(at + sep.length).trim()];
    if (ids.has(a) && ids.has(b)) pairs.push([a, b]);
  }
  if (!pairs.length) return null;
  const hits = edges.flatMap((e, i) =>
    pairs.some(([a, b]) => (e?.from === a && e?.to === b) || ((!directed || undirected(e)) && e?.from === b && e?.to === a)) ? [i] : [],
  );
  return hits.length ? hits : null;
}

const pairName = (e) => `${e?.from}->${e?.to}`;

/** Per scene type: `resolve(scene, ref, hunks)` gives item keys or null, `names(scene, hunks)` the refs to suggest. */
const TARGETS = {
  graph: {
    resolve(scene, ref) {
      const ids = new Set(list(scene.nodes).map((n) => n?.id));
      const edges = list(scene.edges);
      if (typeof ref === 'string' && ids.has(ref)) return [`n:${ref}`];
      if (typeof ref === 'string' && ref.startsWith('group:')) {
        const name = ref.slice(6).trim();
        return list(scene.nodes).some((n) => n?.group === name) ? [`g:${name}`] : null;
      }
      if (isIndex(ref, edges.length)) return [`e:${ref}`];
      return pairEdges(ref, edges, ids, (e) => e?.direction === 'both' || e?.direction === 'none')?.map((i) => `e:${i}`) ?? null;
    },
    names: (scene) => [
      ...list(scene.nodes).map((n) => n?.id),
      ...new Set(list(scene.nodes).flatMap((n) => (n?.group ? [`group:${n.group}`] : []))),
      ...list(scene.edges).map(pairName),
    ],
  },
  sequence: {
    resolve(scene, ref) {
      if (typeof ref === 'string' && list(scene.participants).some((p) => p?.id === ref)) return [`p:${ref}`];
      const r = indexRange(ref);
      return r && r[1] < list(scene.messages).length ? range(r[0], r[1]).map((i) => `m:${i}`) : null;
    },
    names: (scene) => [...list(scene.participants).map((p) => p?.id), `0-${Math.max(0, list(scene.messages).length - 1)}`],
  },
  er: {
    resolve(scene, ref) {
      const entities = list(scene.entities);
      const ids = new Set(entities.map((e) => e?.id));
      if (typeof ref === 'string' && ids.has(ref)) return [`e:${ref}`];
      if (isIndex(ref, list(scene.relations).length)) return [`r:${ref}`];
      if (typeof ref === 'string') {
        for (let at = ref.indexOf('.'); at > 0; at = ref.indexOf('.', at + 1)) {
          const entity = entities.find((e) => e?.id === ref.slice(0, at));
          const field = list(entity?.fields).findIndex((f) => f?.name === ref.slice(at + 1));
          if (field >= 0) return [`f:${entity.id}/${field}`];
        }
      }
      return pairEdges(ref, list(scene.relations), ids, () => true)?.map((i) => `r:${i}`) ?? null;
    },
    names: (scene) => [
      ...list(scene.entities).map((e) => e?.id),
      ...list(scene.entities).flatMap((e) => list(e?.fields).map((f) => `${e?.id}.${f?.name}`)),
      ...list(scene.relations).map(pairName),
    ],
  },
  state: {
    resolve(scene, ref) {
      const ids = new Set(list(scene.states).map((s) => s?.id));
      const transitions = list(scene.transitions);
      if (typeof ref === 'string' && ids.has(ref)) return [`s:${ref}`];
      if (isIndex(ref, transitions.length)) return [`t:${ref}`];
      const pair = pairEdges(ref, transitions, ids);
      if (pair) return pair.map((i) => `t:${i}`);
      const labelled = transitions.flatMap((t, i) => (typeof ref === 'string' && t?.label === ref ? [`t:${i}`] : []));
      return labelled.length ? labelled : null;
    },
    names: (scene) => [
      ...list(scene.states).map((s) => s?.id),
      ...list(scene.transitions).map(pairName),
      ...list(scene.transitions).flatMap((t) => (t?.label ? [t.label] : [])),
    ],
  },
  table: {
    resolve(scene, ref) {
      const columns = list(scene.columns);
      if (isIndex(ref, list(scene.rows).length)) return [`r:${ref}`];
      if (typeof ref !== 'string') return null;
      if (ref.startsWith('col:')) {
        const col = columns.indexOf(ref.slice(4).trim());
        return col >= 0 ? [`c:${col}`] : null;
      }
      const at = ref.lastIndexOf('@');
      const col = columns.indexOf(ref.slice(0, at).trim());
      const row = Number(ref.slice(at + 1));
      return at > 0 && col >= 0 && isIndex(row, list(scene.rows).length) && ref.slice(at + 1).trim() !== '' ? [`x:${row}/${col}`] : null;
    },
    names: (scene) => [...list(scene.columns).map((c) => `col:${c}`), ...list(scene.columns).map((c) => `${c}@0`)],
  },
  chart: {
    resolve(scene, ref) {
      const labels = list(scene.labels);
      const series = list(scene.series).map((s) => s?.name);
      if (typeof ref !== 'string') return null;
      if (labels.includes(ref)) return [`l:${labels.indexOf(ref)}`];
      if (ref.startsWith('series:')) {
        const s = series.indexOf(ref.slice(7).trim());
        return s >= 0 ? [`s:${s}`] : null;
      }
      for (let at = ref.indexOf('@'); at > 0; at = ref.indexOf('@', at + 1)) {
        const [s, l] = [series.indexOf(ref.slice(0, at)), labels.indexOf(ref.slice(at + 1))];
        if (s >= 0 && l >= 0) return [`p:${s}/${l}`];
      }
      return null;
    },
    names: (scene) => [
      ...list(scene.labels),
      ...list(scene.series).map((s) => `series:${s?.name}`),
      ...list(scene.series).flatMap((s) => list(scene.labels).map((l) => `${s?.name}@${l}`)),
    ],
  },
  timeline: {
    resolve(scene, ref) {
      if (typeof ref === 'string' && ref.startsWith('span:')) {
        const label = ref.slice(5).trim();
        const hits = list(scene.spans).flatMap((s, i) => (s?.label === label ? [`sp:${i}`] : []));
        return hits.length ? hits : null;
      }
      const r = indexRange(ref);
      return r && r[1] < list(scene.events).length ? range(r[0], r[1]).map((i) => `ev:${i}`) : null;
    },
    names: (scene) => [`0-${Math.max(0, list(scene.events).length - 1)}`, ...list(scene.spans).map((s) => `span:${s?.label}`)],
  },
  files: {
    resolve(scene, ref, hunks) {
      return typeof ref === 'string' && sceneFiles(scene, hunks ?? {}).some((f) => f.path === ref) ? [`f:${ref}`] : null;
    },
    names: (scene, hunks) => sceneFiles(scene, hunks ?? {}).map((f) => f.path),
  },
  tests: {
    resolve(scene, ref) {
      const cases = list(scene.cases);
      if (isIndex(ref, cases.length)) return [`c:${ref}`];
      if (typeof ref !== 'string') return null;
      const gap = /^gap:\s*(\d+)$/.exec(ref);
      if (gap) return isIndex(Number(gap[1]), list(scene.gaps).length) ? [`g:${Number(gap[1])}`] : null;
      const named = cases.flatMap((c, i) => (c?.name === ref ? [`c:${i}`] : []));
      return named.length ? named : null;
    },
    names: (scene) => [...list(scene.cases).map((c) => c?.name), ...list(scene.gaps).map((_, i) => `gap:${i}`)],
  },
  array: {
    resolve(scene, ref) {
      const named = (prefix, items, key) => {
        if (typeof ref !== 'string' || !ref.startsWith(prefix)) return undefined;
        const name = ref.slice(prefix.length).trim();
        return list(items).some((item) => item?.name === name) ? [`${key}:${name}`] : null;
      };
      const marker = named('ptr:', scene.pointers, 'ptr') ?? named('range:', scene.ranges, 'rg');
      if (marker !== undefined) return marker;
      const r = indexRange(ref);
      return r && r[1] < list(scene.values).length ? range(r[0], r[1]).map((i) => `c:${i}`) : null;
    },
    names: (scene) => [
      `0-${Math.max(0, list(scene.values).length - 1)}`,
      ...list(scene.pointers).map((p) => `ptr:${p?.name}`),
      ...list(scene.ranges).map((r) => `range:${r?.name}`),
    ],
  },
  memory: {
    resolve(scene, ref) {
      if (typeof ref !== 'string') return null;
      const frames = list(scene.frames);
      const objects = list(scene.objects);
      if (ref.startsWith('frame:')) {
        const name = ref.slice(6).trim();
        return frames.some((f) => f?.name === name) ? [`fr:${name}`] : null;
      }
      if (objects.some((o) => o?.id === ref)) return [`o:${ref}`];
      const has = (record, key) => Boolean(record) && typeof record === 'object' && Object.hasOwn(record, key);
      for (let at = ref.indexOf('.'); at > 0; at = ref.indexOf('.', at + 1)) {
        const [owner, name] = [ref.slice(0, at), ref.slice(at + 1)];
        if (frames.some((f) => f?.name === owner && has(f.vars, name))) return [`v:${owner}/${name}`];
        if (objects.some((o) => o?.id === owner && has(o.fields, name))) return [`f:${owner}/${name}`];
      }
      return null;
    },
    names: (scene) => [
      ...list(scene.frames).map((f) => `frame:${f?.name}`),
      ...list(scene.frames).flatMap((f) => Object.keys(f?.vars ?? {}).map((v) => `${f?.name}.${v}`)),
      ...list(scene.objects).map((o) => o?.id),
      ...list(scene.objects).flatMap((o) => Object.keys(o?.fields ?? {}).map((k) => `${o?.id}.${k}`)),
    ],
  },
  intent: {
    resolve: (scene, ref) => (isIndex(ref, list(scene.bullets).length) ? [`b:${ref}`] : null),
    names: (scene) => list(scene.bullets).map((_, i) => String(i)),
  },
};

/** Scene types whose steps take `focus`. */
export const FOCUS_TYPES = Object.keys(TARGETS);

export const focusRefs = (focus) => (Array.isArray(focus) ? focus : [focus]);

/** The item keys a ref lights in a scene, or null when the scene has nothing it names. */
export function resolveRef(scene, ref, hunks) {
  const resolve = TARGETS[scene?.type]?.resolve;
  if (!resolve) return null;
  // An index written as a string, "2", means the index when nothing in the scene is named "2".
  return resolve(scene, ref, hunks) ?? (typeof ref === 'string' && /^\s*\d+\s*$/.test(ref) ? resolve(scene, Number(ref), hunks) : null);
}

/** Refs worth suggesting for a scene, for "did you mean" hints. */
export function refNames(scene, hunks) {
  return (TARGETS[scene?.type]?.names(scene, hunks) ?? []).filter((n) => typeof n === 'string' && n.length > 0);
}

/** Each step's focus, as the item keys it lights; refs that name nothing light nothing. */
export function stepTargets(scene, hunks) {
  return list(scene?.steps).map((step) => [...new Set(focusRefs(step?.focus).flatMap((ref) => resolveRef(scene, ref, hunks) ?? []))]);
}

/** For each item key, the steps that light it, in order. */
export function targetSteps(scene, hunks) {
  const out = new Map();
  stepTargets(scene, hunks).forEach((keys, k) => {
    for (const key of keys) out.set(key, [...(out.get(key) ?? []), k]);
  });
  return out;
}
