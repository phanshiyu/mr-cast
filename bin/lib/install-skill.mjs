// Installs the mr-cast-review and mr-cast-explain skills and their render commands into the Claude
// config dir, pointing at this install, and removes what mr-cast 0.5 and earlier installed under older
// names. The storyboard schema is copied from src/types.ts so the skills cannot drift from the player.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** What earlier versions installed, relative to the Claude config dir. */
const LEGACY = ['skills/mr-video', 'skills/explain-in-animation', 'commands/mr-cast.md', 'commands/mr-render.md', 'commands/explain-in-animation.md'];
/** Text every legacy file contained: the CLI path (skills) or the legacy skill path (commands). */
const LEGACY_MARKERS = ['/bin/mr-cast', '/skills/mr-video/SKILL.md', '/skills/explain-in-animation/SKILL.md'];

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

const fromMrCast = (file) => {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return LEGACY_MARKERS.some((m) => text.includes(m));
  } catch {
    return false;
  }
};

/**
 * Deletes each legacy file or skill directory whose content shows mr-cast wrote it. A skill directory
 * holding anything besides SKILL.md keeps the extra files. Returns { removed, kept } paths.
 */
function removeLegacy(claudeDir) {
  const removed = [];
  const kept = [];
  for (const rel of LEGACY) {
    const target = path.join(claudeDir, rel);
    if (!fs.existsSync(target)) continue;
    const isDir = fs.statSync(target).isDirectory();
    const file = isDir ? path.join(target, 'SKILL.md') : target;
    if (!fromMrCast(file)) {
      kept.push(target);
      continue;
    }
    fs.rmSync(file);
    removed.push(file);
    if (isDir && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
  }
  return { removed, kept };
}

export function installSkill(root, claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')) {
  const schema = storyboardTypes(root);
  const fill = (template) => fs
    .readFileSync(template, 'utf8')
    .replaceAll('{{MR_CAST}}', () => root)
    .replace('{{STORYBOARD_TYPES}}', () => schema);

  const review = path.join(claudeDir, 'skills/mr-cast-review/SKILL.md');
  const explain = path.join(claudeDir, 'skills/mr-cast-explain/SKILL.md');
  const rendered = 'The MP4 is named after the walkthrough\'s title. Give the user the path `render` prints.';

  const targets = [
    // MR_CAST_SKILL_TEMPLATE swaps in a variant of the review skill (quality/variant.sh).
    [review, fill(process.env.MR_CAST_SKILL_TEMPLATE ?? path.join(root, 'skill/mr-cast-review/SKILL.md'))],
    [explain, fill(path.join(root, 'skill/mr-cast-explain/SKILL.md'))],
    [
      path.join(claudeDir, 'commands/mr-cast-render.md'),
      command({
        description: "Render an MP4 walkthrough video of the current branch's diff (mr-cast)",
        argumentHint: '[base-branch | --working]',
        skillPath: review,
        body: `In step 4, run \`render\` instead of \`play\`. ${rendered}\n\nArguments for \`mr-cast extract\`: $ARGUMENTS`,
      }),
    ],
    [
      path.join(claudeDir, 'commands/mr-cast-explain-render.md'),
      command({
        description: 'Render what you just explained as an MP4 walkthrough with diagrams and real code (mr-cast)',
        argumentHint: '[what to focus on]',
        skillPath: explain,
        body: `Animate the explanation you gave most recently in this conversation. In step 5, run \`explain render\` instead of \`explain play\`. ${rendered}\n\nArguments: $ARGUMENTS`,
      }),
    ],
  ];
  const legacy = removeLegacy(claudeDir);
  for (const [file, content] of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { written: targets.map(([file]) => file), ...legacy };
}
