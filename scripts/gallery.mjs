#!/usr/bin/env node
// Renders the stills in docs/gallery.md and writes it. Each worked example gets one still of the scene SCENE names, into
// docs/assets/examples/<name>.png; each scene type gets one still of its demo, examples/primitives/<type>/, into
// docs/assets/scenes/<type>.png. Descriptions come from the storyboards' subtitles and the scene references.
// `node scripts/gallery.mjs [name...]` re-renders only those examples or types; the gallery always lists every one.
// Each run of mr-cast gets temporary config and state directories; XDG_CACHE_HOME passes through, so a caller can lend it caches.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, copyExample, findExamples } from './lib/examples.mjs';

const SCENES = path.join(ROOT, 'skill/mr-cast/references/scenes');
const REFERENCES = path.join(ROOT, 'skill/mr-cast/references');
// Demos of what a scene type can also do, each listed under its own name with its type's reference.
const VARIANTS = { 'chart-motion': 'chart', 'code-typing': 'code' };
const baseType = (type) => VARIANTS[type] ?? type;
/** A demo's reference: its scene type's file, or for a tool on every scene, such as ink, the tool's own file. */
const reference = (type) => (fs.existsSync(path.join(SCENES, `${baseType(type)}.md`)) ? `scenes/${baseType(type)}.md` : `${type}.md`);
const isScene = (type) => reference(type).startsWith('scenes/');
const VIDEO = (name) => `https://github.com/phanshiyu/mr-cast/releases/latest/download/${name}.mp4`;
// The scene each worked example's still shows, at the end of its last step.
const SCENE = {
  'algorithms-quicksort': 1,
  'algorithms-binary-search': 2,
  'algorithms-merge-sort': 3,
  'algorithms-dijkstra': 3,
  'algorithms-hash-table': 2,
  'architecture-youtube': 2,
  'architecture-react': 9,
  'architecture-oauth': 5,
  'architecture-h3': 6,
  'explain-bitcoin': 8,
  'explain-gpt': 7,
  'math-fourier': 2,
  'money-compound-interest': 4,
  'science-gps-relativity': 4,
  'science-mrna-vaccine': 2,
  'tech-docker-100s': 2,
  'hardware-cpu-adder': 2,
  'geography-49th-parallel': 2,
  'product-raspberry-pi': 1,
  'cooking-bread': 5,
  'language-ser-estar': 3,
};

const all = findExamples();
const storyboard = (e) => JSON.parse(fs.readFileSync(path.join(e.dir, 'storyboard.json'), 'utf8'));
const worked = all.filter((e) => e.name in SCENE);
// A demo named for a scene type or a tool, such as ink, shows it; one named otherwise, such as tests-map, is a pattern
// its type's reference points at.
const demos = all
  .filter((e) => e.rel.startsWith(`primitives${path.sep}`) && fs.existsSync(path.join(REFERENCES, reference(path.basename(e.rel)))))
  .map((e) => ({ ...e, type: path.basename(e.rel) }));
const stills = [
  ...worked.map((e) => ({ example: e, key: e.name, scene: SCENE[e.name], out: `assets/examples/${e.name}.png` })),
  ...demos.map((e) => ({ example: e, key: e.type, scene: isScene(e.type) ? storyboard(e).scenes.findIndex((s) => s.type === baseType(e.type)) : 0, out: `assets/scenes/${e.type}.png` })),
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
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(work, 'config'), XDG_STATE_HOME: path.join(work, 'state'), CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
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

/** The scene reference's one-line description: the first paragraph under its heading; a variant's storyboard subtitle. */
const describe = (type) =>
  VARIANTS[type] ? `${storyboard(demos.find((e) => e.type === type)).subtitle}.` : fs.readFileSync(path.join(REFERENCES, reference(type)), 'utf8').split('\n\n')[1].trim();
const storyboardLink = (e) => `[examples/${e.rel}/storyboard.json](../examples/${e.rel}/storyboard.json)`;
const videoLink = (e) => `[${e.name}.mp4](${VIDEO(e.name)})`;

const exampleSection = (e) => {
  const { title, subtitle, scenes } = storyboard(e);
  const scene = scenes[SCENE[e.name]];
  return [
    `#### ${title}`,
    '',
    `${subtitle}.`,
    '',
    `![${title}: the "${scene.chapter ?? scene.title}" ${scene.type} scene, at the end of its last step](assets/examples/${e.name}.png)`,
    '',
    `Storyboard: ${storyboardLink(e)}. Video: ${videoLink(e)}.`,
  ].join('\n');
};
// Grouped by the directory under examples/ each one sits in, its domain.
const domainOf = (e) => e.rel.split(path.sep)[0];
const examples = [...new Set(worked.map(domainOf))].map((d) =>
  [`### ${d[0].toUpperCase()}${d.slice(1)}`, ...worked.filter((e) => domainOf(e) === d).map(exampleSection)].join('\n\n'),
);
// Scene types that older storyboards still use, each drawn as a current one.
const ALIASES = { intent: 'text' };
const aliases = Object.entries(ALIASES).map(([type, as]) => ({
  type,
  text: [`### ${type}`, '', `An older scene type, drawn as a [${as}](#${as}) scene; see [${as}.md](../skill/mr-cast/references/scenes/${as}.md).`].join('\n'),
}));
const demoSection = (e) =>
  [
    `### ${e.type}`,
    '',
    describe(e.type),
    '',
    `![The ${e.type} demo's ${isScene(e.type) ? baseType(e.type) : storyboard(e).scenes[0].type} scene, at the end of its last step](assets/scenes/${e.type}.png)`,
    '',
    `Storyboard: ${storyboardLink(e)}. Video: ${videoLink(e)}. Reference: [${baseType(e.type)}.md](../skill/mr-cast/references/${reference(e.type)}).`,
  ].join('\n');
const types = [...demos.filter((e) => isScene(e.type)).map((e) => ({ type: e.type, text: demoSection(e) })), ...aliases]
  .sort((a, b) => a.type.localeCompare(b.type))
  .map((t) => t.text);
const tools = demos.filter((e) => !isScene(e.type)).map(demoSection);
const gallery = `# Gallery

<!-- Written by scripts/gallery.mjs from examples/ and skill/mr-cast/references/scenes/; edit those and rerun it. -->

Worked examples grouped by subject, then one short demo per scene type, then a demo of the ink any stepped scene can draw. Each still is one scene at the end of its last step, from \`mr-cast still\`. Each video is the whole storyboard, rendered by CI and attached to the latest release.

## Examples

${examples.join('\n\n')}

## Scene types

${types.join('\n\n')}

## On every scene

${tools.join('\n\n')}
`;
fs.writeFileSync(path.join(ROOT, 'docs/gallery.md'), gallery);
console.log('docs/gallery.md');
