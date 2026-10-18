// Writes the reviewer-facing packet.md: per scene, its chapter, type and every spoken line (the narration, then
// each step's words, as the voice says them). No diff, no file contents.
// Usage: node packet.mjs <storyboard.json> <out.md>
import fs from 'node:fs';
import { spokenTexts } from '../shared/timing.mjs';

const [storyboardPath, outPath] = process.argv.slice(2);
const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));

const lines = [`# ${sb.title ?? 'Walkthrough'}`, ''];
if (sb.subtitle) lines.push(sb.subtitle, '');
lines.push(
  `${sb.scenes.length} scenes. Each scene has a still image (scene-NN.png) of how it ends, its narration, and the words of each step, which the voice says in order while the scene builds up.`,
  '',
);
sb.scenes.forEach((scene, i) => {
  const n = String(i + 1).padStart(2, '0');
  const [narration, ...steps] = spokenTexts(scene);
  lines.push(
    `## Scene ${n}`,
    '',
    `- Image: scene-${n}.png`,
    `- Chapter: ${scene.chapter ?? '(untitled)'}`,
    `- Type: ${scene.type}`,
    `- Narration: ${narration}`,
  );
  steps.forEach((say, k) => lines.push(`- Step ${k + 1}: ${say}`));
  lines.push('');
});
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
