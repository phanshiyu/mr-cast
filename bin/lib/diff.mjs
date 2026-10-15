// Zero-dependency unified diff parser for `git diff` output.

const LANGUAGES = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', scala: 'scala', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less', html: 'markup', vue: 'markup', svelte: 'markup',
  xml: 'markup', svg: 'markup', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf', dockerfile: 'docker', tf: 'hcl', lua: 'lua', ex: 'elixir', exs: 'elixir',
};

export function detectLanguage(file) {
  const base = file.split('/').pop().toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return LANGUAGES[ext] ?? 'text';
}

const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Read a C-style quoted token (git's quote_c_style) starting at `s[start] === '"'`.
 * Octal escapes are raw bytes, so the token is decoded as UTF-8 at the end.
 * @returns {[string, number]} the decoded text and the index just past the closing quote
 */
function readQuoted(s, start) {
  const bytes = [];
  let i = start + 1;
  while (i < s.length && s[i] !== '"') {
    if (s[i] === '\\') {
      const oct = s.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 4; continue; }
      bytes.push(C_ESCAPES[s[i + 1]] ?? s.charCodeAt(i + 1));
      i += 2;
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i));
      bytes.push(...Buffer.from(ch));
      i += ch.length;
    }
  }
  return [Buffer.from(bytes).toString('utf8'), i + 1];
}

function unquote(p) {
  return p.startsWith('"') ? readQuoted(p, 0)[0] : p;
}

/**
 * Split the `a/X b/Y` part of a `diff --git` header. Without quoting the separator is ambiguous
 * when paths contain " b/", but non-renames have X === Y, so the midpoint split is tried first.
 * Renames fall back to the first " b/"; their `rename from/to` lines override the result anyway.
 */
function parseGitHeaderPaths(rest) {
  if (rest.startsWith('"')) {
    const [a, end] = readQuoted(rest, 0);
    return [a, unquote(rest.slice(end + 1))];
  }
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === ' ' && rest.slice(2, mid) === rest.slice(mid + 3)) {
    return [rest.slice(0, mid), rest.slice(mid + 1)];
  }
  const quotedB = rest.indexOf(' "b/');
  const sep = quotedB >= 0 ? quotedB : rest.indexOf(' b/');
  if (sep < 0) return [null, rest];
  return [rest.slice(0, sep), unquote(rest.slice(sep + 1))];
}

function stripPrefix(p) {
  p = unquote(p.trim());
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/**
 * Parse `git diff` output into files with hunks.
 * @returns {Array<{ file, oldFile, status, binary, hunks: Array<{ oldStart, oldLines, newStart, newLines, header, lines }> }>}
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      const [a, b] = parseGitHeaderPaths(line.slice(11));
      file = {
        file: b.replace(/^b\//, ''),
        oldFile: a && a.replace(/^a\//, ''),
        status: 'modified',
        binary: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldFile = unquote(line.slice(12)); }
      else if (line.startsWith('rename to ')) file.file = unquote(line.slice(10));
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('--- ')) { const p = stripPrefix(line.slice(4)); if (p) file.oldFile = p; }
      else if (line.startsWith('+++ ')) { const p = stripPrefix(line.slice(4)); if (p) file.file = p; }
    }

    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (h) {
      hunk = {
        oldStart: +h[1], oldLines: h[2] === undefined ? 1 : +h[2],
        newStart: +h[3], newLines: h[4] === undefined ? 1 : +h[4],
        header: h[5].trim(),
        lines: [],
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const tag = line[0];
    const body = line.slice(1).replace(/\r$/, '');
    if (tag === ' ') hunk.lines.push({ type: 'context', oldLine: oldNo++, newLine: newNo++, text: body });
    else if (tag === '-') hunk.lines.push({ type: 'del', oldLine: oldNo++, newLine: null, text: body });
    else if (tag === '+') hunk.lines.push({ type: 'add', oldLine: null, newLine: newNo++, text: body });
    else if (tag === '\\') continue; // "\ No newline at end of file"
    else if (line === '' && i === lines.length - 1) continue;
    else hunk = null; // anything else ends the hunk
  }

  // Only renames need to carry the old path.
  for (const f of files) if (f.status !== 'renamed') f.oldFile = null;
  return files;
}

/** Turn parsed files into the flat `hunks.json` record keyed by short stable ids (h1, h2, ...). */
export function buildHunkIndex(files) {
  const hunks = {};
  let n = 0;
  for (const f of files) {
    if (f.binary) continue;
    const language = detectLanguage(f.file);
    for (const h of f.hunks) {
      const id = `h${++n}`;
      const before = h.lines.filter((l) => l.type !== 'add').map((l) => l.text);
      const after = h.lines.filter((l) => l.type !== 'del').map((l) => l.text);
      hunks[id] = {
        id,
        file: f.file,
        oldFile: f.oldFile,
        status: f.status,
        language,
        header: h.header,
        startLine: h.newStart,
        oldStartLine: h.oldStart,
        endLine: h.newStart + Math.max(h.newLines - 1, 0),
        additions: h.lines.filter((l) => l.type === 'add').length,
        deletions: h.lines.filter((l) => l.type === 'del').length,
        beforeCode: before.join('\n'),
        afterCode: after.join('\n'),
        lines: h.lines,
      };
    }
  }
  return hunks;
}
