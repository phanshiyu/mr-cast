import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-map-')));
  const repo = path.join(tmp, 'work');
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(tmp, 'config'),
    XDG_CACHE_HOME: path.join(tmp, 'cache'),
    XDG_STATE_HOME: path.join(tmp, 'state'),
    CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
    MR_CAST_PROCS_SCAN: '0',
    MR_CAST_NO_UPDATE_CHECK: '1',
  };
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  return { tmp, repo, git, write, run, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const lines = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n');

/** A repo with a base commit and a branch of two commits that change source, tests, docs and a rename. */
function branchRepo() {
  const t = setup();
  t.write('src/price.js', 'export function total(items) {\n  return items.length;\n}\n');
  t.write('src/caller.js', "import { total } from './price.js';\nexport const n = total([]);\n");
  t.write('src/old-name.js', `${lines(12, 'const k')}\n`);
  t.write('src/untested.js', 'export function lonely() {\n  return 1;\n}\n');
  t.git('add', '.');
  t.git('commit', '-q', '-m', 'base');
  t.git('checkout', '-q', '-b', 'feature');
  t.write('src/price.js', 'export function total(items) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
  t.write('src/untested.js', 'export function lonely() {\n  return 2;\n}\n');
  t.write('src/fresh.js', 'export function brandNew() {\n  return 1;\n}\n');
  t.write(
    'test/price.test.mjs',
    "import { total } from '../src/price.js';\ndescribe('total', () => {\ntest('adds the items up', () => total([1]));\n});\n",
  );
  t.git('add', '.');
  t.git('commit', '-q', '-m', 'Sum the items', '-m', 'Counting items gave the wrong total for priced items.');
  t.git('mv', 'src/old-name.js', 'src/new-name.js');
  t.write('README.md', '# readme\n');
  t.git('add', '.');
  t.git('commit', '-q', '-m', 'Rename a file');
  return t;
}

const mapOf = (t) => JSON.parse(fs.readFileSync(path.join(t.repo, '.mr-cast', 'feature', 'map.json'), 'utf8'));

test('the map prints commit subjects and bodies, oldest first, and map.json holds them', () => {
  const t = branchRepo();
  try {
    const r = t.run('extract', 'main');
    assert.equal(r.status, 0, r.stderr);
    const { stdout } = r;
    assert.ok(stdout.indexOf('Sum the items') < stdout.indexOf('Rename a file'));
    assert.match(stdout, /Counting items gave the wrong total/);
    assert.ok(stdout.indexOf('change map') < stdout.indexOf('mr-cast: feature vs main'));
    assert.deepEqual(
      mapOf(t).commits.map((c) => c.subject),
      ['Sum the items', 'Rename a file'],
    );
  } finally {
    t.done();
  }
});

test('files are sorted into kinds, modified source apart from new, and a pure rename is routine', () => {
  const t = branchRepo();
  try {
    t.run('extract', 'main');
    const { files } = mapOf(t);
    const names = (k) => files[k].map((f) => f.file);
    assert.deepEqual(names('source').sort(), ['src/fresh.js', 'src/price.js', 'src/untested.js']);
    assert.equal(files.source.find((f) => f.file === 'src/fresh.js').status, 'new');
    assert.equal(files.source.find((f) => f.file === 'src/price.js').status, 'modified');
    assert.deepEqual(names('tests'), ['test/price.test.mjs']);
    assert.deepEqual(names('docs'), ['README.md']);
    assert.deepEqual(names('routine'), ['src/new-name.js']);
    assert.deepEqual(files.routine[0].hunkIds, []);
    const out = t.run('map').stdout;
    assert.match(out, /source, existing code changed/);
    assert.match(out, /source, new files/);
  } finally {
    t.done();
  }
});

test('a test file is tied to the source it imports, and untouched-by-tests source is listed', () => {
  const t = branchRepo();
  try {
    const map = (t.run('extract', 'main'), mapOf(t));
    assert.deepEqual(map.tests[0].covers, ['src/price.js']);
    assert.deepEqual(map.tests[0].adds, ['adds the items up']);
    assert.deepEqual(map.tests[0].groups, ['total']);
    assert.match(t.run('map').stdout, /groups, not counted as tests: "total"/);
    assert.deepEqual(map.untested.sort(), ['src/fresh.js', 'src/untested.js']);
    assert.match(
      t.run('map').stdout,
      /no changed test file names these; a test may still reach them, so read the tests before saying a file is untested: .*src\/untested\.js/,
    );
  } finally {
    t.done();
  }
});

test('"used elsewhere" finds a caller outside the diff and ignores files in the diff', () => {
  const t = setup();
  try {
    t.write('src/lib.js', 'export function computeTotal(items) {\n  return 1;\n}\n');
    t.write('src/user.js', "import { computeTotal } from './lib.js';\ncomputeTotal([]);\n");
    t.write('src/sibling.js', 'export const x = 1;\n');
    t.git('add', '.');
    t.git('commit', '-q', '-m', 'base');
    t.git('checkout', '-q', '-b', 'feature');
    t.write('src/lib.js', 'export function computeTotal(items) {\n  return 2;\n}\n');
    t.write('src/sibling.js', "import { computeTotal } from './lib.js';\nexport const x = computeTotal([]);\n");
    t.git('add', '.');
    t.git('commit', '-q', '-m', 'change');
    assert.equal(t.run('extract', 'main').status, 0);
    const hit = mapOf(t).usedElsewhere.names.find((n) => n.name === 'computeTotal');
    assert.equal(hit.count, 1);
    assert.deepEqual(hit.paths, ['src/user.js']);
    assert.match(t.run('map').stdout, /text search/);
  } finally {
    t.done();
  }
});

test('a diff over 600 changed lines prints each hunk short, and `hunk` prints it in full', () => {
  const t = setup();
  try {
    t.write('src/a.js', 'export const a = 1;\n');
    t.git('add', '.');
    t.git('commit', '-q', '-m', 'base');
    t.git('checkout', '-q', '-b', 'feature');
    t.write('src/big.js', `${lines(700, 'const line')}\n`);
    t.git('add', '.');
    t.git('commit', '-q', '-m', 'big');
    const r = t.run('extract', 'main');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /`mr-cast hunk <id>\.\.\.` prints hunks in full/);
    assert.match(r.stdout, /… 698 more/);
    const full = t.run('hunk', 'h1');
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /\+ 700 const line699/);
    assert.equal(full.stdout.split('\n').filter((l) => l.includes('const line')).length, 700);
    const bad = t.run('hunk', 'h99');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /no hunk h99/);
  } finally {
    t.done();
  }
});

test('a small diff keeps the usual index and no switch note', () => {
  const t = branchRepo();
  try {
    const r = t.run('extract', 'main');
    assert.doesNotMatch(r.stdout, /large diff/);
    // source is indexed before tests, tests before docs
    const at = (s) => r.stdout.indexOf(`\n${s} [`);
    assert.ok(at('src/price.js') < at('test/price.test.mjs'));
    assert.ok(at('test/price.test.mjs') < at('README.md'));
  } finally {
    t.done();
  }
});

test('--description puts the merge request text in the map', () => {
  const t = branchRepo();
  try {
    t.write('pr.txt', 'Fix totals\n\nReviewers asked for correct sums.\n');
    const r = t.run('extract', 'main', '--description', 'pr.txt');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Reviewers asked for correct sums/);
    assert.match(mapOf(t).description.text, /^Fix totals/);
    const missing = t.run('extract', 'main', '--description', 'nope.txt');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /cannot read the description file/);
  } finally {
    t.done();
  }
});
