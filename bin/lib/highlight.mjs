// What each step of a scene lights, written as words, and where a step's words name something of the scene
// that it leaves dark. `mr-cast steps` prints the first for a reader (Claude, or an audit subagent); `validate`
// warns about the second. Lit means what the scene draws at full strength during the step: its focus, plus what
// the scene brightens with it, such as the cell under a lit pointer or the two ends of a lit edge.

import { plainText } from '../../shared/markup.mjs';
import { focusSteps } from '../../shared/normalize.mjs';
import { STATE_TYPES, isPointer, sceneStates } from '../../shared/state-steps.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import { splitMemberKey, stepTargets } from '../../shared/targets.mjs';
import { sceneFiles } from '../../shared/files.mjs';
import { compareTitles } from '../../shared/compare.mjs';
import { outputLines } from '../../shared/terminal.mjs';
import { arrayRows, cellKey, cellName, markerRow, rowKey, splitCellKey } from '../../shared/arrays.mjs';
import { svgOf, textOf } from '../../shared/svg.mjs';
import { outcomeKey, testKey, testKeys, testsMatrix } from '../../shared/tests.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? plainText(v) : typeof v === 'number' ? String(v) : '');
const shown = (v) => (isPointer(v) ? `points at ${v.ref}` : typeof v === 'string' ? JSON.stringify(plainText(v)) : JSON.stringify(v));
const valueText = (v) => (isPointer(v) ? `ref:${v.ref}` : String(v));
const sameText = (a, b) => valueText(a) === valueText(b);
const keysOf = (record) => (record && typeof record === 'object' && !Array.isArray(record) ? Object.keys(record) : []);

/**
 * An item a scene draws: its key (as shared/targets.mjs names it), how the dump writes it, the keys the scene
 * lights along with it (`parts` it holds, such as a range's cells, and others `with` it, such as an edge's two
 * nodes), and the phrases words can name it by. `names` match as they are: a cell's value, a
 * pointer's name. `terms` are labels in plain words that prose also uses ("paid", "server"), so they match only
 * where they cannot be ordinary prose: two or more words ("Orders service"), or one identifier ("p95", "user_id").
 * @typedef {{ key: string, label: string, names?: string[], terms?: string[], parts?: string[], with?: string[] }} Item
 */

/** Per scene type, its items in a state (array and memory change from step to step; the others keep one). */
const ITEMS = {
  array(scene, state) {
    const rows = arrayRows(scene);
    const cells = rows.flatMap((a) =>
      a.values.map((_, i) => {
        const key = cellKey(a.name, i);
        const value = state.values[key];
        const where = a.name ? [`${a.name} ${i}`] : [`cell ${i}`, `index ${i}`, `position ${i}`];
        return { key, label: `${cellName(a.name, i)} = ${shown(value)}`, names: [text(value), ...where], hidden: a.name ? Boolean(state.hidden[rowKey(a.name)]) : false };
      }),
    ).filter((c) => !c.hidden);
    const span = (row, [a, b]) => cells.filter((c) => splitCellKey(c.key).name === row && splitCellKey(c.key).index >= a && splitCellKey(c.key).index <= b).map((c) => c.key);
    const markers = [
      ...list(scene.pointers).map((p) => ({ key: `ptr:${p?.name}`, name: p?.name, what: 'pointer', row: markerRow(scene, p) })),
      ...list(scene.ranges).map((r) => ({ key: `rg:${r?.name}`, name: r?.name, what: 'range', row: markerRow(scene, r) })),
    ].filter((m) => !state.hidden[m.key] && !state.hidden[rowKey(m.row)]);
    return [
      ...cells.map(({ hidden, ...c }) => c),
      ...rows.filter((a) => a.name && !state.hidden[rowKey(a.name)]).map((a) => ({ key: rowKey(a.name), label: `array ${a.name}`, terms: [a.name, text(a.label)], parts: span(a.name, [0, a.values.length - 1]) })),
      ...markers.map(({ key, name, what, row }) => {
        const [a, b] = state.places[key] ?? [0, 0];
        const at = a === b ? cellName(row, a) : row ? `${row}[${a}-${b}]` : `cells ${a}-${b}`;
        return { key, label: `${what} ${name} at ${at}`, names: [String(name)], parts: span(row, [a, b]) };
      }),
    ];
  },
  memory(scene, state) {
    const owners = [
      ...list(scene.frames).map((f) => ({ key: `fr:${f?.name}`, label: `frame ${f?.name}`, terms: [String(f?.name)] })),
      ...list(scene.objects).map((o) => ({ key: `o:${o?.id}`, label: `object ${o?.id}${o?.type ? ` (${o.type})` : ''}`, terms: [String(o?.id), text(o?.type)] })),
    ].filter((o) => !state.hidden[o.key]);
    const members = Object.entries(state.values).flatMap(([key, value]) => {
      const { owner, ownerKey, name } = splitMemberKey(key);
      if (state.hidden[ownerKey]) return [];
      const target = isPointer(value) ? [`o:${value.ref}`] : [];
      return [{ key, label: `${owner}.${name} = ${shown(value)}`, names: isPointer(value) ? [] : [text(value)], terms: [name], with: [ownerKey, ...target] }];
    });
    return [...owners.map((o) => ({ ...o, parts: members.filter((m) => m.with[0] === o.key).map((m) => m.key) })), ...members];
  },
  graph(scene, state) {
    const label = new Map(list(scene.nodes).map((n) => [n?.id, text(n?.label) || n?.id]));
    const hidden = (key) => Boolean(state?.hidden[key]);
    const badge = (id) => text(state?.values[`b:${id}`] ?? '');
    return [
      ...list(scene.nodes)
        .filter((n) => !hidden(`n:${n?.id}`))
        .map((n) => ({ key: `n:${n?.id}`, label: `node ${label.get(n?.id)}${badge(n?.id) ? ` (badge ${badge(n?.id)})` : ''}`, terms: [label.get(n?.id), n?.id], names: badge(n?.id) ? [badge(n?.id)] : [] })),
      ...list(scene.edges).flatMap((e, i) =>
        hidden(`e:${i}`) || hidden(`n:${e?.from}`) || hidden(`n:${e?.to}`) ? [] : [{ key: `e:${i}`, label: `edge ${label.get(e?.from)} → ${label.get(e?.to)}${e?.label ? ` "${text(e.label)}"` : ''}`, terms: [text(e?.label)], with: [`n:${e?.from}`, `n:${e?.to}`] }],
      ),
      ...[...new Set(list(scene.nodes).map((n) => n?.group).filter(Boolean))].map((g) => ({ key: `g:${g}`, label: `group ${g}`, terms: [g], parts: list(scene.nodes).filter((n) => n?.group === g).map((n) => `n:${n.id}`) })),
      ...(scene.table ? tableItems(scene.table, state, 'table ') : []),
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
    // An entity is drawn with its fields, so a lit entity lights them, and a lit relation lights both its entities whole.
    const fields = new Map(list(scene.entities).map((e) => [e?.id, list(e?.fields).map((_, k) => `f:${e?.id}/${k}`)]));
    const whole = (id) => [`e:${id}`, ...(fields.get(id) ?? [])];
    return [
      ...list(scene.entities).map((e) => ({ key: `e:${e?.id}`, label: `entity ${text(e?.name) || e?.id}`, terms: [text(e?.name), e?.id], parts: fields.get(e?.id) })),
      ...list(scene.entities).flatMap((e) => list(e?.fields).map((f, k) => ({ key: `f:${e?.id}/${k}`, label: `field ${e?.id}.${f?.name}`, terms: [f?.name], with: [`e:${e?.id}`] }))),
      ...list(scene.relations).map((r, i) => ({ key: `r:${i}`, label: `relation ${r?.from} → ${r?.to}${r?.label ? ` "${text(r.label)}"` : ''}`, terms: [text(r?.label)], with: [...whole(r?.from), ...whole(r?.to)] })),
    ];
  },
  layers(scene) {
    return list(scene.layers).flatMap((l) => [
      { key: `l:${l?.id}`, label: `layer ${text(l?.label) || l?.id}`, terms: [text(l?.label)], parts: list(l?.items).map((it) => `i:${it?.id}`) },
      ...list(l?.items).map((it) => ({ key: `i:${it?.id}`, label: `item ${text(it?.label) || it?.id}`, terms: [text(it?.label)] })),
    ]);
  },
  timeline(scene) {
    return [
      ...list(scene.events).map((e, i) => ({ key: `ev:${i}`, label: `event ${i} "${text(e?.label)}" at ${e?.at}`, terms: [text(e?.label)] })),
      ...list(scene.spans).map((s, i) => ({ key: `sp:${i}`, label: `span "${text(s?.label)}" ${s?.from}-${s?.to}`, terms: [text(s?.label)] })),
    ];
  },
  chart(scene, state) {
    const labels = list(scene.labels);
    // A value reads as the step leaves it, after any set.
    const valueAt = (s, k, i) => state?.values?.[`p:${k}/${i}`] ?? list(s?.values)[i];
    return [
      ...labels.map((l, i) => ({ key: `l:${i}`, label: `label ${l}`, terms: [text(l)] })),
      // A lit series is read against its labels, so they light with it.
      ...list(scene.series).map((s, k) => ({ key: `s:${k}`, label: `series ${s?.name}`, terms: [text(s?.name)], parts: labels.map((_, i) => `p:${k}/${i}`), with: labels.map((_, i) => `l:${i}`) })),
      ...list(scene.series).flatMap((s, k) => labels.map((l, i) => ({ key: `p:${k}/${i}`, label: `${s?.name} at ${l} = ${valueAt(s, k, i)}`, terms: [text(String(valueAt(s, k, i) ?? ''))], with: [`l:${i}`] }))),
    ];
  },
  image(scene) {
    return list(scene.regions).map((r) => ({ key: `im:${r?.id}`, label: `region ${r?.id}${r?.label ? ` "${text(r.label)}"` : ''}`, names: [text(r?.label), r?.id] }));
  },
  table(scene, state) {
    return tableItems(scene, state, '');
  },
  svg(scene, state) {
    const { ids } = svgOf(scene.svg);
    const labels = scene.labels && typeof scene.labels === 'object' ? scene.labels : {};
    return [...ids].flatMap(([id, node]) => {
      const key = `s:${id}`;
      if (state?.hidden[key] || !node?.tag) return [];
      const words = node.tag === 'text' ? text(state?.values[key] ?? textOf(node)) : '';
      const inside = [...ids].filter(([other, n]) => other !== id && n && contains(node, n)).map(([other]) => `s:${other}`);
      return [{ key, label: `${node.tag} ${id}${words ? ` "${words}"` : ''}`, names: [text(labels[id] ?? '')].filter(Boolean), terms: [id, words], parts: inside }];
    });
  },
  compare(scene) {
    const titles = compareTitles(scene);
    const cell = (c) => (c && typeof c === 'object' ? ('image' in c ? `image: ${c.image}` : `code: ${String(c.code).replace(/\s+/g, ' ').trim().slice(0, 60)}`) : text(c));
    return [
      ...list(scene.rows).map((r, i) => ({ key: `r:${i}`, label: `row ${i}${r?.label ? ` "${text(r.label)}"` : ''}: ${list(r?.cells).map(cell).join(' | ')}`, terms: [text(r?.label)], parts: titles.map((_, s) => `x:${i}/${s}`) })),
      ...titles.map((t, s) => ({ key: `s:${s}`, label: `side ${t}`, terms: [text(t)], parts: list(scene.rows).map((_, i) => `x:${i}/${s}`) })),
      ...list(scene.rows).flatMap((r, i) => list(r?.cells).map((c, s) => ({ key: `x:${i}/${s}`, label: `${titles[s]} of row ${i}: ${cell(c)}`, terms: [] }))),
    ];
  },
  files(scene, _state, hunks) {
    return sceneFiles(scene, hunks ?? {}).map((f) => ({ key: `f:${f.path}`, label: `file ${f.path}`, terms: [] }));
  },
  tests(scene) {
    const { outcomes, rows } = testsMatrix(scene);
    const cells = rows.filter((r) => !r.gap).flatMap((r) => r.cells);
    return [
      ...rows.map((r) => ({ key: r.key, label: `situation ${r.situation.id} "${text(r.situation.when)}"${r.gap ? ` gap: ${text(r.situation.gap)}` : ''}`, terms: [text(r.situation.when), text(r.gap ? r.situation.gap : '')], parts: r.gap ? [] : r.cells.map((c) => c.key) })),
      ...outcomes.map((o, col) => ({ key: outcomeKey(col), label: `outcome ${o}`, terms: [text(o)], parts: cells.filter((c) => c.col === col).map((c) => c.key) })),
      ...list(scene.tests).map((t, n) => ({ key: testKey(n), label: `test "${t?.name}"`, terms: [String(t?.name ?? '')], parts: testKeys(scene, n).slice(1) })),
      ...cells.map((c) => ({ key: c.key, label: `${c.outcome} of ${rows[c.row].situation.id} = ${c.value === undefined ? '(none)' : JSON.stringify(text(c.value))} ${c.state}`, terms: [text(c.value ?? '')] })),
    ];
  },
  terminal(scene) {
    return list(scene.entries).flatMap((e, i) => [
      { key: `en:${i}`, label: `entry ${i}${e?.command ? ` $ ${e.command}` : ''}` },
      ...outputLines(e).map((line, l) => ({ key: `ln:${i}/${l}`, label: `entry ${i} output line ${l}: ${text(line)}` })),
    ]);
  },
  text(scene) {
    return list(scene.items).map((b, i) => ({ key: `b:${i}`, label: `item ${i} "${text(b)}"`, terms: [] }));
  },
};

/** Whether drawing element `outer` holds `inner` somewhere inside it. */
const contains = (outer, inner) => list(outer?.children).some((c) => c === inner || contains(c, inner));

/** A table's rows, columns and cells as `state` shows them; `what` starts each label, such as "table " beside a graph. */
function tableItems(table, state, what) {
  const columns = list(table.columns);
  const cell = (c) => (c && typeof c === 'object' ? `${text(c.before)} → ${text(c.after)}` : text(c));
  const value = (i, k, c) => state?.values[`x:${i}/${k}`] ?? c;
  const rows = list(table.rows).map((r, i) => ({ i, cells: list(r?.cells).map((c, k) => value(i, k, c)) })).filter(({ i }) => !state?.hidden[`r:${i}`]);
  return [
    ...rows.map(({ i, cells }) => ({ key: `r:${i}`, label: `${what}row ${i} ${cells.map(cell).join(' | ')}`, terms: [], parts: columns.map((_, c) => `x:${i}/${c}`) })),
    ...columns.map((c, k) => ({ key: `c:${k}`, label: `${what}column ${c}`, terms: [text(c)], parts: rows.map(({ i }) => `x:${i}/${k}`) })),
    ...rows.flatMap(({ i, cells }) => cells.map((c, k) => ({ key: `x:${i}/${k}`, label: `${what}${columns[k]} of row ${i} = ${cell(c)}`, terms: c && typeof c === 'object' ? [text(c.before), text(c.after)] : [text(c)] }))),
  ];
}

/** Item keys lit with `keys`: each key's own `parts` and `with`, once, so a pointer lights its cell but not the cell's neighbours. */
function withRelated(items, keys) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const out = new Set(keys);
  for (const key of keys) for (const k of [...list(byKey.get(key)?.parts), ...list(byKey.get(key)?.with)]) out.add(k);
  return out;
}

/** Labels of the cells, variables and fields a step changes, as "cell 0 5 → 1". */
function changesOf(scene, before, after) {
  const values = Object.keys(after.values).flatMap((key) => {
    if (sameText(before.values[key], after.values[key])) return [];
    const where = key.startsWith('c:') ? (({ name, index }) => cellName(name, index))(splitCellKey(key))
      : key.startsWith('b:') ? `badge of ${key.slice(2)}`
      : key.startsWith('x:') ? `cell ${key.slice(2)}`
      : key.startsWith('s:') ? `text ${key.slice(2)}`
      : key.startsWith('p:') ? (([k, i]) => `${list(scene.series)[k]?.name}@${list(scene.labels)[i]}`)(key.slice(2).split('/').map(Number))
      : (({ owner, name }) => `${owner}.${name}`)(splitMemberKey(key));
    return [`${where} ${shown(before.values[key])} → ${shown(after.values[key])}`];
  });
  const places = Object.keys(after.places).flatMap((key) => {
    const [[a, b], [c, d]] = [before.places[key] ?? [], after.places[key]];
    return a === c && b === d ? [] : [`${key.replace(/^rg:/, 'range ').replace(/^ptr:/, 'pointer ')} ${a === b ? a : `${a}-${b}`} → ${c === d ? c : `${c}-${d}`}`];
  });
  const shows = [...new Set([...keysOf(before.hidden), ...keysOf(after.hidden)])].flatMap((key) => {
    const [was, is] = [Boolean(before.hidden[key]), Boolean(after.hidden[key])];
    return was === is ? [] : [`${is ? 'hides' : 'shows'} ${key.replace(/^(fr|o|ptr|rg|n|s|a):/, '').replace(/^r:/, 'row ').replace(/^e:/, 'edge ')}`];
  });
  const tints = [...new Set([...keysOf(before.tints), ...keysOf(after.tints)])].flatMap((key) => (before.tints?.[key] === after.tints?.[key] ? [] : [`tints ${key.startsWith('c:') ? (({ name, index }) => cellName(name, index))(splitCellKey(key)) : key.replace(/^\w+:/, '')} ${after.tints?.[key] ?? 'clear'}`]));
  const callout = before.callout === after.callout ? [] : [`callout ${after.callout ? JSON.stringify(plainText(after.callout)) : 'off'}`];
  const sort = before.sort === after.sort ? [] : [after.sort ? 'sorts by value' : 'puts the labels back in order'];
  return [...values, ...places, ...shows, ...tints, ...callout, ...sort];
}

/**
 * Every step of a scene as the viewer gets it: the words, what is lit (as labels), and what the step changes
 * on screen as it starts. Empty for a scene without steps.
 * @returns {{ say: string, lit: string[], changes: string[], items: Item[], litKeys: Set<string> }[]}
 */
export function stepViews(scene, hunks) {
  const steps = sceneSteps(scene);
  if (!steps.length) return [];
  if (scene.type === 'flow') {
    return steps.map((step, k) => ({ say: text(step?.say), lit: [`step ${k} ${step?.actor}: ${text(step?.action)}`], changes: [], items: [], litKeys: new Set() }));
  }
  const states = sceneStates(scene);
  const targets = stepTargets({ ...scene, steps: focusSteps(scene) }, hunks);
  return steps.map((step, k) => {
    const state = states[k + 1] ?? states[0] ?? { values: {}, places: {}, hidden: {} };
    const items = ITEMS[scene.type]?.(scene, state, hunks) ?? [];
    const litKeys = withRelated(items, targets[k] ?? []);
    // The dump lists what a step names; in an array or memory it adds the cells and values that light with it.
    const listed = STATE_TYPES.includes(scene.type) && scene.type !== 'chart' ? litKeys : new Set(targets[k]);
    return {
      say: text(step?.say),
      lit: items.filter((it) => listed.has(it.key)).map((it) => it.label),
      changes: states.length ? changesOf(scene, states[k], state) : [],
      items,
      litKeys,
    };
  });
}

// ─── Words that name an item ───

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** Words after a number that keep it a value ("five and one", "four is bigger"); any other word makes it a count ("two passes"). */
const VALUE_FOLLOWERS = new Set('and or is are was were than to with swap swaps swapped trade trades stay stays stayed move moves moved sit sits go goes went become becomes land lands into in on at so but then now from by against versus vs before after first last still also already itself'.split(' '));
/** Words before a number that make it the name of something else ("pass two", "step three"). */
const COUNT_LEADERS = new Set('pass step round line lines page chapter scene number every each about over under around index cell position slot'.split(' '));
/** Words before "one" that make it a pronoun ("the one on the right", "each one"). */
const ONE_LEADERS = new Set('the a each any no which every only this that another'.split(' '));
/** "The two swap", "both three are": a number between these words means the group, not a value. */
const GROUP_LEADERS = new Set('the these those all both'.split(' '));
const PLURAL_VERBS = new Set('are were swap trade stay move sit go become land have'.split(' '));
/** Words that move a pointer or range, so "to" or "at" after them leads its new index ("mid moves to 1"). */
const MOVES = new Set('move moves moved moving jump jumps jumped step steps stepped go goes went land lands landed slide slides slid shift shifts shifted advance advances advanced sit sits sat point points pointed start starts started stop stops stopped'.split(' '));
/** Words before a number that ends its sentence, making it an amount ("done in 50"). */
const AMOUNT_LEADERS = new Set('in within after'.split(' '));
/** Words that deny what a sentence names. */
const NEGATIONS = new Set('never not no nor without skips skipped bypasses'.split(' '));
/** Words never worth matching alone: a name made only of these is skipped. */
const STOP = new Set('a an the of to in on at by for and or is are be it this that its with from as not no yes if then so'.split(' '));

/** Words of a text, in their own case. */
const words = (s) => String(s).match(/[a-z0-9]+(?:[.'][a-z0-9]+)*/gi) ?? [];

/** The number a run of number words starting at `i` spells ("twenty three", "two hundred and five"), and its length. */
function spelled(ws, i) {
  const below100 = (j) => {
    const t = TENS.indexOf(ws[j]);
    if (t >= 2) {
      const u = NUMBER_WORDS.indexOf(ws[j + 1]);
      return u >= 1 && u <= 9 ? [t * 10 + u, 2] : [t * 10, 1];
    }
    const n = NUMBER_WORDS.indexOf(ws[j]);
    return n >= 0 ? [n, 1] : null;
  };
  const head = ws[i] === 'a' && ws[i + 1] === 'hundred' ? [1, 1] : below100(i);
  if (!head) return null;
  let [value, used] = head;
  if (ws[i + used] === 'hundred' && value >= 1 && value <= 9) {
    value *= 100;
    used++;
    const rest = below100(i + used + (ws[i + used] === 'and' ? 1 : 0));
    if (rest && rest[0] >= 1) [value, used] = [value + rest[0], used + (ws[i + used] === 'and' ? 1 : 0) + rest[1]];
  }
  return [value, used];
}

/**
 * A text's lowercase words with each spelled number as its digits, beside the first word it was spelled with and
 * the words as written.
 */
function wordsAndTokens(s) {
  const written = words(s);
  const ws = written.map((w) => w.toLowerCase());
  const out = [];
  for (let i = 0; i < ws.length; ) {
    const n = spelled(ws, i);
    const used = n ? n[1] : 1;
    out.push([n ? String(n[0]) : ws[i], ws[i], written.slice(i, i + used).join(' ')]);
    i += used;
  }
  return out;
}
const tokens = (s) => wordsAndTokens(s).map(([t]) => t);

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
  // Pointer and range names, after which "to" or "at" leads an index, not a value ("mid at 3").
  const markers = new Set(items.filter((it) => /^(ptr|rg):/.test(it.key)).flatMap((it) => tokens(list(it.names)[0] ?? '')));
  const found = [];
  for (const sentence of String(say).split(/(?<=[.!?;])\s+/)) {
    const pairs = wordsAndTokens(sentence);
    const said = pairs.map(([t]) => t);
    const raw = pairs.map(([, w]) => w);
    // As written, so the warning quotes "Q3", but a spelled number as its digits.
    const written = pairs.map(([t, w, as]) => (t === w ? as : t));
    // What a sentence denies ("the orders service is never reached", "count is 3, not 5") is named on purpose while dark.
    const denied = said.some((w) => NEGATIONS.has(w));
    const index = (i) => (said[i - 1] === 'to' || said[i - 1] === 'at') && (MOVES.has(said[i - 2]) || markers.has(said[i - 2]));
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
        (COUNT_LEADERS.has(said[i - 1]) || (raw[i] === 'one' && ONE_LEADERS.has(said[i - 1])) || index(i) ||
          (next === undefined && AMOUNT_LEADERS.has(said[i - 1])) ||
          (GROUP_LEADERS.has(said[i - 1]) && PLURAL_VERBS.has(next)) || (next !== undefined && !isNumber(next) && !VALUE_FOLLOWERS.has(next)));
      const meant = denied ? [] : names.filter((n) => n.t.join(' ') === phrase).map((n) => n.item);
      if (!counted && meant.length) found.push({ phrase: written.slice(i, i + best.t.length).join(' '), items: meant });
      i += best.t.length;
    }
  }
  return found;
}

/** The scene types whose words the highlight check reads. Code, terminal and text have no names it can match. */
export const HIGHLIGHT_TYPES = ['array', 'memory', 'graph', 'sequence', 'state', 'er', 'layers', 'timeline', 'chart', 'table', 'compare', 'svg', 'tests', 'image'];

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
      if (items.some((it) => [it.key, ...list(it.parts)].some((key) => view.litKeys.has(key)))) continue;
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
 * Code scenes are left out: their steps light the lines they name, which the audit has nothing to check against.
 */
export function formatSteps(storyboard, hunks, scenes) {
  const out = [];
  list(storyboard?.scenes).forEach((scene, i) => {
    if (scene?.type === 'code' || (scenes?.length && !scenes.includes(i))) return;
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
