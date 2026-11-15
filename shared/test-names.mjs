// The names of the tests a branch adds, read from the added lines of its test files. `extract` writes them to
// map.json (`tests[].adds`); the tests scene's footer counts them from hunks.json, which holds the same lines, so
// the number on screen and the number in the map are one.

import { isTestFile } from './test-files.mjs';

const TEST_NAME_PATTERNS = [
  /\b(?:test|it|describe)(?:\.\w+)*\s*\(\s*(['"`])(.+?)\1/,
  /\bit\s+(['"])(.+?)\1/,
  /\bdef\s+(test_\w+)/,
  /\bfunc\s+(Test\w+)/,
  /\bvoid\s+(test\w+)\s*\(/,
];

/** The test names on the added lines of `lines` (a hunk's lines): the `test(`/`it(`/`def test_`/`func Test` lines. */
export function testNames(lines) {
  const names = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    if (l?.type !== 'add') continue;
    for (const re of TEST_NAME_PATTERNS) {
      const m = re.exec(l.text);
      if (m) {
        names.push(m[m.length - 1]);
        break;
      }
    }
  }
  return names;
}

/** Every test name the changed test files of `hunks` add, in hunk order; a deleted file and a snippet add none. */
export function addedTestNames(hunks) {
  return Object.values(hunks ?? {}).flatMap((h) =>
    h?.status === 'source' || h?.status === 'deleted' || !isTestFile(h?.file ?? '') ? [] : testNames(h.lines),
  );
}

/** The added test names a change map lists, as `extract` wrote them (`adds`) or flattened (`names`); empty without a map. */
export function mapTestNames(map) {
  return (Array.isArray(map?.tests) ? map.tests : []).flatMap((t) => {
    const names = t?.adds ?? t?.names;
    return Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];
  });
}
