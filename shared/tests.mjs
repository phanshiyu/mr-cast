// The tests scene's matrix: the situations the code can meet as rows, the outcomes it promises as columns, and
// the tests that check cells. Shared by the scene (which draws it), `validate` (which checks it) and the
// highlight linter (which names its parts). Item keys follow shared/targets.mjs: a situation "s:<id>", a cell
// "x:<row>/<col>", an outcome "o:<col>" and a test "t:<index>".

const list = (v) => (Array.isArray(v) ? v : []);
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const situationKey = (id) => `s:${id}`;
const cellKey = (row, col) => `x:${row}/${col}`;
export const outcomeKey = (col) => `o:${col}`;
export const testKey = (n) => `t:${n}`;

/** The cell a check or ref such as "retry.Calls" names, as its row and column, or null. Ids and outcomes may hold dots. */
function cellOf(scene, ref) {
  if (typeof ref !== 'string') return null;
  const outcomes = list(scene?.outcomes);
  const row = list(scene?.situations).findIndex(
    (s) => typeof s?.id === 'string' && ref.startsWith(`${s.id}.`) && outcomes.includes(ref.slice(s.id.length + 1)),
  );
  return row < 0 ? null : { row, col: outcomes.indexOf(ref.slice(list(scene.situations)[row].id.length + 1)) };
}

/** A situation drawn as a gap: one no test tries, with no promises, so its row is one bar holding `gap`. */
export const isGapRow = (situation) => typeof situation?.gap === 'string' && !isObject(situation?.expect);

/** What a test does to its cells: removed tests no longer check anything. */
export const isLive = (test) => (test?.status ?? 'added') !== 'removed';

/** The status a checked cell shows: NEW when any test checking it is new, else CHANGED, else none. */
function cellStatus(tests) {
  const statuses = tests.map((t) => t?.status ?? 'added');
  return statuses.includes('added') ? 'added' : statuses.includes('modified') ? 'modified' : null;
}

/**
 * The matrix as drawn: per situation its cells, each with its promised value, the tests checking it and what it
 * shows ("checked", "unchecked", "removed" or "none"), and the scene's counts.
 * @returns {import('./tests').TestsMatrix}
 */
export function testsMatrix(scene) {
  const outcomes = list(scene?.outcomes);
  const tests = list(scene?.tests);
  const checking = new Map();
  tests.forEach((test, n) => {
    for (const ref of list(test?.checks)) {
      const cell = cellOf(scene, ref);
      if (!cell) continue;
      const key = cellKey(cell.row, cell.col);
      if (!checking.has(key)) checking.set(key, []);
      if (!checking.get(key).includes(n)) checking.get(key).push(n);
    }
  });
  const rows = list(scene?.situations).map((situation, row) => {
    const expect = isObject(situation?.expect) ? situation.expect : {};
    const cells = outcomes.map((outcome, col) => {
      const by = checking.get(cellKey(row, col)) ?? [];
      const live = by.filter((n) => isLive(tests[n]));
      const value = typeof expect[outcome] === 'string' ? expect[outcome] : undefined;
      const was = [...new Set(by.map((n) => tests[n]?.was).filter((w) => typeof w === 'string' && w.length > 0))];
      const removed = by.length > live.length;
      const state = live.length ? 'checked' : value !== undefined ? 'unchecked' : removed ? 'removed' : 'none';
      return {
        key: cellKey(row, col),
        row,
        col,
        outcome,
        value,
        tests: by,
        state,
        status: cellStatus(live.map((n) => tests[n])),
        removed,
        was,
      };
    });
    return {
      key: situationKey(situation?.id),
      row,
      situation,
      gap: isGapRow(situation),
      cells,
      tests: [...new Set(cells.flatMap((c) => c.tests))],
    };
  });
  const status = (s) => tests.filter((t) => (t?.status ?? 'added') === s).length;
  const live = rows.filter((r) => !r.gap).flatMap((r) => r.cells);
  return {
    outcomes,
    rows,
    counts: {
      tests: tests.length,
      added: status('added'),
      modified: status('modified'),
      removed: status('removed'),
      existing: status('existing'),
      gaps: rows.filter((r) => r.gap).length,
      unchecked: live.filter((c) => c.state === 'unchecked').length,
    },
  };
}

/** The item keys a test lights: its own, and every cell it checks. */
export function testKeys(scene, n) {
  return [
    testKey(n),
    ...list(list(scene?.tests)[n]?.checks).flatMap((ref) => {
      const cell = cellOf(scene, ref);
      return cell ? [cellKey(cell.row, cell.col)] : [];
    }),
  ];
}

/** The item keys a ref lights: a situation id, a cell "id.Outcome", an outcome, or a test's name; null when it names none. */
export function resolveTestsRef(scene, ref) {
  if (typeof ref !== 'string') return null;
  const situations = list(scene?.situations);
  const outcomes = list(scene?.outcomes);
  const row = situations.findIndex((s) => s?.id === ref);
  if (row >= 0)
    return [situationKey(ref), ...(isGapRow(situations[row]) ? [] : outcomes.map((_, col) => cellKey(row, col)))];
  const cell = cellOf(scene, ref);
  if (cell) return [cellKey(cell.row, cell.col)];
  const col = outcomes.indexOf(ref);
  if (col >= 0) return [outcomeKey(col), ...situations.flatMap((s, r) => (isGapRow(s) ? [] : [cellKey(r, col)]))];
  const named = list(scene?.tests).flatMap((t, n) => (t?.name === ref ? testKeys(scene, n) : []));
  return named.length ? named : null;
}

/** Every ref a tests scene's steps can name, for "did you mean" hints. */
export const testsRefNames = (scene) => [
  ...list(scene?.situations).map((s) => s?.id),
  ...list(scene?.outcomes),
  ...list(scene?.tests).map((t) => t?.name),
];

const STATUS_WORD = { added: '[NEW]{good}', modified: '[CHANGED]{accent}', removed: '[REMOVED]{bad}' };
/** A test's name as display text, shown as written: every markup character escaped. */
const literal = (name) => String(name).replace(/[\\*`=[\]{}]/g, (c) => `\\${c}`);

/** The callout of each step: its own, or the names of the tests it focuses with their status; "" for none. */
export function testsCallouts(scene) {
  const tests = list(scene?.tests);
  return list(scene?.steps).map((step) => {
    if (typeof step?.callout === 'string') return step.callout;
    const refs = Array.isArray(step?.focus) ? step.focus : [step?.focus];
    const named = tests.filter((t) => refs.includes(t?.name));
    return named.map((t) => [STATUS_WORD[t.status ?? 'added'], literal(t.name)].filter(Boolean).join(' ')).join(' · ');
  });
}

/**
 * A tests scene written before 0.27, with `cases` and `gaps`, as a matrix: each case a situation named by the
 * test, with one outcome ("Proves", or its `titles.proves`) holding what it proves, checked by that test; each gap
 * a situation of its own drawn as a gap. Steps that named a case by index or name, or a gap as "gap:0", name its
 * situation. A removed case's proof was struck through, so it becomes the removed test's `was`. A scene with
 * `situations`, or with neither `cases` nor `gaps`, comes back as it is.
 */
export function upgradeTests(scene) {
  if (
    !isObject(scene) ||
    scene.type !== 'tests' ||
    scene.situations !== undefined ||
    (scene.cases === undefined && scene.gaps === undefined)
  )
    return scene;
  const { cases: rawCases, gaps: rawGaps, titles, ...rest } = scene;
  const cases = list(rawCases);
  const gaps = list(rawGaps);
  const outcome = typeof titles?.proves === 'string' && titles.proves.trim() ? titles.proves : 'Proves';
  const caseId = (i) => `case ${i + 1}`;
  const gapId = (i) => `gap ${i + 1}`;
  const situations = [
    ...cases.map((c, i) => ({
      id: caseId(i),
      when: c?.name,
      ...(isLive(c) ? { expect: { [outcome]: c?.proves } } : {}),
    })),
    ...gaps.map((g, i) => ({ id: gapId(i), when: g, gap: titles?.gaps || 'Not tested' })),
  ];
  const tests = cases.map((c, i) => {
    const test = {
      name: c?.name,
      status: c?.status,
      checks: [`${caseId(i)}.${outcome}`],
      hunkId: c?.hunkId,
      was: isLive(c) ? undefined : c?.proves,
    };
    return Object.fromEntries(Object.entries(test).filter(([, v]) => v !== undefined));
  });
  const refOf = (ref) => {
    if (Number.isInteger(ref) && ref >= 0 && ref < cases.length) return caseId(ref);
    const gap = typeof ref === 'string' ? /^gap:\s*(\d+)$/.exec(ref) : null;
    if (gap && Number(gap[1]) < gaps.length) return gapId(Number(gap[1]));
    const named = cases.findIndex((c) => c?.name === ref);
    return named >= 0 ? caseId(named) : ref;
  };
  const steps = Array.isArray(scene.steps)
    ? scene.steps.map((step) =>
        isObject(step) && step.focus !== undefined
          ? { ...step, focus: Array.isArray(step.focus) ? step.focus.map(refOf) : refOf(step.focus) }
          : step,
      )
    : scene.steps;
  return { ...rest, when: 'Test', outcomes: [outcome], situations, tests, ...(steps !== undefined ? { steps } : {}) };
}
