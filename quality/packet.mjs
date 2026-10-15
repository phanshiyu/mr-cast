// Writes the reviewer-facing packet.md: per scene, its chapter, type and narration. No diff, no file contents.
// Usage: node packet.mjs <storyboard.json> <out.md>
import fs from 'node:fs';

const [storyboardPath, outPath] = process.argv.slice(2);
const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));

const lines = [`# ${sb.title ?? 'Walkthrough'}`, ''];
if (sb.subtitle) lines.push(sb.subtitle, '');
lines.push(`${sb.scenes.length} scenes. Each scene has a still image (scene-NN.png) and a narration.`, '');
sb.scenes.forEach((scene, i) => {
  const n = String(i + 1).padStart(2, '0');
  lines.push(`## Scene ${n}`, '', `- Image: scene-${n}.png`, `- Chapter: ${scene.chapter ?? '(untitled)'}`, `- Type: ${scene.type}`, `- Narration: ${scene.narration}`, '');
});
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
