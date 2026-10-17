import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The scene as the player draws it, at a frame after every part has landed, through react-dom/server with
// remotion's hooks stubbed.
const REMOTION = `import { createElement } from 'react';
export const AbsoluteFill = ({ children, style }) => createElement('div', { style }, children);
export const useCurrentFrame = () => 120;
export const useVideoConfig = () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 });
export const spring = () => 1;
export const interpolate = (x, [a, b], [c, d]) => c + (d - c) * Math.min(1, Math.max(0, (x - a) / (b - a)));
export const Easing = { bezier: () => (t) => t };
export const delayRender = () => 0;
export const continueRender = () => {};`;
const root = new URL('..', import.meta.url).pathname;
const bundled = await build({
  stdin: { contents: `export { SvgDiagram } from './src/components/SvgDiagram.tsx'; export { renderToStaticMarkup } from 'react-dom/server'; export { createElement } from 'react';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.woff2': 'empty' },
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root)});` },
  plugins: [{ name: 'remotion', setup: (b) => {
    b.onResolve({ filter: /^remotion$/ }, (a) => ({ path: a.path, namespace: 'remotion' }));
    b.onLoad({ filter: /.*/, namespace: 'remotion' }, () => ({ contents: REMOTION, loader: 'js', resolveDir: root }));
  } }],
});
const { SvgDiagram, renderToStaticMarkup, createElement } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const drawn = (svg) => renderToStaticMarkup(createElement(SvgDiagram, { scene: { type: 'svg', narration: 'n', svg }, hunks: {}, durationInFrames: 300, segments: [] }));

test('the svg scene draws inside its stage, placed by the scene whatever the root <svg> says', () => {
  const html = drawn('<svg viewBox="0 0 10 10" transform="translate(-900 -900) scale(30)" x="40"><rect x="0" y="0" width="5" height="5"/></svg>');
  assert.match(html, /<svg width="1776" height="868" viewBox="-32 -32 1776 868" style="position:absolute;left:-32px;top:-32px;overflow:hidden"><g transform="translate\(454 0\) scale\(80.4\)"><g opacity="1"><rect /);
});

test('the svg scene draws no class and no paint it has not allowed', () => {
  const html = drawn('<svg viewBox="0 0 10 10"><rect class="tone-good fixed inset-0 bg-red-500" fill="\\75 rl(https://x/a)" stroke="u&#92;72 l(https://x/a)" width="5" height="5"/></svg>');
  assert.doesNotMatch(html, /class=|https:/);
  assert.match(html, /<rect width="5" height="5" fill="#3ddc9740" stroke="#3ddc97"><\/rect>/);
});
