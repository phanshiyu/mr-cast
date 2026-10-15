// Pure formatting for CLI output. No IO: callers pass data in, get strings back.

const LINE_WIDTH = 110;
const HEADER_WIDTH = 60;
const MAX_SKIPPED_NAMES = 10;
const MINUS = '−';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One entry per changed file, in diff order, with the ids of its hunks. */
export function summarizeFiles(parsedFiles, hunks) {
  const all = Object.values(hunks);
  return parsedFiles.map((f) => {
    const own = all.filter((h) => h.file === f.file);
    return {
      file: f.file,
      oldFile: f.oldFile,
      status: f.status,
      binary: f.binary,
      additions: own.reduce((n, h) => n + h.additions, 0),
      deletions: own.reduce((n, h) => n + h.deletions, 0),
      hunkIds: own.map((h) => h.id),
    };
  });
}

function hunkRange(h) {
  if (h.status === 'deleted') {
    const olds = h.lines.map((l) => l.oldLine).filter((n) => n !== null);
    return `old L${olds[0]}-${olds[olds.length - 1]}`;
  }
  return `L${h.startLine}-${h.endLine}`;
}

function formatHunk(h, maxLines) {
  const changed = h.lines.filter((l) => l.type !== 'context' && l.text.trim() !== '');
  const shown = changed.slice(0, maxLines);
  const width = Math.max(1, ...shown.map((l) => String(l.newLine ?? l.oldLine).length));
  const header = h.header ? ` · ${clip(h.header, HEADER_WIDTH)}` : '';
  const out = [`  ${h.id} ${hunkRange(h)} +${h.additions} ${MINUS}${h.deletions}${header}`];
  for (const l of shown) {
    const sign = l.type === 'add' ? '+' : '-';
    const no = String(l.type === 'add' ? l.newLine : l.oldLine).padStart(width);
    out.push(`    ${sign} ${no} ${clip(l.text.replace(/\t/g, '  ').trimEnd(), LINE_WIDTH)}`);
  }
  if (changed.length > shown.length) out.push(`    … ${changed.length - shown.length} more`);
  return out;
}

function formatFileLine(f) {
  if (f.status === 'renamed') return `${f.file} [renamed from ${f.oldFile}]`;
  return `${f.file} [${f.status}${f.binary ? ', binary' : ''}]`;
}

/**
 * The compact hunk index printed by `extract`.
 * @param {{ branch, base, ahead, working, mergeBase, untracked: string[] }} ctx
 */
export function formatIndex({ ctx, files, hunks, skipped, maxLines, hunksPath, storyboardPath, nameArg = '' }) {
  const all = Object.values(hunks);
  const adds = all.reduce((n, h) => n + h.additions, 0);
  const dels = all.reduce((n, h) => n + h.deletions, 0);
  const what = ctx.working
    ? `${ctx.branch} + working tree vs ${ctx.base} (merge-base ${ctx.mergeBase.slice(0, 7)})`
    : `${ctx.branch} vs ${ctx.base} (${plural(ctx.ahead, 'commit')})`;
  const out = [`mr-cast: ${what} · ${plural(files.length, 'file')} · ${plural(all.length, 'hunk')} · +${adds} ${MINUS}${dels}`];

  for (const f of files) {
    const own = f.hunkIds.map((id) => hunks[id]);
    if (f.binary) out.push(`${formatFileLine(f)} (no hunks)`);
    else if (own.length === 0) out.push(`${formatFileLine(f)} (no content change)`);
    else {
      out.push(formatFileLine(f));
      for (const h of own) out.push(...formatHunk(h, maxLines));
    }
  }

  if (skipped.length) {
    const names = skipped.slice(0, MAX_SKIPPED_NAMES).join(', ');
    const more = skipped.length > MAX_SKIPPED_NAMES ? `, … ${skipped.length - MAX_SKIPPED_NAMES} more` : '';
    out.push(`skipped ${plural(skipped.length, 'file')} as noise (--all-files to include): ${names}${more}`);
  }
  if (ctx.untracked.length) {
    out.push(`not included: ${plural(ctx.untracked.length, 'untracked file')} (git add -N <file> to include)`);
  }
  out.push(`line numbers: + is the new-file line (use in focusLinesAfter), - is the old-file line (focusLinesBefore)`);
  out.push(`wrote ${hunksPath} · next: write ${storyboardPath}, then \`mr-cast validate${nameArg}\` and \`mr-cast play${nameArg}\``);
  return out.join('\n');
}

/** Ids whose content changed (or vanished) between two hunks.json maps. */
export function changedHunkIds(previous, next) {
  const sig = (h) => h && `${h.file}\0${h.startLine}\0${h.beforeCode}\0${h.afterCode}`;
  return Object.keys(previous).filter((id) => sig(previous[id]) !== sig(next[id]));
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "shows 9/13 hunks, skipped 2, tests 2/2 shown · tests scene: 5 cases, 1 gap"; each part only when it applies.
 * An explanation (null coverage) has no diff to cover.
 */
function formatCoverage(coverage) {
  if (!coverage) return ' · explain';
  const { shown, skipped, total, tests, testsScene } = coverage;
  const out = [];
  if (total) {
    const parts = [`shows ${shown}/${total} hunks`];
    if (skipped) parts.push(`skipped ${skipped}`);
    if (tests.total) parts.push(`tests ${tests.shown}/${tests.total} shown`);
    out.push(parts.join(', '));
  }
  if (testsScene) out.push(`tests scene: ${plural(testsScene.cases, 'case')}, ${plural(testsScene.gaps, 'gap')}`);
  return out.map((part) => ` · ${part}`).join('');
}

/** Lines for `validate`; the last line is the verdict. */
export function formatValidation({ errors, warnings, coverage }, { storyboard, hunks, seconds }) {
  const out = [
    ...errors.map((e) => `error: ${e}`),
    ...warnings.map((w) => `warning: ${w}`),
  ];
  if (errors.some((e) => e.includes('not found in hunks.json'))) {
    out.push(`hint: hunk ids in hunks.json are ${Object.keys(hunks).join(', ') || '(none)'}`);
  }
  if (errors.length) out.push(`✗ storyboard invalid · ${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`);
  else out.push(`✓ storyboard ok · ${plural(storyboard.scenes.length, 'scene')} · ${formatDuration(seconds)}${formatCoverage(coverage)}`);
  return out;
}

/** The snippets `explain snippet` just added or refreshed, every line numbered as in its file. */
export function formatSnippets({ added, hunks, hunksPath, storyboardPath }) {
  const out = [];
  for (const h of added) {
    const width = String(h.endLine).length;
    out.push(`  ${h.id} ${h.file} L${h.startLine}-${h.endLine} · ${plural(h.lines.length, 'line')}`);
    for (const l of h.lines) out.push(`    ${String(l.newLine).padStart(width)} ${clip(l.text.replace(/\t/g, '  ').trimEnd(), LINE_WIDTH)}`);
  }
  const all = Object.values(hunks).map((h) => `${h.id} ${h.file} L${h.startLine}-${h.endLine}`);
  out.push(`snippets in ${hunksPath}: ${all.join(', ')}`);
  out.push(`line numbers are the file's own; use them in focusLinesAfter · next: write ${storyboardPath}, then \`mr-cast explain validate\``);
  return out.join('\n');
}

const count = (items, word) => plural(Array.isArray(items) ? items.length : 0, word);
const refs = (lines) => lines.map(String).join(', ');

/** What a scene shows, in one line: the code and focus for a code scene, the size of a diagram. */
function sceneGist(scene, hunks) {
  const titled = (text) => (scene.title ? `${scene.title} · ${text}` : text);
  switch (scene.type) {
    case 'intent':
      return `${scene.risk ? `${scene.risk} risk · ` : ''}${scene.summary}`;
    case 'arch': {
      const key = scene.nodes.filter((n) => n.modified).length;
      return `${count(scene.nodes, 'node')}, ${count(scene.edges, 'edge')}${key ? `, ${key} highlighted` : ''}`;
    }
    case 'code': {
      const hunk = hunks[scene.hunkId];
      const parts = [`${scene.hunkId} ${hunk?.file ?? '?'}`];
      if (scene.steps?.length) {
        const lines = scene.steps.map((st) => (st.lines === undefined ? `old ${st.oldLines}` : String(st.lines)));
        parts.push(`${count(scene.steps, 'step')} (${lines.join(', ')})`);
        if (scene.steps.every((st) => st.label)) parts.push('flow');
        return parts.join(' · ');
      }
      if (scene.focusLinesAfter?.length) parts.push(`lines ${refs(scene.focusLinesAfter)}`);
      if (scene.focusLinesBefore?.length) parts.push(`old lines ${refs(scene.focusLinesBefore)}`);
      if (!scene.focusLinesAfter?.length && !scene.focusLinesBefore?.length) parts.push(hunk?.status === 'source' ? 'whole snippet' : 'changed lines');
      if (scene.flow?.length) parts.push(`flow ${count(scene.flow, 'step')}`);
      return parts.join(' · ');
    }
    case 'flow':
      return titled(count(scene.steps, 'step'));
    case 'sequence':
      return titled(`${count(scene.participants, 'participant')}, ${count(scene.messages, 'message')}`);
    case 'er':
      return titled(`${scene.entities.length} ${scene.entities.length === 1 ? 'entity' : 'entities'}, ${count(scene.relations, 'relation')}`);
    case 'state':
      return titled(`${count(scene.states, 'state')}, ${count(scene.transitions, 'transition')}`);
    case 'mermaid':
      return titled(`mermaid ${scene.code.trim().split(/\s/)[0]}`);
    case 'tests':
      return `${scene.subject ? `${scene.subject} · ` : ''}${count(scene.cases, 'case')}, ${count(scene.gaps, 'gap')}`;
    default:
      return '';
  }
}

/** `outline`: the plan of a valid storyboard, short enough to paste to a person for approval. */
export function formatOutline({ storyboard, hunks, coverage, seconds, voiced }) {
  const scenes = storyboard.scenes;
  const out = [storyboard.title, ...(storyboard.subtitle ? [storyboard.subtitle] : [])];
  const number = String(scenes.length).length;
  const typeWidth = Math.max(...scenes.map((s) => s.type.length));
  const chapterWidth = Math.min(24, Math.max(...scenes.map((s) => (s.chapter ?? '').length)));
  out.push('');
  scenes.forEach((scene, i) => {
    const chapter = clip(scene.chapter ?? '', chapterWidth).padEnd(chapterWidth);
    const head = `${String(i + 1).padStart(number)}. ${scene.type.padEnd(typeWidth)}  ${chapter}  `;
    out.push(`${head}${clip(sceneGist(scene, hunks), Math.max(30, LINE_WIDTH - head.length))}`.trimEnd());
  });
  out.push('');
  const length = `${voiced ? '' : 'about '}${formatDuration(seconds)}${voiced ? ' (voiced)' : ' (estimated from word count)'}`;
  out.push(`${plural(scenes.length, 'scene')} · ${length}`);
  const covered = formatCoverage(coverage);
  if (coverage && covered) out.push(`coverage:${covered.slice(2)}`);
  return out.join('\n');
}
