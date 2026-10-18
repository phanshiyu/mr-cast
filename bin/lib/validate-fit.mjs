// Checks that every text a scene draws fits where the scene draws it, and that its markup is well formed.
// It runs the player's own layout code (src/fit/report.ts, bundled here with esbuild), so `validate` and
// the rendered video can never disagree about which text fits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inkBoard } from '../../shared/ink.mjs';
import { hasMarkup } from '../../shared/markup.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import { refNames, resolveRef } from '../../shared/targets.mjs';
import { READABLE_PX } from '../../shared/textfit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'src/fit/report.ts');

let loaded;
/** The report module, bundled from the player's source on first use. */
async function reportModule() {
  loaded ??= (async () => {
    const { build } = await import('esbuild');
    const result = await build({ entryPoints: [ENTRY], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' });
    const code = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  })();
  return loaded;
}

const quote = (text) => JSON.stringify(text);

/** "scenes[2].nodes[1].label" and the scene's chapter, so the author finds it on screen too. */
function where(scene, i, fitPath) {
  const chapter = scene.chapter ? ` (${quote(scene.chapter)})` : '';
  return `scenes[${i}]${chapter}${fitPath ? `.${fitPath}` : ''}`;
}

/**
 * Text that does not fit at its slot's smallest readable size, and markup errors. `storyboard` is normalized and otherwise valid.
 */
export async function checkFit(storyboard, hunks, errors, warnings) {
  if (!fs.existsSync(ENTRY)) return;
  let reports;
  let stages;
  try {
    const { fitReport, inkStages } = await reportModule();
    reports = fitReport(storyboard, hunks);
    stages = inkStages(storyboard);
  } catch (err) {
    warnings.push(`could not check that the text fits (${err.message}); run \`mr-cast still\` and look for text running past its box`);
    return;
  }
  checkInkPoints(storyboard, hunks, stages, warnings);
  for (const { scene: i, fits, scaled } of reports) {
    const scene = storyboard.scenes[i];
    for (const part of scaled) {
      const message = unreadable(part);
      if (message) warnings.push(`${where(scene, i, '')}: ${message}`);
    }
    const seen = new Set();
    for (const fit of fits) {
      const at = where(scene, i, fit.path);
      for (const e of fit.markupErrors) errors.push(`${at}: ${quote(fit.text)} column ${e.at}: ${e.message}`);
      if (!fit.fits) {
        const key = `${fit.path}\n${fit.slot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const message = fit.text ? `${at}: ${quote(fit.text)} does not fit its ${fit.slot}, even at ${fit.min}px; ${fit.fix}` : `${at}: the ${fit.slot} does not fit the screen at the smallest readable size; ${fit.fix}`;
        (fit.severity === 'warning' ? warnings : errors).push(message);
      }
    }
  }
}

/** Handwriting's size and an upper estimate of its width a character, as the player writes it (src/components/Ink.tsx). */
const WRITE_PX = 42;
const WRITE_ADVANCE = 0.42;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Text written `at` a point that lands on something the scene draws while the text is up. Only the scene types whose
 * layout gives each step's boxes without rendering are checked: graph, table, array, memory, svg and state.
 */
function checkInkPoints(storyboard, hunks, stages, warnings) {
  storyboard.scenes.forEach((scene, i) => {
    const steps = stages[i];
    if (!steps) return;
    // Each key by the narrowest ref that names it: a cell's index rather than a range over every cell.
    const named = new Map();
    const width = new Map();
    const names = [...refNames(scene, hunks), ...(Array.isArray(scene.values) ? scene.values.map((_, n) => String(n)) : [])];
    for (const name of names) {
      const keys = resolveRef(scene, name, hunks) ?? [];
      for (const key of keys) if (!named.has(key) || keys.length < width.get(key)) [named.set(key, name), width.set(key, keys.length)];
    }
    for (const { step, index, item, until } of inkBoard(scene, hunks).items) {
      if (!item.at || typeof item.write !== 'string') continue;
      const lines = item.write.split('\n');
      const { area } = steps[step];
      const width = Math.max(...lines.map((l) => l.length)) * WRITE_PX * WRITE_ADVANCE + 10;
      const height = lines.length * Math.round(WRITE_PX * 1.2);
      const x = Math.min(Math.max(area.x + item.at[0] * area.width, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(area.y + item.at[1] * area.height, area.y), area.y + area.height - height);
      const text = { x, y, width, height };
      const hit = steps.slice(step, Math.min(until, steps.length)).flatMap((s, j) => s.boxes.filter(([, b]) => overlaps(text, b)).map(([key]) => ({ key, at: step + j })))[0];
      if (hit) warnings.push(`scenes[${i}].steps[${step}].draw[${index}].at: the text lands on ${named.has(hit.key) ? JSON.stringify(named.get(hit.key)) : 'part of the drawing'}${hit.at === step ? '' : ` once step ${hit.at} shows it`}; move it to free space, or write it near a ref`);
    }
  });
}

/** A size to one decimal, rounded down so a size under the minimum never prints as the minimum: 14.96 is "14.9". */
export const tenths = (px) => (Math.floor(px * 10) / 10).toFixed(1);

/**
 * "unreadable: the graph is scaled to 0.52, so it draws its card title at 11.4 px (22 px unscaled), ..." when the
 * scale puts a text under both the readable size and its slot's own smallest size. Null when every text
 * reads, or when the part already fails to fit at its smallest size, which the fit check reports.
 */
function unreadable({ name, scale, fits }) {
  if (fits.some((f) => !f.text && !f.fits)) return null;
  const largest = new Map();
  for (const f of fits) {
    if (!f.text || f.size * scale >= Math.min(READABLE_PX, f.min)) continue;
    if ((largest.get(f.slot) ?? 0) < f.size) largest.set(f.slot, f.size);
  }
  if (!largest.size) return null;
  const parts = [...largest].sort((a, b) => b[1] - a[1]).map(([slot, size]) => `${slot} at ${tenths(size * scale)} px (${size} px unscaled)`);
  return `unreadable: the ${name} is scaled to ${scale.toFixed(2)}, so it draws its ${parts.join(', ')}, under the ${READABLE_PX} px readable minimum`;
}

/** Markup in spoken text and pen notes is not drawn as styling: the voice reads the words and notes are handwritten. */
export function checkSpokenMarkup(scene, p, warnings) {
  const spoken = [[`${p}.narration`, scene.narration], ...sceneSteps(scene).map((step, j) => [`${p}.steps[${j}].say`, step?.say])];
  for (const [at, text] of spoken) {
    if (typeof text === 'string' && hasMarkup(text)) warnings.push(`${at}: markup in spoken text is read as plain words and shown plain in the subtitles; remove it, and style the text on screen instead`);
  }
  if (!Array.isArray(scene.steps)) return;
  scene.steps.forEach((step, j) => {
    if (typeof step?.note === 'string' && hasMarkup(step.note)) warnings.push(`${p}.steps[${j}].note: a pen note is handwritten, so its markup is dropped and the words drawn plain; remove the markup`);
    (Array.isArray(step?.draw) ? step.draw : []).forEach((item, k) => {
      for (const field of ['note', 'write']) if (typeof item?.[field] === 'string' && hasMarkup(item[field])) warnings.push(`${p}.steps[${j}].draw[${k}].${field}: ink is handwritten, so its markup is dropped and the words drawn plain; remove the markup`);
    });
  });
}
