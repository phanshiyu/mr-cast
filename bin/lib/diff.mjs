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

function unquote(p) {
  // git quotes paths with special chars: "a/foo\tbar"
  if (p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  }
  return p;
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
      const m = line.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/);
      file = {
        file: m ? m[2] : line.slice(11),
        oldFile: m ? m[1] : null,
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
    const body = line.slice(1);
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
