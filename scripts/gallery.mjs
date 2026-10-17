#!/usr/bin/env node
// Renders one still per scene type from its demo, examples/primitives/<type>/storyboard.json, into
// docs/assets/scenes/<type>.png, and writes docs/gallery.md from the stills and the scene references.
// `node scripts/gallery.mjs [type...]` re-renders only those types; the gallery always lists every demo.
// Each run of mr-cast gets a temporary config directory; XDG_CACHE_HOME passes through, so a caller can lend it caches.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS = path.join(ROOT, 'examples/primitives');
const STILLS = path.join(ROOT, 'docs/assets/scenes');
const SCENES = path.join(ROOT, 'skill/mr-cast/references/scenes');
const VIDEO = (name) => `https://github.com/phanshiyu/mr-cast/releases/latest/download/${name}.mp4`;

const types = fs.readdirSync(DEMOS).filter((t) => fs.existsSync(path.join(DEMOS, t, 'storyboard.json'))).sort();
const wanted = process.argv.slice(2);
for (const t of wanted) if (!types.includes(t)) throw new Error(`no demo for "${t}"; demos are ${types.join(', ')}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-gallery-'));
fs.mkdirSync(STILLS, { recursive: true });
try {
  for (const type of wanted.length ? wanted : types) {
    const source = path.join(DEMOS, type);
    const dir = path.join(work, type);
    fs.mkdirSync(dir);
    for (const f of fs.readdirSync(source).filter((f) => f.endsWith('.json'))) fs.copyFileSync(path.join(source, f), path.join(dir, f));
    const scenes = JSON.parse(fs.readFileSync(path.join(source, 'storyboard.json'), 'utf8')).scenes;
    const index = scenes.findIndex((s) => s.type === type);
    if (index < 0) throw new Error(`examples/primitives/${type} has no ${type} scene`);
    const meta = fs.existsSync(path.join(source, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(source, 'meta.json'), 'utf8')) : {};
    const flags = meta.audience ? ['--audience', meta.audience] : [];
    const res = spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'still', String(index), '--dir', dir, '--out', path.join(dir, 'stills'), '--no-voice', ...flags], {
      encoding: 'utf8',
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(work, 'config'), CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
    });
    if (res.status !== 0) throw new Error(`still for ${type} failed:\n${res.stdout}\n${res.stderr}`);
    const png = res.stdout.trim().split('\n').at(-1);
    const out = path.join(STILLS, `${type}.png`);
    await sharp(png).resize({ width: 1280 }).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(out);
    console.log(`${type}: docs/assets/scenes/${type}.png, ${Math.round(fs.statSync(out).size / 1024)} KB`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

/** The scene reference's one-line description: the first paragraph under its heading. */
const describe = (type) => fs.readFileSync(path.join(SCENES, `${type}.md`), 'utf8').split('\n\n')[1].trim();

const sections = types.map((type) =>
  [
    `## ${type}`,
    '',
    describe(type),
    '',
    `![The ${type} demo's ${type} scene, at the end of its last step](assets/scenes/${type}.png)`,
    '',
    `Storyboard: [examples/primitives/${type}/storyboard.json](../examples/primitives/${type}/storyboard.json). Video: [primitives-${type}.mp4](${VIDEO(`primitives-${type}`)}). Reference: [${type}.md](../skill/mr-cast/references/scenes/${type}.md).`,
  ].join('\n'),
);
const gallery = `# Scene gallery

<!-- Written by scripts/gallery.mjs from examples/primitives/ and skill/mr-cast/references/scenes/; edit those and rerun it. -->

One short demo per scene type. Each still is the demo's ${'`<type>`'} scene at the end of its last step, from \`mr-cast still\`. Each video is the whole demo, rendered by CI and attached to the latest release.

${sections.join('\n\n')}
`;
fs.writeFileSync(path.join(ROOT, 'docs/gallery.md'), gallery);
console.log('docs/gallery.md');
