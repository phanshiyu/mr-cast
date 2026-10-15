// Installs the mr-video and explain-in-animation skills and their slash commands into the Claude
// config dir, pointing at this install. The storyboard schema is copied from src/types.ts so the
// skills cannot drift from the player.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function storyboardTypes(root) {
  const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
  const start = types.search(/^export type Risk =/m);
  const end = types.indexOf('// ─── ', start);
  if (start < 0 || end < 0) throw new Error('src/types.ts: storyboard section markers not found');
  return types.slice(start, end).replace(/^export /gm, '').trim();
}

const command = ({ description, argumentHint, skillPath, body }) => `---
description: ${description}
argument-hint: ${argumentHint}
---

Follow the skill at ${skillPath}. Read it in full first. ${body}
`;

export function installSkill(root, claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')) {
  const schema = storyboardTypes(root);
  const fill = (template) => fs
    .readFileSync(template, 'utf8')
    .replaceAll('{{MR_CAST}}', () => root)
    .replace('{{STORYBOARD_TYPES}}', () => schema);

  const mrVideo = path.join(claudeDir, 'skills/mr-video/SKILL.md');
  const explain = path.join(claudeDir, 'skills/explain-in-animation/SKILL.md');
  const diffCommand = (description, outcome) => command({
    description,
    argumentHint: '[base-branch | --working]',
    skillPath: mrVideo,
    body: `${outcome}\n\nArguments for \`mr-cast extract\`: $ARGUMENTS`,
  });

  const targets = [
    // MR_CAST_SKILL_TEMPLATE swaps in a variant of the mr-video skill (quality/variant.sh).
    [mrVideo, fill(process.env.MR_CAST_SKILL_TEMPLATE ?? path.join(root, 'skill/mr-video/SKILL.md'))],
    [explain, fill(path.join(root, 'skill/explain-in-animation/SKILL.md'))],
    [
      path.join(claudeDir, 'commands/mr-cast.md'),
      diffCommand("Open an animated walkthrough of the current branch's diff in the browser (mr-cast)", 'In step 3, start the player.'),
    ],
    [
      path.join(claudeDir, 'commands/mr-render.md'),
      diffCommand("Render an MP4 walkthrough video of the current branch's diff (mr-cast)", 'In step 3, run `render` instead of `play`, then give the user the path of the MP4 it prints.'),
    ],
    [
      path.join(claudeDir, 'commands/explain-in-animation.md'),
      command({
        description: 'Turn what you just explained into an animated walkthrough with diagrams and real code (mr-cast)',
        argumentHint: '[mp4 | render]',
        skillPath: explain,
        body: 'Animate the explanation you gave most recently in this conversation. In step 4, start the player, or when the arguments below say "mp4" or "render", run `explain render` instead and give the user the path of the MP4 it prints.\n\nArguments: $ARGUMENTS',
      }),
    ],
  ];
  for (const [file, content] of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return targets.map(([file]) => file);
}
