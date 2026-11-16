import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairShapes, tweenShape, tweenTransform } from '../shared/svg-motion.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const svgScene = (svg, steps, extra = {}) => ({ type: 'svg', narration: 'A drawing.', svg, steps, ...extra });
test("a move tweens a rotation about its pivot, outside the element's own transform", () => {
  assert.equal(tweenTransform('', 'rotate(90 350 350)', 0.5), 'rotate(45 350 350)');
  assert.equal(tweenTransform('translate(10 0)', 'translate(30 20)', 0.5), 'translate(20 10)');
});

test("a move given as { to, when } plays evenly from its words to the end of the step's say, and { to } across the whole say", () => {
  const svg =
    '<svg viewBox="0 0 400 400"><g id="sat"><circle cx="200" cy="40" r="10"/></g><g id="hand"><line x1="200" y1="200" x2="200" y2="80"/></g></svg>';
  const scene = svgScene(svg, [
    {
      move: { sat: { to: 'rotate(360 200 200)', when: 'all the way round' }, hand: { to: 'rotate(90 200 200)' } },
      say: 'It goes all the way round in twelve hours.',
    },
  ]);
  const { states, problems } = walkStates(scene);
  assert.deepEqual(problems, []);
  assert.deepEqual(states[1].transforms, { 's:sat': 'rotate(360 200 200)', 's:hand': 'rotate(90 200 200)' });
});

test('two transforms of different functions tween through a move, a turn and a scale', () => {
  assert.equal(tweenTransform('translate(100 0)', 'rotate(90)', 0.5), 'translate(50 0) rotate(45 0 0) scale(1 1)');
  assert.equal(tweenTransform('translate(100 0)', 'rotate(90)', 1), 'rotate(90 0 0)');
});

test('a morph pairs a circle of arcs with a square of lines curve for curve', () => {
  const circle = 'M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z';
  const square = 'M0 0 H100 V100 H0 Z';
  const paired = pairShapes(circle, square);
  assert.equal(paired.from[0].curves.length, paired.to[0].curves.length);
  assert.equal(
    tweenShape(paired, 0),
    'M50 0C77.614 0 100 22.386 100 50C100 77.614 77.614 100 50 100C22.386 100 0 77.614 0 50C0 22.386 22.386 0 50 0Z',
  );
  assert.equal(
    tweenShape(paired, 1),
    'M0 0C33.333 0 66.667 0 100 0C100 33.333 100 66.667 100 100C66.667 100 33.333 100 0 100C0 66.667 0 33.333 0 0Z',
  );
  assert.throws(() => pairShapes('M0 0 L1 1 M5 5 L6 6', square), /draws 2 outlines and the other 1/);
});

test("a morphed path draws the other path's shape once the step settles, and its own again when named after itself", () => {
  const scene = svgScene(
    '<svg viewBox="0 0 100 100"><path id="blob" d="M0 0 L10 0 L10 10 Z"/><path id="sq" d="M0 0 H50 V50 H0 Z"/></svg>',
    [
      { morph: { blob: 'sq' }, say: 'It squares up.' },
      { morph: { blob: 'blob' }, say: 'And back.' },
    ],
    { hidden: ['sq'] },
  );
  const { states, problems } = walkStates(scene);
  assert.deepEqual(
    states.map((s) => s.shapes),
    [{}, { 's:blob': 'sq' }, {}],
  );
  assert.deepEqual(problems, []);
});

test('a trace shows a hidden line and draws it on from its cue, then leaves it whole', () => {
  const scene = svgScene(
    '<svg viewBox="0 0 1000 500"><line id="route" x1="0" y1="250" x2="1000" y2="250" stroke="var(--good)"/></svg>',
    [{ trace: [{ ref: 'route', when: 'south' }], say: 'The route runs south round the coast.' }],
    { hidden: ['route'] },
  );
  assert.deepEqual(
    walkStates(scene).states.map((s) => [s.hidden['s:route'] === true, s.traces]),
    [
      [true, {}],
      [false, { 's:route': 'south' }],
    ],
  );
});

const check = async (scene) => {
  const { errors, warnings } = await validateStoryboard(
    { title: 'Motion', scenes: [{ chapter: 'Motion', ...scene }] },
    {},
    { mode: 'explain' },
  );
  return { errors, warnings };
};

test('validate names a move, trace or morph it cannot draw', async () => {
  const svg =
    '<svg viewBox="0 0 400 300" id="all"><path id="a" d="M0 0 L10 0 L10 10 Z"/><path id="two" d="M0 0 L1 1 M5 5 L6 6"/><text id="t" x="10" y="20" font-size="30">hi</text><rect id="r" width="10" height="10"/></svg>';
  const { errors } = await check(
    svgScene(svg, [
      {
        move: {
          all: 'translate(1 0)',
          a: 'skewX(10)',
          ghost: 'translate(1 0)',
          r: { to: 'translate(1 0)', when: 'later' },
          two: { to: 'translate(1 0)', over: 2 },
        },
        say: 'Move.',
      },
      { trace: ['t', { ref: 'a', when: 'nowhere' }, 'nope'], say: 'Trace it.' },
      { morph: { a: 'two', r: 'a', t: 'r' }, say: 'Morph.' },
    ]),
  );
  assert.deepEqual(errors, [
    'scenes[0].steps[0].move["all"]: is the root <svg>, which the scene places on its stage; wrap what moves in a <g id="..."> and move that',
    'scenes[0].steps[0].move["a"]: "skewX(10)" is no transform; a move is translate(x y), rotate(degrees cx cy) and scale(s), alone or in a row, such as "translate(300 0) rotate(90 50 50)", or "" to put it back',
    'scenes[0].steps[0].move["ghost"]: names no element id; it can be "all", "a", "two", "t", "r"',
    'scenes[0].steps[0].move["r"]: has "when": "later", which is not in the step\'s say; copy the words the move should start on',
    'scenes[0].steps[0].move["two"]: must be a transform, or { "to": transform, "when": words of the say } to play the move from those words to the end of the say',
    'scenes[0].steps[1].trace["t"]: is a <text>, which has no line to draw on; trace a path, line, polyline, polygon, rect, circle, ellipse, or a <g> of them',
    'scenes[0].steps[1].trace["a"]: has "when": "nowhere", which is not in the step\'s say; copy the words the line should start drawing on',
    'scenes[0].steps[1].trace["nope"]: names no element id in the drawing; it can be "all", "a", "two", "t", "r"',
    'scenes[0].steps[2].morph["a"]: cannot turn into "two": it draws 1 outline and the other 2; a morph pairs them one to one, so give both the same number of M…Z parts',
    'scenes[0].steps[2].morph["r"]: is a <rect>; only a <path> morphs, so draw it as one',
    'scenes[0].steps[2].morph["t"]: is a <text>; only a <path> morphs, so draw it as one',
  ]);
  const other = await check({
    type: 'array',
    narration: 'n',
    values: [1, 2],
    steps: [{ trace: ['0'], focus: 0, say: 'Trace.' }],
  });
  assert.deepEqual(other.errors, [
    'scenes[0].steps[0].trace: an array scene has nothing to trace; trace goes on the steps of svg, plot, map',
  ]);
});

test('a hidden path that lends a morph its shape is not reported as never drawn', async () => {
  const svg =
    '<svg viewBox="0 0 400 300"><path id="a" d="M0 0 L100 0 L100 100 Z"/><path id="b" d="M0 0 H100 V100 H0 Z"/><path id="c" d="M0 0 H9"/></svg>';
  const { errors, warnings } = await check(
    svgScene(svg, [{ morph: { a: 'b' }, say: 'It squares up.' }], { hidden: ['b', 'c'] }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.filter((w) => w.includes('never drawn')),
    ['scenes[0].hidden[1]: starts hidden and no step shows it, so it is never drawn'],
  );
});

test('mr-cast steps lists what a step moves, traces and morphs, and where its camera points', async () => {
  const { stepViews } = await import('../bin/lib/highlight.mjs');
  const svg =
    '<svg viewBox="0 0 100 100"><path id="a" d="M0 0 L10 0 L10 10 Z"/><path id="b" d="M0 0 H50 V50 H0 Z"/><line id="l" x1="0" y1="0" x2="9" y2="9"/></svg>';
  const scene = svgScene(
    svg,
    [
      { move: { a: 'translate(5 0)' }, trace: [{ ref: 'l', when: 'draws' }], say: 'It slides and the line draws.' },
      { morph: { a: 'b' }, move: { a: '' }, camera: { on: ['a', 'l'], zoom: 3 }, say: 'Closer.' },
      { camera: 'all', focus: 'a', say: 'Back.' },
    ],
    { hidden: ['b'] },
  );
  assert.deepEqual(
    stepViews(scene, {}).map((v) => v.changes),
    [
      ['moves a "translate(5 0)"', 'traces l from "draws"'],
      ['moves a back', 'morphs a into b', 'camera on a, l at 3x'],
      ['camera on the whole scene'],
    ],
  );
});
