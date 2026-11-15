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
 * The declarations every scene shares, in source order: the storyboard, SceneBase and what they use, and any type that
 * two or more scene types use. `mr-cast schema` prints these, so a scene type prints only what is its own.
 */
function shared(decls, scenes) {
  const base = closure(decls, ['Storyboard', 'SceneBase']);
  const uses = new Map();
  for (const name of scenes.values())
    for (const n of closure(decls, [name])) if (!base.includes(n)) uses.set(n, (uses.get(n) ?? 0) + 1);
  const several = new Set([...uses].filter(([, count]) => count > 1).map(([n]) => n));
  return new Set([...decls.keys()].filter((n) => n !== 'Scene' && (base.includes(n) || several.has(n))));
}

/**
 * What `mr-cast schema [what...]` prints. No argument: the storyboard and what every scene shares, with the scene
 * types to ask for. A scene type (`array`) or a declaration name (`FocusStep`): its own declaration and the types only
 * it uses, then one line naming the shared types it refers to. Several at once print each once and the shared part
 * never. `all`: the whole storyboard section.
 */
export function formatSchema(root, what) {
  const decls = readSchema(root);
  const scenes = sceneTypes(decls);
  const common = shared(decls, scenes);
  const show = (names) => names.map((n) => decls.get(n).text).join('\n\n');
  const asked = [what].flat();
  if (asked.includes('all'))
    return show(
      closure(
        decls,
        [...decls.values()].filter((d) => d.storyboard).map((d) => d.name),
      ),
    );
  if (what === undefined) {
    return `${show([...decls.keys()].filter((n) => common.has(n)))}\n\n// Scene is one of these. \`mr-cast schema <type>\` prints a scene's fields: ${[...scenes.keys()].join(', ')}.`;
  }
  const names = asked.map((w) => {
    const name = scenes.get(w) ?? (decls.has(w) ? w : null);
    if (!name)
      throw new UserError(
        `no scene type or schema type "${w}"; scene types: ${[...scenes.keys()].join(', ')}; or "all"`,
      );
    return name;
  });
  const own = new Set(names.flatMap((n) => closure(decls, [n]).filter((x) => x === n || !common.has(x))));
  const printed = [...decls.keys()].filter((n) => own.has(n));
  const refers = [...decls.keys()].filter(
    (n) => common.has(n) && !own.has(n) && printed.some((p) => decls.get(p).uses.includes(n)),
  );
  const note = refers.length
    ? `\n\n// Shared types used above: ${refers.join(', ')}. \`mr-cast schema\` prints them.`
    : '';
  return `${show(printed)}${note}`;
}
