// The names of the tests a branch adds, read from the added lines of its test files. `extract` writes them to
// map.json (`tests[].adds`, with the group names apart in `tests[].groups`); the tests scene's footer counts them from hunks.json, which holds the same lines, so
// the number on screen and the number in the map are one.

import { isTestFile } from './test-files.mjs';

const QUOTED = '(\'|"|`)(.+?)\\1';
const MODS = '(?:\\.(?:only|skip|todo|concurrent|failing|sequential))*';

// Each pattern ends with the name as its last capture group.
const TEST_NAME_PATTERNS = [
  new RegExp(`\\b(?:test|it)${MODS}\\s*\\(\\s*${QUOTED}`),
  new RegExp(`\\b(?:test|it)(?:\\.\\w+)*\\.each\\b.*?\\)\\s*\\(\\s*${QUOTED}`),
  new RegExp(`\\b(?:test|it)(?:\\.\\w+)*\\.each\\s*\\x60[^\\x60]*\\x60\\s*\\(\\s*${QUOTED}`),
  /\b(?:it|test)\s+(['"])(.+?)\1/,
  /\bdef\s+(test_\w+)/,
  /\bfunc\s+(Test\w+)/,
  /\bvoid\s+(test\w+)\s*\(/,
];

// Lines that only group tests: counted apart, never as tests.
const GROUP_PATTERNS = [
  new RegExp(`\\b(?:describe|context|suite)(?:\\.\\w+)*(?:\\.each\\b.*?\\))?\\s*\\(\\s*${QUOTED}`),
  /\b(?:describe|context)\s+(['"])(.+?)\1/,
  /\bRSpec\.describe\s+([\w:]+)/,
  /^\s*class\s+(Test\w*)/,
];

// A test that a line before it marks: Rust `#[test]` then `fn name`, JUnit/Kotlin `@Test` then a method.
const MARK = /#\[(?:\w+::)*test(?:\(.*)?\]|@Test\b/;
const MARKED_FN = /\b(?:fn|void)\s+(\w+)\s*\(|\bfun\s+(?:`([^`]+)`|(\w+))\s*\(/;
const MARK_GAP = /^\s*(?:$|@|#\[|\/\/)/;

const lastGroup = (m) => m[m.length - 1];

function first(patterns, text) {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return lastGroup(m);
  }
  return null;
}

/** The test names and the group names on the added lines of `lines` (a hunk's lines). */
function read(lines) {
  const tests = [];
  const groups = [];
  let marked = false;
  for (const l of Array.isArray(lines) ? lines : []) {
    if (l?.type === 'remove' || typeof l?.text !== 'string') continue;
    const add = l.type === 'add';
    if (marked || MARK.test(l.text)) {
      const fn = MARKED_FN.exec(l.text);
      if (fn) {
        if (add) tests.push(fn[1] ?? fn[2] ?? fn[3]);
        marked = false;
        continue;
      }
      marked = MARK.test(l.text) || (marked && MARK_GAP.test(l.text));
    }
    if (!add) continue;
    const group = first(GROUP_PATTERNS, l.text);
    if (group) {
      groups.push(group);
      continue;
    }
    const name = first(TEST_NAME_PATTERNS, l.text);
    if (name) tests.push(name);
  }
  return { tests, groups };
}

/** The test names on the added lines of `lines` (a hunk's lines): `it(`, `test(`, `def test_`, `func Test`, `#[test]` and `@Test`; never a `describe`. */
export function testNames(lines) {
  return read(lines).tests;
}

/** The group names on the added lines of `lines`: `describe(`, `context(`, `suite(`, `RSpec.describe` and `class Test…`. */
export function groupNames(lines) {
  return read(lines).groups;
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
