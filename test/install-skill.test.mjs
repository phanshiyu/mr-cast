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
const SCENES = ['array', 'chart', 'code', 'compare', 'er', 'files', 'flow', 'graph', 'layers', 'memory', 'mermaid', 'reading', 'review', 'sequence', 'state', 'svg', 'table', 'terminal', 'tests', 'text', 'timeline'];
const EXPECTED = [
  'skills/mr-cast/SKILL.md',
  'skills/mr-cast/references/plan.md',
  ...SCENES.map((t) => `skills/mr-cast/references/scenes/${t}.md`),
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

test('installed skills point at this package, with the plan views filled in', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const plan = fs.readFileSync(path.join(dir, 'skills/mr-cast/references/plan.md'), 'utf8');
  assert.ok(plan.includes('| `compare` | Before vs after | `compare` |'), 'the plan views table is filled from shared/views.mjs');
  for (const file of EXPECTED) assert.equal(/\{\{[A-Z_]+\}\}/.test(fs.readFileSync(path.join(dir, file), 'utf8')), false, `${file} has an unfilled placeholder`);
  assert.equal(skillsInstalledFrom(root, dir), true);
  assert.equal(skillsInstalledFrom(root, freshDir()), false);
});

// Claude Code keeps the first 5,000 tokens of a skill after compaction. The skill holds only the tools (ADR 0019),
// so it stays well under that: at about 4 characters a token, under 3,000 tokens and 200 lines.
test('the installed mr-cast SKILL.md stays under 200 lines and about 3,000 tokens', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const skill = fs.readFileSync(path.join(dir, 'skills/mr-cast/SKILL.md'), 'utf8');
  const lines = skill.split('\n').length;
  const tokens = Math.round(skill.replaceAll(root, '').length / 4);
  assert.ok(lines < 200, `${lines} lines`);
  assert.ok(tokens <= 3000, `about ${tokens} tokens; move detail into a reference`);
});

test('SKILL.md links every reference and every link resolves', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const skillDir = path.join(dir, 'skills/mr-cast');
  const links = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)].map((m) => path.resolve(path.dirname(file), m[1]));
  const fromSkill = new Set(links(path.join(skillDir, 'SKILL.md')));
  const refs = EXPECTED.filter((f) => f.startsWith('skills/mr-cast/references/')).map((f) => path.join(dir, f));
  assert.deepEqual(refs.filter((f) => !fromSkill.has(f)).map((f) => path.relative(skillDir, f)), []);
  for (const file of [path.join(skillDir, 'SKILL.md'), ...refs]) {
    for (const target of links(file)) assert.ok(fs.existsSync(target), `${path.relative(skillDir, file)} links ${path.relative(skillDir, target)}, which does not exist`);
  }
});

test('the skill hook runs this install\'s mr-cast after a write', () => {
  const dir = freshDir();
  installSkill(root, dir);
  const front = fs.readFileSync(path.join(dir, 'skills/mr-cast/SKILL.md'), 'utf8').split('\n---\n')[0];
  assert.ok(front.includes(`hooks:\n  PostToolUse:\n    - matcher: "Write|Edit"\n      hooks:\n        - type: command\n          command: "'${root}/bin/mr-cast' hook"`));
});

test('a dotfile, an editor backup or a merge leftover in a skill folder is not installed', () => {
  const copy = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const f of ['package.json', 'src', 'skill']) fs.cpSync(path.join(root, f), path.join(copy, f), { recursive: true });
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/references/scenes/.DS_Store'), 'x');
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/SKILL.md~'), 'x');
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/references/plan.md.orig'), 'x');
  const dir = freshDir();
  installSkill(copy, dir);
  assert.deepEqual(manifestOf(dir).files, EXPECTED);
});

test('a template from before 0.24 gets the whole storyboard schema in place of {{STORYBOARD_TYPES}}', () => {
  const copy = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const f of ['package.json', 'src', 'skill']) fs.cpSync(path.join(root, f), path.join(copy, f), { recursive: true });
  const template = path.join(copy, 'skill/mr-cast/SKILL.md');
  fs.writeFileSync(template, `${fs.readFileSync(template, 'utf8')}\n## Schema\n\n\`\`\`ts\n{{STORYBOARD_TYPES}}\n\`\`\`\n`);
  const dir = freshDir();
  installSkill(copy, dir);
  const skill = fs.readFileSync(path.join(dir, 'skills/mr-cast/SKILL.md'), 'utf8');
  assert.equal(skill.includes('{{STORYBOARD_TYPES}}'), false);
  assert.ok(skill.includes('interface ArrayScene extends SceneBase {') && skill.includes('interface TopicPick {'));
});

test('a reference that names no CLI is marked on its first line, with no install path in it', () => {
  const copy = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const f of ['package.json', 'src', 'shared', 'skill']) fs.cpSync(path.join(root, f), path.join(copy, f), { recursive: true });
  fs.writeFileSync(path.join(copy, 'skill/mr-cast/references/plain.md'), '# Plain\n\nNo command here.\n');
  const dir = freshDir();
  installSkill(copy, dir);
  const file = path.join(dir, 'skills/mr-cast/references/plain.md');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text, '<!-- written by mr-cast install-skill -->\n# Plain\n\nNo command here.\n');
  assert.ok(uninstallSkill(dir).removed.includes(file));
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
