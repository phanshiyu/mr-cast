// 0.26's additions to the stepped scenes: callout, tint, hidden graph and table parts, several arrays, graph
// badges and table cells that steps set, a table beside a graph, and the svg scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { checkHighlight, stepViews } from '../bin/lib/highlight.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { resolveRef } from '../shared/targets.mjs';
import { readSvg, svgGeometry } from '../shared/svg.mjs';

const check = async (scene) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
const errorsOf = async (scene) => (await check(scene)).errors;

const search = {
  type: 'array',
  narration: 'Binary search for seventy two.',
  values: [12, 45, 72, 99],
  callout: 'mid = L + ⌊(R − L) / 2⌋',
  steps: [
    { focus: 1, callout: '[45 < 72]{warn}', say: 'Forty five is too small.' },
    { tint: { '0-1': 'dim', 2: 'good' }, callout: '', say: 'So the first two are out.' },
    { tint: { 0: 'clear' }, focus: 0, say: 'Back again.' },
  ],
};

test('a callout is the scene\'s until a step replaces it, and "" takes it away', () => {
  const { states, problems } = walkStates(search);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => s.callout), ['mid = L + ⌊(R − L) / 2⌋', '[45 < 72]{warn}', '', '']);
});

test('a tint stays from its step on, a range ref colours each cell, and "clear" takes it off', () => {
  const { states } = walkStates(search);
  assert.deepEqual(states.map((s) => s.tints), [{}, {}, { 'c:0': 'dim', 'c:1': 'dim', 'c:2': 'good' }, { 'c:1': 'dim', 'c:2': 'good' }]);
});

test('validate names a tint that is no colour and a tint on a cell that does not exist', async () => {
  const errors = await errorsOf({ ...search, steps: [{ tint: { 9: 'good', 1: 'red' }, say: 'x' }] });
  assert.deepEqual(errors, [
    'scenes[0].steps[0].tint["1"]: "red" is no colour; a tint is one of neutral, accent, good, bad, warn, dim, clear',
    'scenes[0].steps[0].tint["9"]: names no cell; a tint key is a cell index or an "a-b" range of cells',
  ]);
});

test('a step that only dims lights what it dims; one that also changes something lights only that', () => {
  const scene = { type: 'array', values: [1, 2, 3], pointers: [{ name: 'lo', at: 0 }], steps: [{ tint: { 0: 'dim' }, say: 'Out.' }, { tint: { 1: 'dim' }, move: { lo: 2 }, say: 'Moves.' }] };
  const views = stepViews(scene, {});
  assert.deepEqual(views.map((v) => v.lit), [['cell 0 = 1'], ['cell 2 = 3', 'pointer lo at cell 2']]);
});

const merge = {
  type: 'array',
  narration: 'Merge two halves.',
  arrays: [
    { name: 'left', values: [13, 51] },
    { name: 'right', values: [4, 89] },
    { name: 'out', label: 'merged', values: ['', '', '', ''], hidden: true },
  ],
  pointers: [{ name: 'i', array: 'left', at: 0 }, { name: 'k', array: 'out', at: 0 }],
  steps: [
    { show: ['array:out'], focus: ['left[0]', 'right[0]'], say: 'Thirteen and four.' },
    { set: { 'out[0]': 4 }, tint: { 'right[0]': 'dim' }, move: { k: 1 }, say: 'Four goes first.' },
  ],
};

test('several arrays name their cells "name[i]" and "name[a-b]", and a whole one "array:name"', () => {
  assert.deepEqual(resolveRef(merge, 'left[0-1]'), ['c:left/0', 'c:left/1']);
  assert.deepEqual(resolveRef(merge, 'array:out'), ['a:out']);
  assert.equal(resolveRef(merge, 'left[2]'), null);
  const { states, problems } = walkStates(merge);
  assert.deepEqual(problems, []);
  assert.deepEqual(states[0].hidden, { 'a:out': true });
  assert.deepEqual([states[2].values['c:out/0'], states[2].places['ptr:k'], states[2].tints], [4, [1, 1], { 'c:right/0': 'dim' }]);
});

test('validate names a marker on an array that does not exist, and both values and arrays', async () => {
  assert.deepEqual(await errorsOf({ ...merge, pointers: [{ name: 'i', array: 'lefft', at: 0 }] }), ['scenes[0].pointers[0].array: "lefft" is no array; arrays are "left", "right", "out"; did you mean "left"?']);
  assert.deepEqual(await errorsOf({ ...merge, values: [1] }), ['scenes[0]: has both values and arrays; give values for one array, or arrays for several']);
});

const dijkstra = {
  type: 'graph',
  narration: 'Shortest paths from S.',
  nodes: [
    { id: 'S', label: 'S', badge: '0' },
    { id: 'A', label: 'A', badge: '∞' },
    { id: 'B', label: 'B', badge: '∞', hidden: true },
  ],
  edges: [{ from: 'S', to: 'A', label: '4' }, { from: 'S', to: 'B', label: '1', hidden: true }],
  table: { columns: ['Node', 'Distance'], rows: [{ cells: ['S', '0'] }, { cells: ['A', '∞'] }, { cells: ['B', '∞'], hidden: true }] },
  steps: [
    { set: { A: '4', 'Distance@A': '4' }, tint: { S: 'warn' }, say: 'A costs four.' },
    { show: ['B', 'S->B', 'row:B'], set: { 'Distance@A': { before: '4', after: '3' } }, callout: '1 + 2 = 3 < 4', say: 'Through B it costs three.' },
  ],
};

test('a graph step sets badges and the cells of the table beside it, and shows nodes, edges and rows', () => {
  const { states, problems } = walkStates(dijkstra);
  assert.deepEqual(problems, []);
  assert.deepEqual(states[0].hidden, { 'n:B': true, 'e:1': true, 'r:2': true });
  assert.deepEqual([states[1].values['b:A'], states[1].values['x:1/1'], states[1].tints], ['4', '4', { 'n:S': 'warn' }]);
  assert.deepEqual([states[2].hidden, states[2].values['x:1/1']], [{}, { before: '4', after: '3' }]);
  assert.deepEqual(resolveRef(dijkstra, 'Distance@A'), ['x:1/1']);
  assert.deepEqual(resolveRef(dijkstra, 'row:2'), ['r:2']);
});

test('the highlight check reads a graph badge as a value, and the table beside the graph', () => {
  const views = stepViews({ ...dijkstra, steps: [{ focus: 'S', say: 'A costs four.' }, ...dijkstra.steps] }, {});
  assert.ok(views[1].items.some((it) => it.label === 'node A (badge 4)'));
  assert.ok(views[2].lit.includes('table Distance of row 1 = 4 → 3'));
});

const ledger = {
  type: 'table',
  narration: 'A shared ledger.',
  columns: ['ID', 'Payment'],
  rows: [{ cells: ['1', 'Alice pays Charlie 50'] }, { cells: ['2', 'Charlie pays David 40'], hidden: true }],
  steps: [
    { show: [1], say: 'A second payment arrives.' },
    { tint: { 1: 'bad' }, set: { 'Payment@1': { before: 'Charlie pays David 40', after: 'rejected' } }, say: 'It is rejected.' },
  ],
};

test('a table row can start hidden, arrive with a step, and keep a tint', () => {
  const { states, problems } = walkStates(ledger);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => s.hidden), [{ 'r:1': true }, {}, {}]);
  assert.deepEqual(states[2].tints, { 'r:1': 'bad' });
  assert.deepEqual(states[2].values['x:1/1'], { before: 'Charlie pays David 40', after: 'rejected' });
});

test('a callout too long for the header fails validate like any text that does not fit', async () => {
  const errors = await errorsOf({ ...ledger, callout: 'a very long rule '.repeat(12) });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^scenes\[0\]\.callout: .*does not fit/);
});

// ─── svg ───

const drawing = `<svg viewBox="0 0 400 200">
  <defs><marker id="head"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
  <g id="cells" transform="translate(10 20)"><rect id="a" x="0" y="0" width="100" height="50"/><rect id="b" x="120" y="0" width="100" height="50" class="tone-good"/></g>
  <line id="arrow" x1="0" y1="150" x2="300" y2="150" marker-end="url(#head)"/>
  <text id="total" x="200" y="190" text-anchor="middle" font-size="24">sum = ?</text>
</svg>`;

test('readSvg keeps a drawing whole, with its viewBox and its ids', () => {
  const { viewBox, ids, problems } = readSvg(drawing);
  assert.deepEqual(problems, []);
  assert.deepEqual(viewBox, [0, 0, 400, 200]);
  assert.deepEqual([...ids.keys()], ['head', 'cells', 'a', 'b', 'arrow', 'total']);
});

test('readSvg cuts everything that is not drawing and says what it cut', () => {
  const { problems } = readSvg(
    '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" style="fill:red" fill="url(http://x/a)"/><image href="http://x/a.png"/><foreignObject/><use href="https://e/x#a"/><rect fill="var(--nope)"/></svg>',
  );
  assert.deepEqual(problems.map((p) => p.replace(/; a drawing uses .*/, '')), [
    '<svg> <script> is not drawn, so it is cut',
    '<svg> <rect> onclick: an event handler is cut',
    '<svg> <rect> style: a style attribute is cut; set fill, stroke and the rest as attributes',
    '<svg> <rect> fill: "url(http://x/a)" is no colour, so it is cut; a fill is a colour such as #7c8cff, none, currentColor or var(--good), or url(#id) for a gradient in the drawing',
    '<svg> <image> is not drawn, so it is cut',
    '<svg> <foreignObject> is not drawn, so it is cut',
    `<svg> <use> href: "https://e/x#a" points outside the drawing, so it is cut; point at an element's id, "#arrow"`,
    '<svg> <rect>: var(--nope) is no palette colour; they are --text, --muted, --faint, --bg, --surface, --border, --accent, --good, --bad, --warn, --neutral',
  ]);
  assert.deepEqual(readSvg('<svg><rect/></svg>').problems, ['<svg> needs a viewBox of four numbers with a positive width and height, such as viewBox="0 0 400 300"; it has none']);
  assert.deepEqual(readSvg('<svg viewBox="0 0 1 1"><g></svg>').problems, ['does not parse: </svg> closes <g>']);
  assert.deepEqual(readSvg('<svg viewBox="0 0 1 1"><rect fill="url(#nowhere)"/></svg>').problems, ['<svg> <rect> fill: points at "#nowhere", which no element has as its id']);
});

test('readSvg keeps paint and references only as colours and url(#id), whatever escape or entity spells a url', () => {
  const cut = (attrs) => readSvg(`<svg viewBox="0 0 10 10"><marker id="m"/><rect ${attrs}/></svg>`).problems.map((p) => p.replace(/^<svg> <rect> /, ''));
  // CSS reads each of these as url(...), so Chrome would fetch it.
  for (const [attr, value] of [
    ['fill', '\\75 rl(https://x/a)'],
    ['stroke', 'u\\72 l(https://x/a)'],
    ['clip-path', 'ur\\6c(https://x/a)'],
    ['marker-end', 'url(\\68 ttps://x/a)'],
    ['fill', '&#92;75 rl(https://x/a)'],
    ['stroke', 'u&#x5C;72 l(https://x/a)'],
  ]) {
    assert.deepEqual(cut(`${attr}="${value}"`), [`${attr}: "${value.replace('&#92;', '\\').replace('&#x5C;', '\\')}" has a backslash, which CSS reads as an escape, so it is cut`]);
  }
  assert.deepEqual(cut('fill="&#117;rl(https://x/a)"'), ['fill: "url(https://x/a)" is no colour, so it is cut; a fill is a colour such as #7c8cff, none, currentColor or var(--good), or url(#id) for a gradient in the drawing']);
  assert.deepEqual(cut('stroke="URL(https://x/a)"'), ['stroke: "URL(https://x/a)" is no colour, so it is cut; a stroke is a colour such as #7c8cff, none, currentColor or var(--good), or url(#id) for a gradient in the drawing']);
  assert.deepEqual(cut('marker-end="Url(https://x/a)"'), ['marker-end: "Url(https://x/a)" is not url(#id), so it is cut; point at a marker in the drawing, url(#id), or write none']);
  assert.deepEqual(cut('clip-path="url(#m) url(https://x/a)"'), ['clip-path: "url(#m) url(https://x/a)" is not url(#id), so it is cut; point at a clip path in the drawing, url(#id), or write none']);
  assert.deepEqual(cut('fill="var(--good, url(https://x/a))"'), ['fill: "var(--good, url(https://x/a))" is no colour, so it is cut; a fill is a colour such as #7c8cff, none, currentColor or var(--good), or url(#id) for a gradient in the drawing']);
  assert.deepEqual(cut('transform="translate(1 2) url(https://x/a)"'), ['transform: "translate(1 2) url(https://x/a)" loads from outside the drawing, so it is cut; use url(#id) in fill, stroke, clip-path or a marker']);
  assert.deepEqual(cut('font-family="a\\62 c"'), ['font-family: "a\\62 c" has a backslash, which CSS reads as an escape, so it is cut']);

  const kept = readSvg('<svg viewBox="0 0 10 10"><marker id="m"/><rect fill="#7C8CFF" stroke="currentColor" marker-end="URL( \'#m\' )" clip-path="none"/><rect fill="rgb(1, 2, 3)" stroke="var(--good)"/><style>@import url(https://x/a.css);</style></svg>');
  assert.deepEqual(kept.problems.map((p) => p.replace(/; a drawing uses .*/, '')), ['<svg> <style> is not drawn, so it is cut']);
  assert.deepEqual(kept.root.children.map((n) => n.attrs), [{ id: 'm' }, { fill: '#7C8CFF', stroke: 'currentColor', 'marker-end': 'url(#m)', 'clip-path': 'none' }, { fill: 'rgb(1, 2, 3)', stroke: 'var(--good)' }]);
});

test('readSvg keeps only tone classes, and cuts what would move the root off its stage', () => {
  const { root, problems } = readSvg('<svg viewBox="0 0 10 10" transform="scale(3)" x="5" fill="var(--text)"><rect class="tone-good absolute inset-0 fill-bad"/><rect class="bg-red-500"/></svg>');
  assert.deepEqual(problems, [
    '<svg> transform: the scene places the drawing on its stage, so transform on the root <svg> is cut; put it on a <g> inside',
    '<svg> x: the scene places the drawing on its stage, so x on the root <svg> is cut; put it on a <g> inside',
    '<svg> <rect> class: "absolute", "inset-0" are no tone classes, so they are cut; a class is tone-, fill- or stroke- and one of accent, good, bad, warn, neutral, such as tone-good',
    '<svg> <rect> class: "bg-red-500" is no tone class, so it is cut; a class is tone-, fill- or stroke- and one of accent, good, bad, warn, neutral, such as tone-good',
  ]);
  assert.deepEqual(root.attrs, { viewBox: '0 0 10 10', fill: 'var(--text)' });
  assert.deepEqual(root.children.map((n) => n.attrs), [{ class: 'tone-good fill-bad' }, {}]);
});

test('svgGeometry boxes each element through its transforms, and a group around its children', () => {
  const { boxes, texts } = svgGeometry(readSvg(drawing).root);
  assert.deepEqual(boxes.get('a'), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(boxes.get('cells'), { x: 10, y: 20, width: 220, height: 50 });
  assert.deepEqual(boxes.get('arrow'), { x: 0, y: 150, width: 300, height: 0 });
  assert.deepEqual(texts.map((t) => [t.id, t.size]), [['total', 24]]);
});

const svgScene = {
  type: 'svg',
  title: 'A drawing',
  narration: 'Two cells and a total.',
  svg: drawing,
  labels: { b: 'the second cell' },
  hidden: ['arrow'],
  steps: [
    { show: ['arrow'], tint: { cells: 'good' }, say: 'The arrow appears.' },
    { set: { total: 'sum = 12' }, say: 'The sum is twelve.' },
  ],
};

test('an svg scene shows, tints and rewrites its elements by id', async () => {
  const { states, problems } = walkStates(svgScene);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => s.hidden), [{ 's:arrow': true }, {}, {}]);
  assert.deepEqual(states[1].tints, { 's:cells': 'good' });
  assert.deepEqual(states.map((s) => s.values['s:total']), ['sum = ?', 'sum = ?', 'sum = 12']);
  assert.deepEqual(await errorsOf(svgScene), []);
});

test('validate names an id the drawing lacks, text set on a shape, and markup it cut', async () => {
  const errors = await errorsOf({ ...svgScene, hidden: ['arow'], steps: [{ set: { a: 'x' }, say: 'x' }] });
  assert.deepEqual(errors, ['scenes[0].hidden[0]: "arow" is no element id in the drawing; did you mean "arrow"?']);
  assert.deepEqual(await errorsOf({ ...svgScene, steps: [{ set: { a: 'x' }, say: 'x' }] }), ['scenes[0].steps[0].set["a"]: names an element that is not <text>; only text can be set']);
  assert.deepEqual(await errorsOf({ ...svgScene, svg: drawing.replace('<line', '<image href="x.png"/><line') }), [
    'scenes[0].svg: <svg> <image> is not drawn, so it is cut; a drawing uses g, defs, title, desc, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, marker, linearGradient, radialGradient, stop, clipPath, use',
  ]);
});

test('validate warns on drawing text too small to read once scaled, and text past the viewBox', async () => {
  const tiny = '<svg viewBox="0 0 4000 2000"><text x="10" y="100" font-size="20">far too small</text><text x="3990" y="1000" font-size="200">cut off</text></svg>';
  const { warnings } = await check({ type: 'svg', title: 't', narration: 'x', svg: tiny });
  assert.deepEqual(warnings, [
    'scenes[0].svg: text "far too small" draws about 7px tall on screen, too small to read; make its font-size at least 41 in viewBox units, or shrink the viewBox',
    'scenes[0].svg: text "cut off" runs past the viewBox (0 0 4000 2000), so part of it is cut off; move it in, or widen the viewBox',
  ]);
});

test('the highlight check matches an svg label to what a step lights', () => {
  const scene = { ...svgScene, steps: [{ focus: 'a', say: 'Look at the second cell.' }] };
  assert.deepEqual(stepViews(scene, {})[0].lit, ['rect a']);
  const warnings = [];
  checkHighlight(scene, 'scenes[0]', {}, warnings);
  assert.deepEqual(warnings, ['scenes[0].steps[0]: says "the second cell" (rect b), which is not lit; it lights rect a. Focus what the words name, or say only what is lit']);
});

// ─── layout ───

const bundle = async (file) => {
  const out = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};

test('several arrays share one cell size, each label left of its own row', async () => {
  const { layoutArray } = await bundle('../src/utils/arrayLayout.ts');
  const layout = layoutArray(merge, { width: 1712, height: 760 });
  assert.equal(layout.rows.length, 3);
  for (const row of layout.rows) assert.ok(row.labelX + row.label.width < row.x, `${row.name}'s label ends before its cells`);
  assert.ok(layout.rows[0].cellsY < layout.rows[1].cellsY && layout.rows[1].cellsY < layout.rows[2].cellsY);
});

test('a hex grid sets every other row half a cell right', async () => {
  const { layoutArray, cellBox } = await bundle('../src/utils/arrayLayout.ts');
  const grid = { type: 'array', cells: 'hex', arrays: [{ name: 'r0', values: ['', ''] }, { name: 'r1', values: ['', ''] }] };
  const layout = layoutArray(grid, { width: 1712, height: 760 });
  assert.equal(cellBox(layout, 'c:r1/0').x - cellBox(layout, 'c:r0/0').x, layout.slotW / 2);
});

test('a table whose cells change keeps its columns from state to state', async () => {
  const { layoutTableStates, stateRows } = await bundle('../src/utils/tableLayout.ts');
  const layouts = layoutTableStates(ledger.columns, stateRows(ledger.columns, ledger.rows, walkStates(ledger).states), 1712, 700);
  assert.equal(layouts.length, 3);
  assert.deepEqual(layouts[0].cols, layouts[2].cols);
  assert.equal(layouts[2].rows[1].cells[1].kind, 'change');
});

test('the dashed slot past an array end shows only while a pointer stands on it', async () => {
  const { layoutArray, ghostShown } = await bundle('../src/utils/arrayLayout.ts');
  const scene = { type: 'array', narration: 'x', values: [1, 2, 3], pointers: [{ name: 'i', at: 0 }], steps: [{ move: { i: 3 }, say: 'Past the end.' }, { move: { i: 1 }, say: 'Back.' }] };
  assert.deepEqual(layoutArray(scene, { width: 1712, height: 760 }).rows[0].ghosts, { left: false, right: true });
  const atEachStep = walkStates(scene).states.map((state) => ghostShown([{ row: '', at: state.places['ptr:i'][0], shown: 1 }], '', 3));
  assert.deepEqual(atEachStep, [0, 1, 0]);
});

test('a long title beside a callout wraps onto a second line, and the content below gives up that line', async () => {
  const scene = { ...search, title: 'Binary search halves the part of the sorted list it still has to look at, every step' };
  assert.deepEqual(await errorsOf(scene), []);
  const { shellFits, headerBox } = await bundle('../src/fit/shell.ts');
  const { title } = shellFits(scene);
  assert.equal(title.size, 50);
  assert.equal(title.lines.length, 2);
  assert.equal(headerBox({ ...search, title: 'Binary search' }).height - headerBox(scene).height, 60);
});
