import { Prism, normalizeTokens, themes, type Token } from 'prism-react-renderer';
import type { DiffLine } from '../types';
import { addDocker } from './prismDocker';

addDocker(Prism);

const ALIASES: Record<string, string> = {
  java: 'clike',
  csharp: 'clike',
  php: 'clike',
  scala: 'clike',
  scss: 'css',
  less: 'css',
  toml: 'yaml',
  protobuf: 'clike',
  hcl: 'clike',
};

function grammarFor(language: string) {
  const name = ALIASES[language] ?? language;
  return Prism.languages[name];
}

export function tokenizeLines(code: string, language: string): Token[][] {
  const grammar = grammarFor(language);
  if (!grammar) return code.split('\n').map((content) => [{ types: ['plain'], content }]);
  return normalizeTokens(Prism.tokenize(code, grammar));
}

/** Tokens for every hunk line, tokenized per side so multi-line constructs keep their context. */
export function tokenizeHunkLines(lines: readonly DiffLine[], language: string): Token[][] {
  const oldSide = tokenizeLines(
    lines
      .filter((l) => l.type !== 'add')
      .map((l) => l.text)
      .join('\n'),
    language,
  );
  const newSide = tokenizeLines(
    lines
      .filter((l) => l.type !== 'del')
      .map((l) => l.text)
      .join('\n'),
    language,
  );
  let o = 0;
  let n = 0;
  return lines.map((line) => {
    if (line.type === 'del') return oldSide[o++] ?? [];
    if (line.type === 'add') return newSide[n++] ?? [];
    o++;
    return newSide[n++] ?? [];
  });
}

const codeTheme = themes.oneDark;

export const plainCodeColor = codeTheme.plain.color ?? '#e6e6e6';

export function tokenColor(types: readonly string[]): string | undefined {
  let color: string | undefined;
  for (const entry of codeTheme.styles) {
    if (entry.types.some((t) => types.includes(t)) && entry.style.color) color = entry.style.color;
  }
  return color;
}
