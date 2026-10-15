import type { CodeScene, DiffLine, Hunk, LineRef } from '../types';

export function expandLineRefs(refs: readonly LineRef[] = []): Set<number> {
  const out = new Set<number>();
  for (const ref of refs) {
    if (typeof ref === 'number') {
      out.add(ref);
      continue;
    }
    const [first, last = first] = ref.split('-').map((s) => parseInt(s, 10));
    if (first === undefined || last === undefined || Number.isNaN(first) || Number.isNaN(last)) continue;
    const [a, b] = [first, last];
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return out;
}

/** New-file and old-file line numbers the scene wants emphasised. */
export interface Focus {
  after: Set<number>;
  before: Set<number>;
}

export function sceneFocus(scene: CodeScene, hunk: Hunk): Focus {
  if (scene.focusLinesAfter === undefined && scene.focusLinesBefore === undefined) {
    const after = new Set<number>();
    const before = new Set<number>();
    for (const line of hunk.lines) {
      if (line.type === 'add' && line.newLine !== null) after.add(line.newLine);
      if (line.type === 'del' && line.oldLine !== null) before.add(line.oldLine);
    }
    return { after, before };
  }
  return { after: expandLineRefs(scene.focusLinesAfter), before: expandLineRefs(scene.focusLinesBefore) };
}

export function isFocused(line: DiffLine, focus: Focus): boolean {
  return (line.newLine !== null && focus.after.has(line.newLine)) || (line.oldLine !== null && focus.before.has(line.oldLine));
}
