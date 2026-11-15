// The syntax colours the engine draws code in, computed here with the player's own highlighter (Prism with One
// Dark, src/utils/highlight.ts) so the engine needs no highlighter of its own. The Node CLI bundles this file with
// esbuild for `render` and `still`; the browser player imports it.

import type { HunkMap, Storyboard } from '../types';
import { formatPayload } from '../utils/flowLayout';
import { plainCodeColor, tokenColor, tokenizeHunkLines, tokenizeLines } from '../utils/highlight';

/** A line of code as [text, CSS colour] pieces. */
type TokenLine = [string, string][];

/** engine/core/src/model.rs `Highlight`. */
export interface SyntaxColours {
  plain: string;
  hunks: Record<string, TokenLine[]>;
  snippets: Record<string, TokenLine[]>;
}

const colored = (lines: ReturnType<typeof tokenizeLines>): TokenLine[] =>
  lines.map((tokens) => tokens.map((t) => [t.content, tokenColor(t.types) ?? plainCodeColor]));

/** Every hunk's lines and every flow payload, coloured. `storyboard` is normalized. */
export function syntaxColours(storyboard: Storyboard, hunks: HunkMap): SyntaxColours {
  const out: SyntaxColours = { plain: plainCodeColor, hunks: {}, snippets: {} };
  for (const [id, hunk] of Object.entries(hunks)) out.hunks[id] = colored(tokenizeHunkLines(hunk.lines, hunk.language));
  for (const scene of storyboard.scenes)
    for (const step of scene.type === 'flow' ? (scene.steps ?? []) : [])
      if (typeof step.payload === 'string') {
        const { text, language } = formatPayload(step.payload);
        out.snippets[`${language}\n${text}`] = colored(tokenizeLines(text, language));
      }
  return out;
}
