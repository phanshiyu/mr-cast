import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-install-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'never-used');
const { installSkill, refreshSkills, skillsInstalledFrom, uninstallSkill } = await import('../bin/lib/install-skill.mjs');

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const EXPECTED = [
  'skills/mr-cast/SKILL.md',
  'skills/mr-cast/references/branch.md',
  'skills/mr-cast/references/explanation.md',
  'skills/mr-cast/references/highlight-audit.md',
  'skills/mr-cast/references/review.md',
  'skills/mr-cast-primitives/SKILL.md',
  ...['array', 'chart', 'code', 'compare', 'er', 'files', 'flow', 'graph', 'intent', 'layers', 'memory', 'mermaid', 'reading', 'review', 'sequence', 'state', 'table', 'terminal', 'tests', 'timeline'].map((t) => `skills/mr-cast-primitives/primitives/${t}.md`),
  'skills/mr-cast-prune/SKILL.md',
  'skills/mr-cast-upgrade/SKILL.md',
];
let n = 0;
const freshDir = () => fs.mkdtempSync(path.join(tmp, `claude-${n++}-`));
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.mr-cast-install.json'), 'utf8'));
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.split(path.sep).join('/')).sort();

before(() => assert.equal(fs.existsSync(process.env.CLAUDE_CONFIG_DIR), false));
after(() => {
  assert.equal(fs.existsSync(process.env.CLAUDE_CONFIG_DIR), false, 'the default config dir was never written');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('install writes the skills and a manifest listing exactly those files', () => {
  const dir = freshDir();
  const result = installSkill(root, dir);
  const manifest = manifestOf(dir);
  assert.deepEqual(manifest.files, EXPECTED);
  assert.equal(manifest.root, fs.realpathSync(root));
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  assert.deepEqual(filesUnder(dir), ['.mr-cast-install.json', ...EXPECTED].sort());
  assert.deepEqual(result.written, EXPECTED.map((f) => path.join(dir, f)));
  assert.deepEqual(result.removed, []);
});

test('installed skills point at this package and carry the storyboard schema', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const skill = fs.readFileSync(path.join(dir, 'skills/mr-cast/SKILL.md'), 'utf8');
  assert.equal(skill.includes('{{MR_CAST}}'), false);
  assert.equal(skill.includes('{{STORYBOARD_TYPES}}'), false);
  assert.equal(skill.includes('{{PLAN_VIEWS}}'), false);
  assert.ok(skill.includes('| `compare` | Before vs after | `compare` |'), 'the plan views table is filled from shared/views.mjs');
  assert.equal(skillsInstalledFrom(root, dir), true);
  assert.equal(skillsInstalledFrom(root, freshDir()), false);
});

test('the primitives index and its leaves are installed with the CLI path filled in, and the main skill points at it', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const index = fs.readFileSync(path.join(dir, 'skills/mr-cast-primitives/SKILL.md'), 'utf8');
  assert.match(index, /^---\nname: mr-cast-primitives\n[\s\S]*\nuser-invocable: false\n---\n/);
  const leaf = fs.readFileSync(path.join(dir, 'skills/mr-cast-primitives/primitives/array.md'), 'utf8');
  assert.equal(leaf.includes('{{MR_CAST}}'), false);
  assert.ok(leaf.includes(`${root}/bin/mr-cast validate`));
  const main = fs.readFileSync(path.join(dir, 'skills/mr-cast/SKILL.md'), 'utf8');
  assert.ok(main.includes('Unsure which primitive? Read the [mr-cast-primitives index](../mr-cast-primitives/SKILL.md)'));
  assert.ok(fs.existsSync(path.join(dir, 'skills/mr-cast', '../mr-cast-primitives/SKILL.md')), 'the link from the main skill resolves');
});

test('a dotfile, an editor backup or a merge leftover in a skill folder is not installed', () => {
  const copy = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const f of ['package.json', 'src', 'skill']) fs.cpSync(path.join(root, f), path.join(copy, f), { recursive: true });
  fs.writeFileSync(path.join(copy, 'skill/mr-cast-primitives/.DS_Store'), 'x');
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/SKILL.md~'), 'x');
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/references/branch.md.orig'), 'x');
  const dir = freshDir();
  installSkill(copy, dir);
  assert.deepEqual(manifestOf(dir).files, EXPECTED);
});

test('reinstall removes a file the manifest recorded that this version no longer writes', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const stale = path.join(dir, 'skills/mr-cast-old/SKILL.md');
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, 'run /bin/mr-cast');
  const manifest = manifestOf(dir);
  fs.writeFileSync(path.join(dir, '.mr-cast-install.json'), JSON.stringify({ ...manifest, files: [...manifest.files, 'skills/mr-cast-old/SKILL.md'] }));
  const result = installSkill(root, dir);
  assert.deepEqual(result.removed, [stale]);
  assert.equal(fs.existsSync(path.dirname(stale)), false);
  assert.deepEqual(manifestOf(dir).files, EXPECTED);
});

test('the installed prune skill deletes only through mr-cast prune', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const skill = fs.readFileSync(path.join(dir, 'skills/mr-cast-prune/SKILL.md'), 'utf8');
  const RULE = 'Never delete with `rm`, `find -delete`, `unlink` or any other command or tool';
  assert.ok(skill.includes(RULE), 'states the rule');
  const rest = skill.replace(RULE, '');
  for (const word of [/\brm[ -]/, /-delete\b/, /\bunlink\b/, /rmSync|rmdir|trash/]) assert.doesNotMatch(rest, word);
});

test('a recorded file whose content mr-cast did not write is kept', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const theirs = path.join(dir, 'skills/mr-cast-prune/SKILL.md');
  fs.writeFileSync(theirs, 'my own skill');
  const result = uninstallSkill(dir);
  assert.deepEqual(result.kept, [theirs]);
  assert.equal(fs.readFileSync(theirs, 'utf8'), 'my own skill');
});

test('uninstall removes every recorded file, emptied skill dirs and the manifest', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const result = uninstallSkill(dir);
  assert.deepEqual(result.removed.sort(), [...EXPECTED.map((f) => path.join(dir, f)), path.join(dir, '.mr-cast-install.json')].sort());
  assert.deepEqual(result.kept, []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'skills')), []);
});

test('refresh reinstalls only when this package installed another version', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const { version } = manifestOf(dir);
  assert.equal(refreshSkills(root, version, dir), false);
  assert.equal(refreshSkills(root, '0.0.0-next', dir), true);
  assert.equal(refreshSkills(root, '0.0.0-next', freshDir()), false);
});
