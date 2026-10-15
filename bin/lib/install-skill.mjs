// Installs the mr-video skill and the /mr-cast command into the Claude config dir, pointing at this install.
// The storyboard schema is copied from src/types.ts so the skill cannot drift from the player.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function installSkill(root, claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')) {
  const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
  const start = types.search(/^export type Risk =/m);
  const end = types.indexOf('// ─── ', start);
  if (start < 0 || end < 0) throw new Error('src/types.ts: storyboard section markers not found');
  const storyboardTypes = types
    .slice(start, end)
    .replace(/^export /gm, '')
    .trim();

  const skill = fs
    .readFileSync(path.join(root, 'skill/SKILL.md'), 'utf8')
    .replaceAll('{{MR_CAST}}', () => root)
    .replace('{{STORYBOARD_TYPES}}', () => storyboardTypes);

  const skillPath = path.join(claudeDir, 'skills/mr-video/SKILL.md');
  const command = (description, outcome) => `---
description: ${description}
argument-hint: [base-branch | --working]
---

Follow the mr-video skill at ${skillPath}. Read it in full first. ${outcome}

Arguments for \`mr-cast extract\`: $ARGUMENTS
`;

  const targets = [
    [skillPath, skill],
    [
      path.join(claudeDir, 'commands/mr-cast.md'),
      command("Open an animated walkthrough of the current branch's diff in the browser (mr-cast)", 'In step 3, start the player.'),
    ],
    [
      path.join(claudeDir, 'commands/mr-render.md'),
      command("Render an MP4 walkthrough video of the current branch's diff (mr-cast)", 'In step 3, run `render` instead of `play`, then give the user the path of the MP4 it prints.'),
    ],
  ];
  for (const [file, content] of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return targets.map(([file]) => file);
}
