// Checks that every text a scene draws fits where the scene draws it, and that its markup is well formed.
// It runs the player's own layout code (src/fit/report.ts, bundled here with esbuild), so `validate` and
// the rendered video can never disagree about which text fits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasMarkup } from '../../shared/markup.mjs';
import { wordCount } from '../../shared/timing.mjs';
import { sceneSteps } from '../../shared/steps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'src/fit/report.ts');

/** Past this share of styled characters, emphasis stops pointing at anything. Short labels may be styled whole. */
const STYLED_SHARE_MAX = 1 / 3;
const STYLED_MIN_WORDS = 3;

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
 * Text that does not fit at its slot's smallest readable size, markup errors, and text styled almost
 * whole. `storyboard` is normalized and otherwise valid.
 */
export async function checkFit(storyboard, hunks, errors, warnings) {
  if (!fs.existsSync(ENTRY)) return;
  let reports;
  try {
    const { fitReport } = await reportModule();
    reports = fitReport(storyboard, hunks);
  } catch (err) {
    warnings.push(`could not check that the text fits (${err.message}); run \`mr-cast still\` and look for text running past its box`);
    return;
  }
  for (const { scene: i, fits } of reports) {
    const scene = storyboard.scenes[i];
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
      if (fit.text && fit.styled > STYLED_SHARE_MAX && wordCount(fit.text) >= STYLED_MIN_WORDS && !seen.has(`${fit.path}\nstyled`)) {
        seen.add(`${fit.path}\nstyled`);
        warnings.push(`${at}: most of ${quote(fit.text)} is styled; mark only the word or value the sentence is about, so it stands out`);
      }
    }
  }
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
  });
}
