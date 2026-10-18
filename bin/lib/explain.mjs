// Snippets: ranges of unchanged source files as hunks, so code scenes can show the code of an
// explanation, or the callers, definitions and config a diff depends on.
import { detectLanguage } from './diff.mjs';
import { UserError } from './errors.mjs';

const SNIPPET_MAX_LINES = 80;

const RANGE = /^(\d+)(?:-(\d+))?$/;
const FILE_AND_RANGE = /^(.+):(\d+)(?:-(\d+))?$/;

function toRange(file, a, b = a) {
  const start = Number(a);
  const end = Number(b);
  if (start < 1 || end < start)
    throw new UserError(`${file}: range ${a}-${b} must run from line 1 or later, start before end`);
  if (end - start + 1 > SNIPPET_MAX_LINES) {
    throw new UserError(
      `${file}:${start}-${end} is ${end - start + 1} lines; a snippet holds at most ${SNIPPET_MAX_LINES}, so add the part the explanation needs, or split it into several snippets`,
    );
  }
  return { file, start, end };
}

/** `file:12-30`, `file:12`, or `file 12-30` arguments, in order, as { file, start, end }. */
export function parseSnippetArgs(args) {
  if (args.length === 0) throw new UserError('snippet needs at least one <file> <start>-<end> or <file>:<start>-<end>');
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const range = args[i + 1]?.match(RANGE);
    if (range && !RANGE.test(args[i])) {
      out.push(toRange(args[i], range[1], range[2]));
      i++;
      continue;
    }
    const joined = args[i].match(FILE_AND_RANGE);
    if (!joined)
      throw new UserError(`"${args[i]}" is not a snippet; write <file> <start>-<end> or <file>:<start>-<end>`);
    out.push(toRange(joined[1], joined[2], joined[3]));
  }
  return out;
}

/** A hunks.json entry for lines start..end of a file: every line context, numbered as in the file. */
export function sourceHunk(id, { file, start, end }, fileLines) {
  if (end > fileLines.length)
    throw new UserError(`${file} has ${fileLines.length} lines, so ${start}-${end} runs past its end`);
  const lines = fileLines
    .slice(start - 1, end)
    .map((text, k) => ({ type: 'context', oldLine: start + k, newLine: start + k, text }));
  const code = lines.map((l) => l.text).join('\n');
  return {
    id,
    file,
    oldFile: null,
    status: 'source',
    language: detectLanguage(file),
    header: '',
    startLine: start,
    oldStartLine: start,
    endLine: end,
    additions: 0,
    deletions: 0,
    beforeCode: code,
    afterCode: code,
    lines,
  };
}

/**
 * The id for a snippet: the existing one with the same file and range (its lines are re-read, so
 * edits to the file show up), else the next free sN.
 */
export function snippetId(hunks, { file, start, end }) {
  const same = Object.values(hunks).find(
    (h) => h.status === 'source' && h.file === file && h.startLine === start && h.endLine === end,
  );
  if (same) return same.id;
  const taken = Object.keys(hunks).map((id) => Number(id.match(/^s(\d+)$/)?.[1] ?? 0));
  return `s${Math.max(0, ...taken) + 1}`;
}
