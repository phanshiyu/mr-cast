// The storyboard schema, read from the doc-commented declarations of src/types.ts, so the skill can print the
// types one scene needs instead of carrying the whole schema.

import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';

/**
 * The declarations of src/types.ts by name, in source order. Each holds its text, with its doc comment and without
 * `export`, the names of the other declarations it mentions, and whether it is in the storyboard section. A type
 * outside the section that one inside uses, such as plan.json's TopicPick, is printed with it.
 */
export function readSchema(root) {
  const source = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
  const start = source.search(/^export type Risk =/m);
  const end = source.indexOf('// ─── ', start);
  if (start < 0 || end < 0) throw new Error('src/types.ts: storyboard section markers not found');
  const lines = source.split('\n');
  const [first, last] = [start, end].map((at) => source.slice(0, at).split('\n').length - 1);
  const decls = new Map();
  let doc = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = line.match(/^(?:export )?(?:type|interface) (\w+)/);
    if (!head) {
      if (line.startsWith('/**')) doc = [line];
      else if (doc.length && !doc.at(-1).endsWith('*/')) doc.push(line);
      else doc = [];
      continue;
    }
    const body = [line];
    if (line.match(/^(?:export )?interface /)) while (!lines[i].startsWith('}')) body.push(lines[++i]);
    decls.set(head[1], {
      name: head[1],
      text: [...doc, ...body].join('\n').replace(/^export /m, ''),
      storyboard: i >= first && i < last,
    });
    doc = [];
  }
  const names = [...decls.keys()];
  for (const d of decls.values()) {
    const words = new Set(code(d.text).match(/\b[A-Z]\w*\b/g));
    d.uses = names.filter((n) => n !== d.name && words.has(n));
  }
  return decls;
}

/** A declaration's text without its comments and string literals, which name no type. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^'\n]*'/g, "''");

/** The scene types by their `type` literal, such as array → ArrayScene. */
export function sceneTypes(decls) {
  const union = decls
    .get('Scene')
    .text.match(/=\s*([^;]+);/)[1]
    .split('|')
    .map((s) => s.trim());
  return new Map(union.map((name) => [decls.get(name).text.match(/type: '(\w+)';/)[1], name]));
}

/** `names` and every declaration they use, in source order. */
function closure(decls, names) {
  const seen = new Set();
  const visit = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const u of decls.get(n).uses) if (u !== 'Scene') visit(u);
  };
  names.forEach(visit);
  return [...decls.keys()].filter((n) => seen.has(n));
}

/**
 * What `mr-cast schema [what]` prints. No argument: the storyboard and what every scene shares, with the scene
 * types to ask for. A scene type (`array`) or a declaration name (`FocusStep`): it and every type it uses.
 * `all`: the whole storyboard section.
 */
export function formatSchema(root, what) {
  const decls = readSchema(root);
  const scenes = sceneTypes(decls);
  const show = (names) => names.map((n) => decls.get(n).text).join('\n\n');
  if (what === 'all')
    return show(
      closure(
        decls,
        [...decls.values()].filter((d) => d.storyboard).map((d) => d.name),
      ),
    );
  if (what === undefined) {
    const root = closure(decls, ['Storyboard', 'SceneBase']).filter((n) => n !== 'Scene');
    return `${show(root)}\n\n// Scene is one of these. \`mr-cast schema <type>\` prints a scene's fields: ${[...scenes.keys()].join(', ')}.`;
  }
  const name = scenes.get(what) ?? (decls.has(what) ? what : null);
  if (!name)
    throw new UserError(
      `no scene type or schema type "${what}"; scene types: ${[...scenes.keys()].join(', ')}; or "all"`,
    );
  return show(closure(decls, [name]));
}
