#!/usr/bin/env node
// Installs the mr-video skill and the /mr-cast command into ~/.claude, pointing at this checkout.
// The storyboard schema is copied from src/types.ts so the skill cannot drift from the player.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
const start = types.indexOf('export type Risk');
const end = types.indexOf('// ─── Composition props');
if (start < 0 || end < 0) throw new Error('src/types.ts: storyboard section markers not found');
const storyboardTypes = types
  .slice(start, end)
  .replace(/^export /gm, '')
  .trim();

const skill = fs
  .readFileSync(path.join(root, 'skill/SKILL.md'), 'utf8')
  .replaceAll('{{MR_CAST}}', root)
  .replace('{{STORYBOARD_TYPES}}', storyboardTypes);

const command = `---
description: Make an animated video walkthrough of the current branch's diff (mr-cast)
argument-hint: [base-branch | --working]
---

Follow the mr-video skill at ${path.join(claudeDir, 'skills/mr-video/SKILL.md')}. Read it in full first.

Arguments for \`mr-cast extract\`: $ARGUMENTS
`;

const targets = [
  [path.join(claudeDir, 'skills/mr-video/SKILL.md'), skill],
  [path.join(claudeDir, 'commands/mr-cast.md'), command],
];
for (const [file, content] of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`wrote ${file}`);
}
