import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const skillDir = path.join(root, 'skill/mr-cast');
const leafDir = path.join(skillDir, 'references/scenes');
const index = fs.readFileSync(path.join(skillDir, 'references/adapt.md'), 'utf8');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const demoHunks = JSON.parse(fs.readFileSync(path.join(root, 'examples/demo/hunks.json'), 'utf8'));
// Every example runs against one diff: the new rate limiter, src/api/rate-limit.ts, 20 added lines.
const hunks = { h2: demoHunks.h2 };

/** The scene types the player draws: each member of the Scene union in src/types.ts, by its `type` literal. */
function sceneTypes() {
  const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
  const union = types.match(/^export type Scene = ([^;]+);/m)[1].split('|').map((s) => s.trim());
  return union.map((name) => types.match(new RegExp(`^export interface ${name} extends SceneBase \\{\\n\\s+type: '(\\w+)';`, 'm'))[1]).sort();
}

const leaves = () => fs.readdirSync(leafDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
const read = (type) => fs.readFileSync(path.join(leafDir, `${type}.md`), 'utf8');

/** The one ```json block under the leaf's "## Example" heading. */
function example(type) {
  const section = read(type).split(/^## /m).find((s) => s.startsWith('Example'));
  assert.ok(section, `${type}.md has no "## Example" section`);
  const blocks = [...section.matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(blocks.length, 1, `${type}.md: the Example section holds exactly one json block`);
  return JSON.parse(blocks[0][1]);
}

const intent = { type: 'intent', narration: 'Each visitor now gets twenty requests a minute.', summary: 'Limit each visitor to 20 requests a minute', risk: 'low', bullets: ['Visitors behind one proxy share one count'] };

/** The example as a storyboard: a whole one as written, or a lone scene after an intent. */
const storyboard = (ex) => (ex.scenes ? ex : { title: 'Rate limiting', scenes: ex.type === 'intent' ? [ex] : [intent, ex] });

// A pre-read's reading order is the one place its example needs the pre-read audience.
const OPTIONS = { reading: { audience: 'preread' } };

test('every scene type in src/types.ts has a leaf, and every leaf is a scene type', () => {
  assert.deepEqual(leaves(), sceneTypes());
});

test('SKILL.md links every scene file, and the picker in adapt.md links every scene', () => {
  for (const type of sceneTypes()) {
    assert.ok(skill.includes(`](references/scenes/${type}.md)`), `SKILL.md does not link references/scenes/${type}.md`);
    assert.ok(index.includes(`](scenes/${type}.md)`), `adapt.md does not link scenes/${type}.md`);
  }
});

test('every leaf has the same sections and names validate by the CLI path the installer fills', () => {
  for (const type of leaves()) {
    const headings = read(type).match(/^## .+$/gm);
    assert.deepEqual(headings, ['## Lowers load when', '## Adds load when', '## Load mistakes', '## Example', '## Schema and validate notes'], `${type}.md`);
    assert.ok(read(type).includes('{{MR_CAST}}/bin/mr-cast validate'), `${type}.md must name {{MR_CAST}}/bin/mr-cast validate, which also marks the file as mr-cast's for uninstall`);
  }
});

for (const type of sceneTypes()) {
  test(`the ${type} example validates with no errors and no warnings on its scenes`, async () => {
    const sb = storyboard(example(type));
    assert.ok(sb.scenes.some((s) => s.type === type), `the ${type} example has no ${type} scene`);
    const { errors, warnings } = await validateStoryboard(sb, hunks, { mode: 'diff', ...OPTIONS[type] });
    // Warnings about the whole video, such as a hunk no scene shows, are not about the example.
    assert.deepEqual({ errors, warnings: warnings.filter((w) => /^(scenes|findings)\b/.test(w)) }, { errors: [], warnings: [] });
  });
}
