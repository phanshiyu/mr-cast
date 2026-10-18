// The examples under examples/: each directory that holds a storyboard.json, its flat name, and the flags it runs with.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXAMPLES = path.join(ROOT, 'examples');

/** Every example, sorted by path. `name` is the path under examples/ with slashes as dashes, as release assets are flat. */
export function findExamples(rel = '') {
  return fs.readdirSync(path.join(EXAMPLES, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const sub = path.join(rel, e.name);
    const dir = path.join(EXAMPLES, sub);
    const here = fs.existsSync(path.join(dir, 'storyboard.json')) ? [{ rel: sub, dir, name: sub.split(path.sep).join('-'), flags: flagsFor(dir) }] : [];
    return [...here, ...findExamples(sub)];
  });
}

/** The settings flags an example runs with: the audience its meta.json records, or none for the plain video. */
function flagsFor(dir) {
  const file = path.join(dir, 'meta.json');
  const meta = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return meta.audience ? ['--audience', meta.audience] : [];
}

/** Copies an example's JSON files and pictures into `dir`, so a command can run on the copy and never write into examples/. */
export function copyExample(example, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(example.dir).filter((f) => /\.(?:json|png|jpe?g|webp|gif)$/i.test(f))) fs.copyFileSync(path.join(example.dir, file), path.join(dir, file));
}
