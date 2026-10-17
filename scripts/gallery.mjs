#!/usr/bin/env node
// Renders the stills in docs/gallery.md and writes it. Each worked example gets one still of the scene SCENE names, into
// docs/assets/examples/<name>.png; each scene type gets one still of its demo, examples/primitives/<type>/, into
// docs/assets/scenes/<type>.png. Descriptions come from the storyboards' subtitles and the scene references.
// `node scripts/gallery.mjs [name...]` re-renders only those examples or types; the gallery always lists every one.
// Each run of mr-cast gets a temporary config directory; XDG_CACHE_HOME passes through, so a caller can lend it caches.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, copyExample, findExamples } from './lib/examples.mjs';

const SCENES = path.join(ROOT, 'skill/mr-cast/references/scenes');
const VIDEO = (name) => `https://github.com/phanshiyu/mr-cast/releases/latest/download/${name}.mp4`;
// The scene each worked example's still shows, at the end of its last step.
const SCENE = {
  'algorithms-quicksort': 1,
  'algorithms-binary-search': 2,
  'algorithms-merge-sort': 3,
  'algorithms-dijkstra': 3,
  'algorithms-hash-table': 2,
  'architecture-youtube': 1,
  'architecture-react': 9,
  'architecture-oauth': 5,
  'architecture-h3': 6,
  'explain-bitcoin': 7,
  'explain-gpt': 7,
};

const all = findExamples();
const storyboard = (e) => JSON.parse(fs.readFileSync(path.join(e.dir, 'storyboard.json'), 'utf8'));
const worked = all.filter((e) => e.name in SCENE);
const demos = all.filter((e) => e.rel.startsWith(`primitives${path.sep}`)).map((e) => ({ ...e, type: path.basename(e.rel) }));
const stills = [
  ...worked.map((e) => ({ example: e, key: e.name, scene: SCENE[e.name], out: `assets/examples/${e.name}.png` })),
  ...demos.map((e) => ({ example: e, key: e.type, scene: storyboard(e).scenes.findIndex((s) => s.type === e.type), out: `assets/scenes/${e.type}.png` })),
];
const wanted = process.argv.slice(2);
for (const w of wanted) if (!stills.some((s) => s.key === w)) throw new Error(`no example or demo "${w}"; they are ${stills.map((s) => s.key).join(', ')}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-gallery-'));
try {
  for (const { example, key, scene, out } of stills.filter((s) => !wanted.length || wanted.includes(s.key))) {
    if (scene < 0) throw new Error(`examples/${example.rel} has no ${key} scene`);
    const dir = path.join(work, example.name);
    copyExample(example, dir);
    const res = spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'still', String(scene), '--dir', dir, '--out', path.join(dir, 'stills'), '--no-voice', ...example.flags], {
      encoding: 'utf8',
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(work, 'config'), CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
    });
    if (res.status !== 0) throw new Error(`still for ${key} failed:\n${res.stdout}\n${res.stderr}`);
    const png = res.stdout.trim().split('\n').at(-1);
    const file = path.join(ROOT, 'docs', out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(png).resize({ width: 1280 }).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(file);
    console.log(`${key}: docs/${out}, ${Math.round(fs.statSync(file).size / 1024)} KB`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

/** The scene reference's one-line description: the first paragraph under its heading. */
const describe = (type) => fs.readFileSync(path.join(SCENES, `${type}.md`), 'utf8').split('\n\n')[1].trim();
const storyboardLink = (e) => `[examples/${e.rel}/storyboard.json](../examples/${e.rel}/storyboard.json)`;
const videoLink = (e) => `[${e.name}.mp4](${VIDEO(e.name)})`;

const examples = worked.map((e) => {
  const { title, subtitle, scenes } = storyboard(e);
  const scene = scenes[SCENE[e.name]];
  return [
    `### ${title}`,
    '',
    `${subtitle}.`,
    '',
    `![${title}: the "${scene.chapter ?? scene.title}" ${scene.type} scene, at the end of its last step](assets/examples/${e.name}.png)`,
    '',
    `Storyboard: ${storyboardLink(e)}. Video: ${videoLink(e)}.`,
  ].join('\n');
});
const types = demos.map((e) =>
  [
    `### ${e.type}`,
    '',
    describe(e.type),
    '',
    `![The ${e.type} demo's ${e.type} scene, at the end of its last step](assets/scenes/${e.type}.png)`,
    '',
    `Storyboard: ${storyboardLink(e)}. Video: ${videoLink(e)}. Reference: [${e.type}.md](../skill/mr-cast/references/scenes/${e.type}.md).`,
  ].join('\n'),
);
const gallery = `# Gallery

<!-- Written by scripts/gallery.mjs from examples/ and skill/mr-cast/references/scenes/; edit those and rerun it. -->

Worked examples, then one short demo per scene type. Each still is one scene at the end of its last step, from \`mr-cast still\`. Each video is the whole storyboard, rendered by CI and attached to the latest release.

## Examples

${examples.join('\n\n')}

## Scene types

${types.join('\n\n')}
`;
fs.writeFileSync(path.join(ROOT, 'docs/gallery.md'), gallery);
console.log('docs/gallery.md');
