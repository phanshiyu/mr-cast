// What each step of a scene lights, written as words, and where a step's words name something of the scene
// that it leaves dark. `mr-cast steps` prints the first for a reader (Claude, or an audit subagent); `validate`
// warns about the second. Lit means what the scene draws at full strength during the step: its focus, plus what
// the scene brightens with it, such as the cell under a lit pointer or the two ends of a lit edge.

import { plainText } from '../../shared/markup.mjs';
import { focusSteps } from '../../shared/normalize.mjs';
import { isPointer, sceneStates } from '../../shared/state-steps.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import { splitMemberKey, stepTargets } from '../../shared/targets.mjs';
import { stepLines } from '../../shared/focus.mjs';
import { sceneFiles } from '../../shared/files.mjs';
import { compareTitles } from '../../shared/compare.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? plainText(v) : typeof v === 'number' ? String(v) : '');
const shown = (v) => (isPointer(v) ? `→ ${v.ref}` : JSON.stringify(v));
const keysOf = (record) => (record && typeof record === 'object' && !Array.isArray(record) ? Object.keys(record) : []);

/**
 * An item a scene draws: its key (as shared/targets.mjs names it), how the dump writes it, the keys the scene
 * lights along with it, and the phrases words can name it by. `names` match as they are: a cell's value, a
 * pointer's name. `terms` are labels in plain words that prose also uses ("paid", "server"), so they match only
 * where they cannot be ordinary prose: two or more words ("Orders service"), or one identifier ("p95", "user_id").
 * @typedef {{ key: string, label: string, names?: string[], terms?: string[], with?: string[] }} Item
 */

/** Per scene type, its items in a state (array and memory change from step to step; the others keep one). */
const ITEMS = {
  array(scene, state) {
    const cells = list(scene.values).map((_, i) => {
      const value = state.values[`c:${i}`];
      return { key: `c:${i}`, label: `cell ${i} = ${shown(value)}`, names: [text(value), `cell ${i}`, `index ${i}`, `position ${i}`] };
    });
    const span = ([a, b]) => cells.slice(Math.max(0, a), b + 1).map((c) => c.key);
    const markers = [
      ...list(scene.pointers).map((p) => ({ key: `ptr:${p?.name}`, name: p?.name, what: 'pointer' })),
      ...list(scene.ranges).map((r) => ({ key: `rg:${r?.name}`, name: r?.name, what: 'range' })),
    ].filter((m) => !state.hidden[m.key]);
    return [
      ...cells,
      ...markers.map(({ key, name, what }) => {
        const [a, b] = state.places[key] ?? [0, 0];
        return { key, label: `${what} ${name} at ${a === b ? `cell ${a}` : `cells ${a}-${b}`}`, names: [String(name)], with: span([a, b]) };
      }),
    ];
  },
  memory(scene, state) {
    const owners = [
      ...list(scene.frames).map((f) => ({ key: `fr:${f?.name}`, label: `frame ${f?.name}`, terms: [String(f?.name)], kind: 'v', owner: f?.name })),
      ...list(scene.objects).map((o) => ({ key: `o:${o?.id}`, label: `object ${o?.id}${o?.type ? ` (${o.type})` : ''}`, terms: [String(o?.id), text(o?.type)], kind: 'f', owner: o?.id })),
    ].filter((o) => !state.hidden[o.key]);
    const members = Object.entries(state.values).flatMap(([key, value]) => {
      const { owner, ownerKey, name } = splitMemberKey(key);
      if (state.hidden[ownerKey]) return [];
      const target = isPointer(value) ? [`o:${value.ref}`] : [];
      return [{ key, label: `${owner}.${name} = ${shown(value)}`, names: isPointer(value) ? [] : [text(value)], terms: [name], with: [ownerKey, ...target] }];
    });
    return [...owners.map(({ key, label, names }) => ({ key, label, names, with: members.filter((m) => m.with[0] === key).map((m) => m.key) })), ...members];
  },
  graph(scene) {
    const label = new Map(list(scene.nodes).map((n) => [n?.id, text(n?.label) || n?.id]));
    return [
      ...list(scene.nodes).map((n) => ({ key: `n:${n?.id}`, label: `node ${label.get(n?.id)}`, terms: [label.get(n?.id), n?.id] })),
      ...list(scene.edges).map((e, i) => ({ key: `e:${i}`, label: `edge ${label.get(e?.from)} → ${label.get(e?.to)}${e?.label ? ` "${text(e.label)}"` : ''}`, terms: [text(e?.label)], with: [`n:${e?.from}`, `n:${e?.to}`] })),
      ...[...new Set(list(scene.nodes).map((n) => n?.group).filter(Boolean))].map((g) => ({ key: `g:${g}`, label: `group ${g}`, terms: [g], with: list(scene.nodes).filter((n) => n?.group === g).map((n) => `n:${n.id}`) })),
    ];
  },
  sequence(scene) {
    const label = new Map(list(scene.participants).map((p) => [p?.id, text(p?.label) || p?.id]));
    return [
      ...list(scene.participants).map((p) => ({ key: `p:${p?.id}`, label: `participant ${label.get(p?.id)}`, terms: [label.get(p?.id), p?.id] })),
      ...list(scene.messages).map((m, i) => ({ key: `m:${i}`, label: `message ${i} ${label.get(m?.from)} → ${label.get(m?.to)} "${text(m?.label)}"`, terms: [text(m?.label)], with: [`p:${m?.from}`, `p:${m?.to}`] })),
    ];
  },
  state(scene) {
    const label = new Map(list(scene.states).map((s) => [s?.id, text(s?.label) || s?.id]));
    return [
      ...list(scene.states).map((s) => ({ key: `s:${s?.id}`, label: `state ${label.get(s?.id)}`, terms: [label.get(s?.id), s?.id] })),
      ...list(scene.transitions).map((t, i) => ({ key: `t:${i}`, label: `transition ${label.get(t?.from)} → ${label.get(t?.to)}${t?.label ? ` "${text(t.label)}"` : ''}`, terms: [text(t?.label)], with: [`s:${t?.from}`, `s:${t?.to}`] })),
    ];
  },
  er(scene) {
    return [
      ...list(scene.entities).map((e) => ({ key: `e:${e?.id}`, label: `entity ${text(e?.name) || e?.id}`, terms: [text(e?.name), e?.id] })),
      ...list(scene.entities).flatMap((e) => list(e?.fields).map((f, k) => ({ key: `f:${e?.id}/${k}`, label: `field ${e?.id}.${f?.name}`, terms: [f?.name], with: [`e:${e?.id}`] }))),
      ...list(scene.relations).map((r, i) => ({ key: `r:${i}`, label: `relation ${r?.from} → ${r?.to}${r?.label ? ` "${text(r.label)}"` : ''}`, terms: [text(r?.label)], with: [`e:${r?.from}`, `e:${r?.to}`] })),
    ];
  },
  layers(scene) {
    return list(scene.layers).flatMap((l) => [
      { key: `l:${l?.id}`, label: `layer ${text(l?.label) || l?.id}`, terms: [text(l?.label)], with: list(l?.items).map((it) => `i:${it?.id}`) },
      ...list(l?.items).map((it) => ({ key: `i:${it?.id}`, label: `item ${text(it?.label) || it?.id}`, terms: [text(it?.label)] })),
    ]);
  },
  timeline(scene) {
    return [
      ...list(scene.events).map((e, i) => ({ key: `ev:${i}`, label: `event ${i} "${text(e?.label)}" at ${e?.at}`, terms: [text(e?.label)] })),
      ...list(scene.spans).map((s, i) => ({ key: `sp:${i}`, label: `span "${text(s?.label)}" ${s?.from}-${s?.to}`, terms: [text(s?.label)] })),
    ];
  },
  chart(scene) {
    const labels = list(scene.labels);
    return [
      ...labels.map((l, i) => ({ key: `l:${i}`, label: `label ${l}`, terms: [text(l)] })),
      ...list(scene.series).map((s, k) => ({ key: `s:${k}`, label: `series ${s?.name}`, terms: [text(s?.name)], with: labels.map((_, i) => `p:${k}/${i}`) })),
      ...list(scene.series).flatMap((s, k) => labels.map((l, i) => ({ key: `p:${k}/${i}`, label: `${s?.name} at ${l} = ${list(s?.values)[i]}`, terms: [text(String(list(s?.values)[i] ?? ''))], with: [`l:${i}`] }))),
    ];
  },
  table(scene) {
    const columns = list(scene.columns);
    const cell = (c) => (c && typeof c === 'object' ? `${text(c.before)} → ${text(c.after)}` : text(c));
    return [
      ...list(scene.rows).map((r, i) => ({ key: `r:${i}`, label: `row ${i} ${list(r?.cells).map(cell).join(' | ')}`, terms: [], with: columns.map((_, c) => `x:${i}/${c}`) })),
      ...columns.map((c, k) => ({ key: `c:${k}`, label: `column ${c}`, terms: [text(c)], with: list(scene.rows).map((_, i) => `x:${i}/${k}`) })),
      ...list(scene.rows).flatMap((r, i) => list(r?.cells).map((c, k) => ({ key: `x:${i}/${k}`, label: `${columns[k]} of row ${i} = ${cell(c)}`, terms: c && typeof c === 'object' ? [text(c.before), text(c.after)] : [text(c)] }))),
    ];
  },
  compare(scene) {
    const titles = compareTitles(scene);
    const cell = (c) => (c && typeof c === 'object' ? `code: ${String(c.code).split('\n')[0]}` : text(c));
    return [
      ...list(scene.rows).map((r, i) => ({ key: `r:${i}`, label: `row ${i}${r?.label ? ` "${text(r.label)}"` : ''}: ${list(r?.cells).map(cell).join(' | ')}`, terms: [text(r?.label)], with: titles.map((_, s) => `x:${i}/${s}`) })),
      ...titles.map((t, s) => ({ key: `s:${s}`, label: `side ${t}`, terms: [text(t)], with: list(scene.rows).map((_, i) => `x:${i}/${s}`) })),
      ...list(scene.rows).flatMap((r, i) => list(r?.cells).map((c, s) => ({ key: `x:${i}/${s}`, label: `${titles[s]} of row ${i}: ${cell(c)}`, terms: [] }))),
    ];
  },
  files(scene, _state, hunks) {
    return sceneFiles(scene, hunks ?? {}).map((f) => ({ key: `f:${f.path}`, label: `file ${f.path}`, terms: [] }));
  },
  tests(scene) {
    return [
      ...list(scene.cases).map((c, i) => ({ key: `c:${i}`, label: `case ${i} ${c?.name}: ${text(c?.proves)}`, terms: [] })),
      ...list(scene.gaps).map((g, i) => ({ key: `g:${i}`, label: `gap ${i}: ${text(g)}`, terms: [] })),
    ];
  },
  terminal(scene) {
    return list(scene.entries).map((e, i) => ({ key: `en:${i}`, label: `entry ${i}${e?.command ? ` $ ${e.command}` : ''}`, terms: [] }));
  },
  intent(scene) {
    return list(scene.bullets).map((b, i) => ({ key: `b:${i}`, label: `bullet ${i} "${text(b)}"`, terms: [] }));
  },
};

/** Item keys lit with `keys`: each key's own `with`, once, so a pointer lights its cell but not the cell's neighbours. */
function withRelated(items, keys) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const out = new Set(keys);
  for (const key of keys) for (const k of byKey.get(key)?.with ?? []) out.add(k);
  return out;
}

/** Labels of the cells, variables and fields a step changes, as "cell 0 5 → 1". */
function changesOf(scene, before, after) {
  const values = Object.keys(after.values).flatMap((key) => {
    if (String(before.values[key]) === String(after.values[key]) && isPointer(before.values[key]) === isPointer(after.values[key])) return [];
    const where = key.startsWith('c:') ? `cell ${key.slice(2)}` : (({ owner, name }) => `${owner}.${name}`)(splitMemberKey(key));
    return [`${where} ${shown(before.values[key])} → ${shown(after.values[key])}`];
  });
  const places = Object.keys(after.places).flatMap((key) => {
    const [[a, b], [c, d]] = [before.places[key] ?? [], after.places[key]];
    return a === c && b === d ? [] : [`${key.replace(/^rg:/, 'range ').replace(/^ptr:/, 'pointer ')} ${a === b ? a : `${a}-${b}`} → ${c === d ? c : `${c}-${d}`}`];
  });
  const shows = [...new Set([...keysOf(before.hidden), ...keysOf(after.hidden)])].flatMap((key) => {
    const [was, is] = [Boolean(before.hidden[key]), Boolean(after.hidden[key])];
    return was === is ? [] : [`${is ? 'hides' : 'shows'} ${key.replace(/^(fr|o|ptr|rg):/, '')}`];
  });
  return [...values, ...places, ...shows];
}

/**
 * Every step of a scene as the viewer gets it: the words, what is lit (as labels), and what the step changes
 * on screen as it starts. Empty for a scene without steps.
 * @returns {{ say: string, lit: string[], changes: string[], items: Item[], litKeys: Set<string> }[]}
 */
export function stepViews(scene, hunks) {
  const steps = sceneSteps(scene);
  if (!steps.length) return [];
  if (scene.type === 'code') return codeViews(scene, hunks);
  if (scene.type === 'flow') {
    return steps.map((step, k) => ({ say: text(step?.say), lit: [`step ${k} ${step?.actor}: ${text(step?.action)}`], changes: [], items: [], litKeys: new Set() }));
  }
  const states = sceneStates(scene);
  const targets = stepTargets({ ...scene, steps: focusSteps(scene) }, hunks);
  return steps.map((step, k) => {
    const state = states[k + 1] ?? states[0] ?? { values: {}, places: {}, hidden: {} };
    const items = ITEMS[scene.type]?.(scene, state, hunks) ?? [];
    const litKeys = withRelated(items, targets[k] ?? []);
    return {
      say: text(step?.say),
      lit: items.filter((it) => litKeys.has(it.key)).map((it) => it.label),
      changes: states.length ? changesOf(scene, states[k], state) : [],
      items,
      litKeys,
    };
  });
}

function codeViews(scene, hunks) {
  const hunk = hunks?.[scene.hunkId];
  return sceneSteps(scene).map((step) => {
    const lines = hunk ? stepLines(hunk, step).map((i) => hunk.lines[i]) : [];
    const lit = lines.map((l) => `L${l.newLine ?? l.oldLine}${l.type === 'add' ? ' +' : l.type === 'del' ? ' -' : ''} ${l.text.trim()}`);
    return { say: text(step?.say), lit: step?.label ? [`label "${text(step.label)}"`, ...lit] : lit, changes: [], items: [], litKeys: new Set() };
  });
}

// ─── Words that name an item ───

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** Words after a number that keep it a value ("five and one", "four is bigger"); any other word makes it a count ("two passes"). */
const VALUE_FOLLOWERS = new Set('and or is are was were than to with swap swaps swapped trade trades stay stays stayed move moves moved sit sits go goes went become becomes land lands into in on at so but then now from by against versus vs before after first last still also already itself'.split(' '));
/** Words before a number that make it the name of something else ("pass two", "step three"). */
const COUNT_LEADERS = new Set('pass step round line lines page chapter scene number every each about over under around index cell position slot'.split(' '));
/** Words before "one" that make it a pronoun ("the one on the right", "each one"). */
const ONE_LEADERS = new Set('the a each any no which every only this that another'.split(' '));
/** "The two swap", "both three are": a number between these words means the group, not a value. */
const GROUP_LEADERS = new Set('the these those all both'.split(' '));
const PLURAL_VERBS = new Set('are were swap trade stay move sit go become land have'.split(' '));
/** Words that deny what a sentence names. */
const NEGATIONS = new Set('never not no nor without skips skipped bypasses'.split(' '));
/** Words never worth matching alone: a name made only of these is skipped. */
const STOP = new Set('a an the of to in on at by for and or is are be it this that its with from as not no yes if then so'.split(' '));

/** Lowercase words of a text, with number words as digits. */
const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+(?:[.'][a-z0-9]+)*/g) ?? [];
function tokens(s) {
  return words(s).map((w) => {
    const n = NUMBER_WORDS.indexOf(w);
    return n >= 0 ? String(n) : w;
  });
}

const isNumber = (w) => /^\d+(\.\d+)?$/.test(w);

/** Whether a name is worth matching: a number, or words that are not all stop words and not one short word. */
const matchable = (t) => (t.length === 1 ? isNumber(t[0]) || (t[0].length >= 3 && !STOP.has(t[0])) : t.length > 1 && !t.every((w) => STOP.has(w)));

/** A term prose cannot use by chance: two or more words, not all stop words, or one identifier such as "p95" or "user_id". */
const distinctive = (term, t) => (t.length > 1 ? t.filter((w) => !STOP.has(w)).length >= 2 : /[a-z]/i.test(term) && /[0-9_]|[a-z][A-Z]/.test(String(term).trim()) && !/\s/.test(String(term).trim()));

/**
 * The phrases a step's words name, each with the items of the scene it could mean: the longest name at each
 * word wins, so "rate limiter" is not also "limiter". A bare number counts as a value only where it reads as
 * one ("compare five and one"), never as a count ("two passes") or another name ("pass two", "cell 3").
 */
function namedIn(say, items) {
  const names = items.flatMap((item) => [
    ...[...new Set(list(item.names).filter(Boolean))].map((name) => ({ t: tokens(name), item, term: false })).filter((n) => matchable(n.t)),
    ...[...new Set(list(item.terms).filter(Boolean))].map((term) => ({ t: tokens(term), item, term: true, ok: distinctive(term, tokens(term)) })).filter((n) => n.ok),
  ]);
  const found = [];
  for (const sentence of String(say).split(/(?<=[.!?;])\s+/)) {
    const said = tokens(sentence);
    const raw = words(sentence);
    // A label in a sentence that denies it ("the orders service is never reached") is named on purpose while dark.
    const denied = said.some((w) => NEGATIONS.has(w));
    for (let i = 0; i < said.length; ) {
      const best = names.reduce((top, n) => (n.t.length > (top?.t.length ?? 0) && n.t.every((w, j) => said[i + j] === w) ? n : top), null);
      if (!best) {
        i++;
        continue;
      }
      const phrase = best.t.join(' ');
      const next = said[i + 1];
      const counted =
        best.t.length === 1 &&
        isNumber(best.t[0]) &&
        (COUNT_LEADERS.has(said[i - 1]) || (raw[i] === 'one' && ONE_LEADERS.has(said[i - 1])) ||
          (GROUP_LEADERS.has(said[i - 1]) && PLURAL_VERBS.has(next)) || (next !== undefined && !isNumber(next) && !VALUE_FOLLOWERS.has(next)));
      const meant = names.filter((n) => n.t.join(' ') === phrase && !(n.term && denied)).map((n) => n.item);
      if (!counted && meant.length) found.push({ phrase, items: meant });
      i += best.t.length;
    }
  }
  return found;
}

/** The scene types whose words the highlight check reads. Code, terminal, tests and intent have no names it can match. */
export const HIGHLIGHT_TYPES = ['array', 'memory', 'graph', 'sequence', 'state', 'er', 'layers', 'timeline', 'chart', 'table', 'compare'];

/**
 * Where a scene's words and its light disagree, as warnings at `p`. Two checks, both exact on the scene's data:
 * a step whose words name an item it leaves dark, and (array and memory) a step whose swap lands before any
 * step lit the swapped items, so the viewer never sees the pair before it moves.
 */
export function checkHighlight(scene, p, hunks, warnings) {
  if (!HIGHLIGHT_TYPES.includes(scene?.type)) return;
  const views = stepViews(scene, hunks);
  views.forEach((view, k) => {
    const dark = [];
    for (const { phrase, items } of namedIn(view.say, view.items)) {
      // Named by a part that is lit counts: a side whose cell in the lit row shows, a range over a lit cell.
      if (items.some((it) => [it.key, ...list(it.with)].some((key) => view.litKeys.has(key)))) continue;
      if (!dark.some((d) => d.phrase === phrase)) dark.push({ phrase, items });
    }
    if (!dark.length) return;
    const said = dark.map(({ phrase, items }) => `"${phrase}" (${items.map((it) => it.label).join(' or ')})`).join(', ');
    const lit = view.lit.length ? `it lights ${view.lit.join(', ')}` : 'it lights nothing';
    warnings.push(`${p}.steps[${k}]: says ${said}, which ${dark.length === 1 && dark[0].items.length === 1 ? 'is' : 'are'} not lit; ${lit}. Focus what the words name, or say only what is lit`);
  });
  if (scene.type === 'array' || scene.type === 'memory') checkSwaps(scene, p, views, hunks, warnings);
}

/** A step whose changes only trade values among the items it sets: a swap. */
function swapped(before, after) {
  const keys = Object.keys(after.values).filter((key) => !sameText(before.values[key], after.values[key]));
  if (keys.length < 2) return null;
  const was = keys.map((key) => valueText(before.values[key])).sort();
  const now = keys.map((key) => valueText(after.values[key])).sort();
  return was.every((v, i) => v === now[i]) ? keys : null;
}
const valueText = (v) => (isPointer(v) ? `ref:${v.ref}` : String(v));
const sameText = (a, b) => valueText(a) === valueText(b);

function checkSwaps(scene, p, views, hunks, warnings) {
  const states = sceneStates(scene);
  sceneSteps(scene).forEach((_, k) => {
    const keys = swapped(states[k], states[k + 1]);
    if (!keys) return;
    const before = k > 0 ? views[k - 1].litKeys : new Set();
    if (keys.every((key) => before.has(key))) return;
    const names = views[k].items.filter((it) => keys.includes(it.key)).map((it) => it.label.replace(/ = .*/, ''));
    warnings.push(`${p}.steps[${k}]: swaps ${names.join(' and ')} as the step starts, before its words, and the step before did not light them, so the viewer never sees the pair before it moves; add a step before it that focuses them while the words compare them, then swap in this step`);
  });
}

/**
 * The `mr-cast steps` text: per stepped scene, its narration, then each step's words beside what is lit and
 * what changes on screen as it starts, with the highlight warnings for that scene. `scenes` picks scene indexes.
 */
export function formatSteps(storyboard, hunks, scenes) {
  const out = [];
  list(storyboard?.scenes).forEach((scene, i) => {
    if (scenes?.length && !scenes.includes(i)) return;
    const views = stepViews(scene, hunks);
    if (!views.length) return;
    const title = scene.title ?? scene.chapter;
    out.push(`scene ${i} · ${scene.type}${title ? ` · ${text(title)}` : ''}`);
    if (scene.narration) out.push(`  intro   ${text(scene.narration)}`);
    views.forEach((view, k) => {
      out.push(`  step ${k}  says    ${view.say}`);
      if (view.changes.length) out.push(`          changes ${view.changes.join('; ')}`);
      out.push(`          lit     ${view.lit.length ? view.lit.join('; ') : '(nothing)'}`);
    });
    const warnings = [];
    checkHighlight(scene, `scenes[${i}]`, hunks, warnings);
    for (const w of warnings) out.push(`  ! ${w}`);
    out.push('');
  });
  return out.join('\n').trimEnd();
}
