import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { LAYERS_MAX } from '../bin/lib/validate-layers.mjs';
import { layerRoute, tokenSteps } from '../shared/layers.mjs';
import { refNames, resolveRef } from '../shared/targets.mjs';

const stack = (path, steps) => ({
  type: 'layers',
  narration: 'The API runs every request through these layers in order.',
  layers: [
    {
      id: 'http',
      label: 'HTTP server',
      items: [
        { id: 'cors', label: 'cors' },
        { id: 'json', label: 'express.json' },
      ],
    },
    { id: 'limits', label: 'Rate limiting', items: [{ id: 'limiter', label: 'rateLimit' }] },
    { id: 'routes', label: 'Routes', items: [{ id: 'v1.orders', label: 'POST /orders' }] },
    { id: 'data', label: 'Data' },
  ],
  ...(path ? { path } : {}),
  ...(steps ? { steps } : {}),
});

const skipping = {
  label: 'POST /orders',
  stops: ['http', 'limiter', 'v1.orders', 'data'],
  skip: { at: 'limiter', reply: '429 Too Many Requests' },
};

test('a layers ref names a layer, an item by id or by "layer.item", or a path stop by index', () => {
  const s = stack(skipping);
  assert.deepEqual(resolveRef(s, 'limits'), ['l:limits']);
  assert.deepEqual(resolveRef(s, 'limiter'), ['i:limiter']);
  assert.deepEqual(resolveRef(s, 'limits.limiter'), ['i:limiter']);
  assert.deepEqual(resolveRef(s, 'routes.v1.orders'), ['i:v1.orders']);
  assert.deepEqual(resolveRef(s, 2), ['i:v1.orders']);
  assert.deepEqual(resolveRef(s, '3'), ['l:data']);
  assert.equal(resolveRef(s, 4), null);
  assert.equal(resolveRef(s, 'http.limiter'), null);
  assert.equal(resolveRef(stack(), 0), null);
});

test('refNames suggests layer ids, item ids and layer.item refs', () => {
  assert.deepEqual(refNames(stack()), [
    'http',
    'limits',
    'routes',
    'data',
    'cors',
    'http.cors',
    'json',
    'http.json',
    'limiter',
    'limits.limiter',
    'v1.orders',
    'routes.v1.orders',
  ]);
});

test('a skip turns the token back at its stop and skips the stops below', () => {
  const { visits, turn, skipped } = layerRoute(stack(skipping));
  assert.deepEqual(
    visits.map((v) => `${v.leg}:${v.key}`),
    ['down:l:http', 'down:i:limiter', 'up:i:limiter', 'up:l:http'],
  );
  assert.equal(turn, 1);
  assert.deepEqual(skipped, ['i:v1.orders', 'l:data']);
});

test('a path without return or skip only goes down; with return it comes back through every stop', () => {
  const down = { stops: ['http', 'limiter', 'data'] };
  assert.deepEqual(
    layerRoute(stack(down)).visits.map((v) => v.leg + v.stop),
    ['down0', 'down1', 'down2'],
  );
  assert.deepEqual(
    layerRoute(stack({ ...down, return: true })).visits.map((v) => v.leg + v.stop),
    ['down0', 'down1', 'down2', 'up2', 'up1', 'up0'],
  );
});

test('the token moves on to each focused stop, and focusing the first stop again brings it back up', () => {
  const steps = [{ focus: 'http' }, { focus: 'cors' }, { focus: 'limiter' }, { focus: 0 }, { focus: 'data' }];
  assert.deepEqual(tokenSteps(stack(skipping, steps)), { positions: [0, 0, 1, 3, 3], stuck: [4] });
});

const board = (scene) => ({
  title: 't',
  scenes: [{ type: 'intent', summary: 's', bullets: ['b'], narration: 'The layers of the API.' }, scene],
});
const check = async (scene) => validateStoryboard(board(scene), {}, { mode: 'explain' });

test('validate accepts a stack whose steps walk the path down and back', async () => {
  const steps = [
    { focus: 'http', say: 'The request reaches the server first.' },
    { focus: 'limiter', say: 'The rate limiter counts the requests.' },
    { focus: 0, say: 'Past the limit the answer goes straight back.' },
  ];
  const { errors, warnings } = await check(stack(skipping, steps));
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.filter((w) => w.startsWith('scenes[1]')),
    [],
  );
});

test('validate rejects stops out of order, repeated ids, unknown stops and a skip at the last stop', async () => {
  const dup = stack({ stops: ['limiter', 'http', 'nowhere'], skip: { at: 'limiter', reply: '429' } });
  dup.layers[3].items = [{ id: 'cors', label: 'again' }];
  assert.deepEqual((await check(dup)).errors, [
    'scenes[1].layers[3].items[0].id: "cors" is also scenes[1].layers[0].items[0]; every layer and item needs its own id',
  ]);
  const { errors } = await check(
    stack({ stops: ['limiter', 'http', 'nowhere', 'data'], skip: { at: 'data', reply: '429' } }),
  );
  assert.deepEqual(errors, [
    'scenes[1].path.stops[1]: "http" sits above the stop before it; stops go down the stack in order, since the screen\'s order is the real order, and return brings the token back up',
    'scenes[1].path.stops[2]: "nowhere" names no layer or item; a stop is a layer id, an item id or "layer.item"',
    'scenes[1].path.skip.at: "data" is the last stop, so nothing is skipped; list the stops it would have reached after it, or use return',
  ]);
});

test('validate warns when steps leave the reply unshown or focus a stop the token has passed', async () => {
  const steps = [
    { focus: 'limiter', say: 'The rate limiter counts the requests.' },
    { focus: 'http', say: 'The server comes before the rate limiter.' },
  ];
  const s = stack({ ...skipping, skip: undefined, return: true }, steps);
  const { errors, warnings } = await check(s);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.filter((w) => w.startsWith('scenes[1]')),
    [],
  );
  const stuck = await check(
    stack(skipping, [steps[0], { focus: 'data', say: 'The database is below the rate limiter.' }]),
  );
  assert.deepEqual(
    stuck.warnings.filter((w) => w.startsWith('scenes[1]')),
    [
      'scenes[1].steps[1]: focuses a stop the token has passed or never reaches, so it does not move there; the token only moves on along its path',
      'scenes[1].steps: no step brings the token back up, so its reply never shows; end with a step that focuses the first stop',
    ],
  );
});

test('when the token turns back at the first stop, focusing that stop again brings the reply up', async () => {
  const atFirst = {
    label: 'POST /orders',
    stops: ['limiter', 'v1.orders', 'data'],
    skip: { at: 'limiter', reply: '429 Too Many Requests' },
  };
  const twice = [
    { focus: 'limiter', say: 'The rate limiter sees the request first.' },
    { focus: 'limiter', say: 'It is over the limit, so it answers right away.' },
  ];
  assert.deepEqual(tokenSteps(stack(atFirst, twice)), { positions: [0, 1], stuck: [] });
  assert.deepEqual(
    (await check(stack(atFirst, twice))).warnings.filter((w) => w.startsWith('scenes[1]')),
    [],
  );
  const once = await check(stack(atFirst, [twice[0]]));
  assert.deepEqual(
    once.warnings.filter((w) => w.startsWith('scenes[1]')),
    [
      'scenes[1].steps: no step brings the token back up, so its reply never shows; end with a step that focuses the first stop again, after the step that brings the token to it',
    ],
  );
  const oneStop = stack({ stops: ['routes'], return: true, reply: '201 Created' }, [
    { focus: 'routes', say: 'The route handles the order.' },
    { focus: 'routes', say: 'And answers that it is created.' },
  ]);
  assert.deepEqual(tokenSteps(oneStop), { positions: [0, 1], stuck: [] });
});

test('focusing the stop the token sits on mid-route keeps it there', () => {
  const steps = [{ focus: 'http' }, { focus: 'http' }, { focus: 'limiter' }];
  assert.deepEqual(tokenSteps(stack({ ...skipping, skip: undefined, return: true }, steps)).positions, [0, 0, 1]);
});

test('the schema gives the layer count validate checks', async () => {
  assert.match(
    fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8'),
    new RegExp(`the first to see a request, on top\\. Up to ${LAYERS_MAX}\\.`),
  );
  const two = {
    type: 'layers',
    narration: 'The client calls the server.',
    layers: [
      { id: 'client', label: 'Client' },
      { id: 'server', label: 'Server' },
    ],
  };
  assert.deepEqual(
    (await check(two)).warnings.filter((w) => w.startsWith('scenes[1]')),
    [],
  );
});
