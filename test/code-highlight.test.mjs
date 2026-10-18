import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { detectLanguage } from '../bin/lib/diff.mjs';

const load = async (file) => {
  const out = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const { tokenizeLines } = await load('../src/utils/highlight.ts');

const colored = (line) => line.filter((t) => t.content.trim()).map((t) => [t.content, t.types.at(-1)]);

test('a Dockerfile is highlighted: instructions as keywords, flags, strings and comments by kind', () => {
  const file = '# build the app\nFROM node:20 AS build\nCOPY --chown=app package.json ./\nCMD ["node", "server.js"]';
  const lines = tokenizeLines(file, detectLanguage('Dockerfile'));
  assert.deepEqual(lines.map(colored), [
    [['# build the app', 'comment']],
    [['FROM', 'keyword'], [' node:20 ', 'instruction'], ['AS', 'keyword'], [' build', 'instruction']],
    [['COPY', 'keyword'], ['--chown', 'property'], ['=', 'punctuation'], ['app', 'string'], [' package.json ./', 'instruction']],
    [['CMD', 'keyword'], [' [', 'instruction'], ['"node"', 'string'], [', ', 'instruction'], ['"server.js"', 'string'], [']', 'instruction']],
  ]);
  assert.deepEqual(tokenizeLines('RUN npm ci', 'dockerfile').map(colored), [[['RUN', 'keyword'], [' npm ci', 'instruction']]]);
});
