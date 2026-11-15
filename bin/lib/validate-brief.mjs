// The brief of a branch video (docs/adr/0037-reviewer-brief.md): `validate` reports which of the six answers are
// missing, no scene tells, or point at nothing. All of it is a warning, so a storyboard written without a brief
// still passes; only a field of the wrong shape is an error. The change map (map.json) is optional: its checks
// are skipped when `extract` wrote none.

import fs from 'node:fs';
import path from 'node:path';
import { QUESTIONS, decisionsOf, missingQuestions } from '../../shared/brief.mjs';
import { shownHunkIds } from '../../shared/shown-hunks.mjs';
import { lineSpan } from '../../shared/review.mjs';
import { didYouMean } from './suggest.mjs';

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const SOURCES = ['description', 'code', 'test', 'inferred', 'unknown'];
const WEIGHTS = ['core', 'support', 'routine'];
const SHA = /^[0-9a-f]{7,40}$/i;
const PLACE = /^(.+?):(\d+)(?:-(\d+))?$/;
const LIST_MAX = 6;

/** "h4, h5, h6 and 3 more". */
const named = (items) =>
  items.length > LIST_MAX
    ? `${items.slice(0, LIST_MAX).join(', ')} and ${items.length - LIST_MAX} more`
    : items.join(', ');

function stringList(v, path, errors) {
  if (!Array.isArray(v) || !v.every(isStr)) errors.push(`${path}: must be an array of strings`);
}

/** A decision is a string (the writer's own) or `{ text, source, cite? }`. */
function checkDecisions(v, q, errors) {
  if (!Array.isArray(v)) return errors.push(`${q}: must be an array of { text, source, cite? } or strings`);
  v.forEach((d, i) => {
    if (isStr(d)) return;
    if (!isObj(d)) return errors.push(`${q}[${i}]: must be { text, source, cite? } or a string`);
    if (!isStr(d.text)) errors.push(`${q}[${i}].text: required string`);
    if (!isStr(d.source)) errors.push(`${q}[${i}].source: required, "description", "code", "mine" or "commit <sha>"`);
    if (d.cite !== undefined) stringList(d.cite, `${q}[${i}].cite`, errors);
  });
}

/** The shape of every answer; wrong types are errors, since nothing downstream can read them. */
function checkShape(brief, errors) {
  const at = (q) => `brief.${q}`;
  const { why, case: cs, approach, parts, proof, check, ask } = brief;
  if (why !== undefined) {
    if (!isObj(why)) errors.push(`${at('why')}: must be { text, source }`);
    else {
      if (!isStr(why.source))
        errors.push(`${at('why')}.source: required, one of ${SOURCES.join(', ')} or "commit <sha>"`);
      if (why.text !== undefined && !isStr(why.text)) errors.push(`${at('why')}.text: must be a non-empty string`);
      else if (why.text === undefined && why.source !== 'unknown')
        errors.push(`${at('why')}.text: required, or set source "unknown"`);
    }
  }
  if (cs !== undefined && cs !== 'unknown') {
    if (!isObj(cs)) errors.push(`${at('case')}: must be { before, after, cite } or "unknown"`);
    else {
      for (const f of ['before', 'after']) if (!isStr(cs[f])) errors.push(`${at('case')}.${f}: required string`);
      stringList(cs.cite, `${at('case')}.cite`, errors);
    }
  }
  if (approach !== undefined && approach !== 'unknown') {
    if (!isObj(approach)) errors.push(`${at('approach')}: must be { text, decisions } or "unknown"`);
    else {
      if (!isStr(approach.text)) errors.push(`${at('approach')}.text: required string`);
      checkDecisions(approach.decisions, `${at('approach')}.decisions`, errors);
    }
  }
  if (parts !== undefined && parts !== 'unknown') {
    if (!Array.isArray(parts)) errors.push(`${at('parts')}: must be an array of { name, weight, hunks } or "unknown"`);
    else
      parts.forEach((p, i) => {
        const q = `${at('parts')}[${i}]`;
        if (!isObj(p)) return errors.push(`${q}: must be { name, weight, hunks }`);
        if (!isStr(p.name)) errors.push(`${q}.name: required string`);
        if (!WEIGHTS.includes(p.weight)) errors.push(`${q}.weight: must be one of ${WEIGHTS.join(', ')}`);
        stringList(p.hunks, `${q}.hunks`, errors);
      });
  }
  if (proof !== undefined && proof !== 'unknown') {
    if (!isObj(proof)) errors.push(`${at('proof')}: must be { tested, untested, cite } or "unknown"`);
    else {
      stringList(proof.tested, `${at('proof')}.tested`, errors);
      stringList(proof.untested, `${at('proof')}.untested`, errors);
      if (proof.cite !== undefined) stringList(proof.cite, `${at('proof')}.cite`, errors);
    }
  }
  if (check !== undefined) {
    if (!Array.isArray(check)) errors.push(`${at('check')}: must be an array of { file, line, what, why }`);
    else
      check.forEach((c, i) => {
        const q = `${at('check')}[${i}]`;
        if (!isObj(c)) return errors.push(`${q}: must be { file, line, what, why }`);
        for (const f of ['file', 'what', 'why']) if (!isStr(c[f])) errors.push(`${q}.${f}: required string`);
        if (!lineSpan(c.line)) errors.push(`${q}.line: ${JSON.stringify(c.line)} is not a line number or "a-b" range`);
      });
  }
  if (ask !== undefined) stringList(ask, at('ask'), errors);
}

/** What the brief may point at: the run's hunks, its commits and files from the map, and the files on disk. */
function lookup(hunks, map, root) {
  const files = new Set([
    ...Object.values(hunks).map((h) => h.file),
    ...(Array.isArray(map?.files) ? map.files.map((f) => f?.path) : []),
  ]);
  const lengths = new Map();
  const length = (file) => {
    if (!root) return null;
    if (!lengths.has(file)) {
      try {
        lengths.set(file, fs.readFileSync(path.join(root, file), 'utf8').split('\n').length);
      } catch {
        lengths.set(file, null);
      }
    }
    return lengths.get(file);
  };
  return { files, length, commits: Array.isArray(map?.commits) ? map.commits : null };
}

/** Why `ref` points at nothing, or null. A ref is a hunk id, a short sha, `path:line` or `path:a-b`. */
function refProblem(ref, hunks, look, { lineOnly = false } = {}) {
  if (!isStr(ref)) return 'is not a string';
  if (!lineOnly && Object.hasOwn(hunks, ref)) return null;
  const place = PLACE.exec(ref);
  if (place) {
    const [, file, a, b = a] = place;
    const known = look.files.has(file) || look.length(file) !== null;
    if (!known) return `names ${file}, which is not a file of the diff${didYouMean(file, [...look.files])}`;
    if (Number(a) < 1 || Number(b) < Number(a)) return `is not a line number or "a-b" range`;
    const length = look.length(file);
    if (length !== null && Number(b) > length) return `names line ${b}, but ${file} has ${length} lines`;
    return null;
  }
  if (!lineOnly && SHA.test(ref)) {
    if (!look.commits) return null;
    return look.commits.some((c) => typeof c?.sha === 'string' && (c.sha.startsWith(ref) || ref.startsWith(c.sha)))
      ? null
      : 'is not a commit of this branch';
  }
  return lineOnly ? 'is not a path:line' : 'is not a hunk id in hunks.json, a path:line, or a short commit sha';
}

/** A decision's `source` and `cite`: a "code" decision names where it shows, and a commit is one of the branch's. */
function checkDecisionSources(approach, hunks, look, warnings) {
  const raw = Array.isArray(approach.decisions) ? approach.decisions : [];
  raw.forEach((d, i) => {
    if (!isObj(d)) return;
    const at = `brief.approach.decisions[${i}]`;
    const source = typeof d.source === 'string' ? d.source.trim() : '';
    const sha = /^commit (\S+)$/.exec(source);
    if (sha) {
      const problem = SHA.test(sha[1]) ? refProblem(sha[1], hunks, look) : 'is not a short commit sha';
      if (problem) warnings.push(`${at}.source: "${sha[1]}" ${problem}`);
    } else if (source && !['description', 'code', 'mine'].includes(source))
      warnings.push(`${at}.source: "${source}" is not one of description, code, mine or "commit <sha>"`);
    if (source === 'code' && !(Array.isArray(d.cite) && d.cite.length))
      warnings.push(`${at}: source "code" but no cite; name the hunk id or path:line where the choice shows`);
    (Array.isArray(d.cite) ? d.cite : []).forEach((ref, j) => {
      const problem = refProblem(ref, hunks, look);
      if (problem) warnings.push(`${at}.cite[${j}]: "${ref}" ${problem}`);
    });
  });
}

function checkRefs(brief, hunks, look, warnings) {
  const warn = (path, ref, problem) => warnings.push(`${path}: "${ref}" ${problem}`);
  const cites = [
    ['case', brief.case?.cite],
    ['proof', brief.proof?.cite],
  ];
  for (const [q, cite] of cites)
    (Array.isArray(cite) ? cite : []).forEach((ref, i) => {
      const problem = refProblem(ref, hunks, look);
      if (problem) warn(`brief.${q}.cite[${i}]`, ref, problem);
    });
  const source = brief.why?.source;
  if (typeof source === 'string') {
    const sha = /^commit (\S+)$/.exec(source);
    if (sha) {
      const problem = SHA.test(sha[1]) ? refProblem(sha[1], hunks, look) : 'is not a short commit sha';
      if (problem) warn('brief.why.source', sha[1], problem);
    } else if (!SOURCES.includes(source))
      warnings.push(`brief.why.source: "${source}" is not one of ${SOURCES.join(', ')} or "commit <sha>"`);
  }
  if (isObj(brief.approach)) checkDecisionSources(brief.approach, hunks, look, warnings);
  if (Array.isArray(brief.parts))
    brief.parts.forEach((p, i) =>
      (Array.isArray(p?.hunks) ? p.hunks : []).forEach((id, j) => {
        if (isStr(id) && !Object.hasOwn(hunks, id)) warn(`brief.parts[${i}].hunks[${j}]`, id, 'is not in hunks.json');
      }),
    );
  if (Array.isArray(brief.check))
    brief.check.forEach((c, i) => {
      if (!isStr(c?.file) || !lineSpan(c.line)) return;
      const problem = refProblem(`${c.file}:${c.line}`, hunks, look, { lineOnly: true });
      if (problem) warnings.push(`brief.check[${i}]: ${c.file}:${c.line} ${problem}`);
    });
}

/** The hunk ids a scene shows or cites: a code scene's, a flow stop's, a compare cell's, a tests scene's, a reading item's, and `from`. */
function shownHunks(sb) {
  const ids = new Set();
  for (const s of sb.scenes) {
    if (!isObj(s)) continue;
    for (const id of shownHunkIds(s)) ids.add(id);
    if (s.type === 'reading' && Array.isArray(s.items)) for (const it of s.items) ids.add(it?.hunkId);
    if (Array.isArray(s.from)) for (const id of s.from) ids.add(id);
  }
  return ids;
}

function checkAnswers(sb, brief, warnings) {
  const told = new Set();
  sb.scenes.forEach((s, i) => {
    if (!isObj(s) || s.answers === undefined) return;
    if (!Array.isArray(s.answers) || !s.answers.every((q) => QUESTIONS.includes(q)))
      return warnings.push(
        `scenes[${i}].answers: must list some of ${QUESTIONS.join(', ')}${
          Array.isArray(s.answers)
            ? s.answers
                .filter((q) => !QUESTIONS.includes(q))
                .map((q) => didYouMean(q, QUESTIONS))
                .join('')
            : ''
        }`,
      );
    for (const q of s.answers) told.add(q);
  });
  for (const q of QUESTIONS)
    if (!missingQuestions(brief).includes(q) && !told.has(q))
      warnings.push(
        `brief.${q}: no scene tells it; add "answers": ["${q}"] to the scene that does, or add a scene for it`,
      );
}

/** A compare of options that answers "approach" shows a way not taken; when every decision is the writer's own, say so. */
function checkAlternatives(sb, brief, warnings) {
  const decisions = decisionsOf(brief.approach);
  if (!decisions.length || !decisions.every((d) => d.kind === 'mine')) return;
  sb.scenes.forEach((s, i) => {
    if (s?.type !== 'compare' || s.mode !== 'options' || s.alternative === 'mine') return;
    if (Array.isArray(s.answers) && s.answers.includes('approach'))
      warnings.push(
        `scenes[${i}]: shows a way not taken for "approach", but every decision in the brief is "mine", so the alternative is yours and no commit or description names it; add "alternative": "mine" so the video labels it "Another way"`,
      );
  });
}

function checkParts(sb, brief, map, warnings) {
  if (!Array.isArray(brief.parts)) return;
  const shown = shownHunks(sb);
  brief.parts.forEach((p, i) => {
    if (p?.weight !== 'core') return;
    if (!(Array.isArray(p.hunks) ? p.hunks : []).some((id) => shown.has(id)))
      warnings.push(
        `brief.parts[${i}] ("${p.name}"): a core part, but no scene shows or cites any of its hunks; show one in a code scene, or cite them in a scene's "from"`,
      );
  });
  if (!Array.isArray(map?.files)) return;
  const held = new Set(brief.parts.flatMap((p) => (Array.isArray(p?.hunks) ? p.hunks : [])));
  const skipped = new Set((Array.isArray(sb.skipped) ? sb.skipped : []).map((e) => e?.hunkId));
  const loose = map.files
    .filter((f) => ['source', 'tests'].includes(f?.kind))
    .flatMap((f) =>
      (Array.isArray(f.hunks) ? f.hunks : [])
        .filter((id) => !held.has(id) && !skipped.has(id))
        .map((id) => [id, f.path]),
    );
  if (loose.length)
    warnings.push(
      `brief.parts: ${loose.length} hunk${loose.length === 1 ? '' : 's'} of source or test files in no part and not in "skipped": ${named(loose.map(([id, file]) => `${id} (${file})`))}; put each in a part, or skip it with a reason`,
    );
  const unheld = map.files
    .filter((f) => f?.kind === 'source' && f.status === 'modified' && Array.isArray(f.hunks) && f.hunks.length)
    .filter((f) => !f.hunks.some((id) => held.has(id)))
    .map((f) => f.path);
  if (unheld.length)
    warnings.push(
      `brief.parts: modified source ${unheld.length === 1 ? 'file' : 'files'} no part holds: ${named(unheld)}; changed behaviour of existing code is what a reviewer misses, so put ${unheld.length === 1 ? 'it' : 'them'} in a part`,
    );
}

function checkEvidence(brief, map, warnings) {
  const decisions = decisionsOf(brief.approach);
  const said = (Array.isArray(map?.commits) && map.commits.some((c) => isStr(c?.body))) || isStr(map?.description);
  if (said && decisions.length && decisions.every((d) => d.kind === 'mine'))
    warnings.push(
      `brief.approach.decisions: every decision is "mine", but ${isStr(map?.description) ? 'the description' : 'a commit body'} is in map.json; the commits or description may state choices, so read them, and cite a choice they state as "description" or "commit <sha>"`,
    );
  if (
    Array.isArray(map?.tests) &&
    map.tests.length &&
    isObj(brief.proof) &&
    !(Array.isArray(brief.proof.tested) && brief.proof.tested.length)
  )
    warnings.push(
      `brief.proof.tested: empty, but this branch changes ${map.tests.length} test ${map.tests.length === 1 ? 'file' : 'files'} (${named(map.tests.map((t) => t?.path))}); say what they show`,
    );
  if (brief.proof === 'unknown' && Array.isArray(map?.tests) && map.tests.length)
    warnings.push(
      `brief.proof: "unknown", but this branch changes ${map.tests.length} test ${map.tests.length === 1 ? 'file' : 'files'} (${named(map.tests.map((t) => t?.path))}); say what they show`,
    );
  if (said && ['inferred', 'unknown'].includes(brief.why?.source))
    warnings.push(
      `brief.why.source: "${brief.why.source}", but ${isStr(map?.description) ? 'the description' : 'a commit body'} is in map.json; read it, and cite it as "description" or "commit <sha>"`,
    );
}

/**
 * Checks the brief of a branch video. `map` is map.json as `extract` wrote it, or null; `root` is the repository, for
 * the files a `check` line names. A video of anything but a branch has no brief to check.
 */
/**
 * map.json as the brief's checks read it: one list of files, each with `path`, `kind`, `status` and `hunks`, and the
 * tests with `path` and `names`. `extract` writes the files by kind, with `file`, `hunkIds` and `adds`.
 */
function flatMap(map) {
  if (!isObj(map) || Array.isArray(map.files)) return map;
  const kinds = isObj(map.files) ? map.files : {};
  const files = Object.entries(kinds).flatMap(([kind, list]) =>
    (Array.isArray(list) ? list : []).map((f) => ({
      path: f?.file,
      kind: f?.kind ?? kind,
      status: f?.status,
      hunks: Array.isArray(f?.hunkIds) ? f.hunkIds : [],
    })),
  );
  const tests = (Array.isArray(map.tests) ? map.tests : []).map((t) => ({
    path: t?.file ?? t?.path,
    covers: t?.covers,
    names: t?.adds ?? t?.names,
  }));
  return { ...map, files, tests };
}

export function checkBrief(sb, hunks, { branch, map: written = null, root = null }, errors, warnings) {
  const map = flatMap(written);
  // An explanation or a quick video has no reviewer to answer to, so a brief or an `answers` in one is not read.
  if (!branch) return;
  if (sb.brief === undefined)
    return warnings.push(
      `brief: a video of a branch answers six questions (${QUESTIONS.join(', ')}); add "brief" to the storyboard, and "answers" to the scenes that tell them`,
    );
  if (!isObj(sb.brief))
    return errors.push('brief: must be an object with why, case, approach, parts, proof, check and ask');
  const before = errors.length;
  checkShape(sb.brief, errors);
  if (errors.length > before) return;
  for (const q of missingQuestions(sb.brief))
    warnings.push(
      q === 'check'
        ? 'brief.check: no places to open first; list what could break, or say in "ask" that nothing looks risky'
        : `brief.${q}: no answer; answer it, or write "unknown" where nothing says${q === 'why' ? ' ({ "source": "unknown" })' : ''}, and put the question in "ask"`,
    );
  const look = lookup(hunks, map, root);
  checkRefs(sb.brief, hunks, look, warnings);
  checkAnswers(sb, sb.brief, warnings);
  checkAlternatives(sb, sb.brief, warnings);
  checkParts(sb, sb.brief, map, warnings);
  checkEvidence(sb.brief, map, warnings);
}
