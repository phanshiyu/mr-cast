import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workflow = fs.readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
/** Each job's text, by name: the lines from "  name:" under jobs to the next job. */
const jobs = Object.fromEntries(
  workflow
    .slice(workflow.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/)
    .slice(1)
    .map((text) => [text.match(/^ {2}([\w-]+):/)[1], text]),
);

test('no publish job that checks out the repository can write to it', () => {
  const writers = Object.entries(jobs)
    .filter(([, text]) => /contents: write/.test(text))
    .map(([name]) => name);
  const checkouts = Object.entries(jobs)
    .filter(([, text]) => /actions\/checkout@/.test(text))
    .map(([name]) => name);
  assert.deepEqual(writers, ['dependency-push', 'release', 'upload']);
  assert.deepEqual(
    checkouts.filter((name) => writers.includes(name)),
    [],
  );
});

test('the job that pushes a dependency release runs nothing from the repository', () => {
  const push = jobs['dependency-push'];
  assert.doesNotMatch(push, /uses: \.\//);
  assert.doesNotMatch(push, /\bpnpm\b|\bnpm (install|ci|run)\b|\bnode\b/);
  assert.doesNotMatch(jobs['dependency-plan'], /contents: write|id-token: write/);
  assert.doesNotMatch(jobs['dependency-release'], /contents: write/);
  assert.match(jobs['dependency-plan'], /persist-credentials: false/);
});

test('the dependency jobs run only on main, and the publish job still runs on a bare manual start', () => {
  assert.match(jobs['dependency-plan'], /github\.ref == 'refs\/heads\/main'/);
  assert.match(
    jobs['dependency-plan'],
    /contains\(github\.event\.workflow_run\.head_commit\.message, '\[SECURITY\]'\)/,
  );
  assert.match(jobs.publish, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
});

const setupAction = fs.readFileSync(new URL('../.github/actions/setup/action.yml', import.meta.url), 'utf8');

test('no job that can write, publish or hold an id-token restores or saves a cache, through the setup action too', () => {
  // The setup action caches the pnpm store unless told not to, so a job that calls it must pass cache: 'false'.
  assert.match(setupAction, /cache: \$\{\{ inputs\.cache == 'true' \}\}/);
  assert.match(setupAction, /inputs:[\s\S]*\n {2}cache:\n[\s\S]*default: 'true'/);
  assert.doesNotMatch(setupAction, /actions\/cache/);
  const privileged = Object.entries(jobs).filter(([, text]) => /(contents|id-token): write/.test(text));
  assert.ok(privileged.length >= 4);
  for (const [name, text] of privileged) {
    assert.doesNotMatch(text, /actions\/cache(\/\w+)?@/, `${name} uses actions/cache`);
    assert.doesNotMatch(text, /^\s+cache:\s*(?!'false')\S/m, `${name} turns on a cache option`);
    assert.doesNotMatch(text, /cache-dependency-path|package-manager-cache/, `${name} configures a cache`);
    for (const use of text.split(/\n(?=\s+- )/).filter((step) => /uses: \.\/\.github\/actions\/setup/.test(step))) {
      assert.match(use, /cache: 'false'/, `${name} calls the setup action with its cache on`);
    }
  }
});

test('no job in the publish workflow, checked out from a ref it was handed, restores or saves a cache', () => {
  // Jobs run code from a ref that a manual start names, so a poisoned cache entry would reach the next run on main.
  assert.doesNotMatch(workflow, /actions\/cache(\/\w+)?@/);
  for (const use of workflow.split(/\n(?=\s+- )/).filter((step) => /uses: \.\/\.github\/actions\/setup/.test(step))) {
    assert.match(use, /cache: 'false'/);
  }
});

test('a manual start publishes only from main, and no run step interpolates an expression', () => {
  assert.match(
    jobs.publish,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && !inputs\.dependencies/,
  );
  for (const file of ['publish.yml', 'ci.yml', 'audit.yml']) {
    const text = fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    const runs = text.match(/^ +(?:- )?run: (?:\|\n(?: {8,}.*\n?|\n)+|.*)/gm) ?? [];
    assert.ok(runs.length > 0);
    for (const run of runs) {
      // The few expressions allowed in a script are the build's own matrix and runner paths, never event data.
      const bad = (run.match(/\$\{\{[^}]*\}\}/g) ?? []).filter(
        (e) => !/^\$\{\{ *(matrix\.node|runner\.temp) *\}\}$/.test(e),
      );
      assert.deepEqual(bad, [], `${file}: ${run.slice(0, 60)}`);
    }
  }
});

const lockFile = (foo, eslint) => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      foo:
        specifier: ${foo}
        version: ${foo}
    devDependencies:
      eslint:
        specifier: ${eslint}
        version: ${eslint}

snapshots:

  foo@${foo}: {}

  eslint@${eslint}: {}
`;

/**
 * The plan job's gate, run in a throwaway repository whose tag v1.0.0 holds foo 1.0.0 and eslint 9.0.0, with a `gh` that
 * says whether CI passed and an `npm` that says whether the next version is already on npm.
 */
function gate({
  foo = '1.0.0',
  eslint = '9.0.0',
  subject = 'Update dependency',
  version = '1.0.0',
  green = true,
  tagHead = false,
  onNpm = false,
}) {
  const script = jobs['dependency-plan']
    .match(/id: gate\n\s+env:\n(?: {10}.*\n)+\s+run: \|\n((?: {10}.*\n?)+)/)[1]
    .replace(/^ {10}/gm, '');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-gate-')));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
    for (const file of [
      'scripts/dependency-release.mjs',
      'scripts/lib/dependency-release.mjs',
      'scripts/lib/pnpm-lock.mjs',
    ]) {
      fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(repo, file));
    }
    const manifest = (v) =>
      JSON.stringify({ name: 'pkg', version: v, type: 'module', dependencies: { foo: '1.0.0' } }, null, 2);
    const git = (...args) => {
      const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
    };
    git('init', '-q');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'a');
    fs.writeFileSync(path.join(repo, 'package.json'), manifest('1.0.0'));
    fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), lockFile('1.0.0', '9.0.0'));
    git('add', '.');
    git('commit', '-q', '-m', 'Release 1.0.0');
    git('tag', 'v1.0.0');
    if (!tagHead) {
      fs.writeFileSync(path.join(repo, 'package.json'), manifest(version));
      fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), lockFile(foo, eslint));
      git('commit', '-q', '--allow-empty', '-am', subject);
    }
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho ${green ? 1 : 0}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\nexit ${onNpm ? 0 : 1}\n`, { mode: 0o755 });
    const out = path.join(dir, 'out');
    const res = spawnSync('bash', ['-e', '-c', script], {
      cwd: repo,
      env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, RUNNER_TEMP: dir, GH_REPO: 'o/r' },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    return { output: fs.readFileSync(out, 'utf8').trim().split('\n'), head };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a shipped package that moved since the tag makes a release from the head commit', () => {
  const { output, head } = gate({ foo: '1.0.1' });
  assert.ok(output.includes('release=true') && output.includes('version=1.0.1') && output.includes(`base=${head}`));
});

test('no release when nothing that ships changed, however much else did', () => {
  assert.deepEqual(gate({ eslint: '9.5.0' }).output, ['release=false']);
  assert.deepEqual(gate({}).output, ['release=false']);
});

test('no release from a release commit, a tagged head, a pending version bump, red CI, or a version npm has', () => {
  assert.deepEqual(gate({ foo: '1.0.1', subject: 'Release 1.0.1' }).output, ['release=false']);
  assert.deepEqual(gate({ tagHead: true }).output, ['release=false']);
  assert.deepEqual(gate({ foo: '1.0.1', version: '1.1.0' }).output, ['release=false']);
  assert.deepEqual(gate({ foo: '1.0.1', green: false }).output, ['release=false']);
  assert.deepEqual(gate({ foo: '1.0.1', onNpm: true }).output, ['release=false']);
});

/** The release job's decision, run with a `gh` that answers `release view` from `state`: none, draft or published. */
function decide({ published, dispatched, state }) {
  const script = jobs.release.match(/- id: draft\n\s+run: \|\n((?: {10}.*\n?)+)/)[1].replace(/^ {10}/gm, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-release-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'gh'),
      `#!/bin/sh
echo "gh $*" >> "${dir}/calls"
if [ "$1 $2" = "release view" ]; then
  case "${state}" in none) exit 1 ;; draft) echo true ;; *) echo false ;; esac
fi
`,
      { mode: 0o755 },
    );
    const out = path.join(dir, 'out');
    const res = spawnSync('bash', ['-e', '-c', script], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: out,
        TAG: 'v1.2.3',
        SHA: 'abc',
        GH_REPO: 'o/r',
        PUBLISHED: String(published),
        DISPATCHED: String(dispatched),
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const calls = fs.existsSync(path.join(dir, 'calls'))
      ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n')
      : [];
    return {
      output: fs.readFileSync(out, 'utf8').trim(),
      created: calls.some((c) => c.startsWith('gh release create v1.2.3 --draft')),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a publish run renders the release when it published the version, was started by hand, or finds a draft', () => {
  assert.deepEqual(decide({ published: true, dispatched: false, state: 'none' }), {
    output: 'render=true',
    created: true,
  });
  assert.deepEqual(decide({ published: false, dispatched: true, state: 'published' }), {
    output: 'render=true',
    created: false,
  });
  // "Re-run all jobs" after a failed shard: the version is on npm and its release is still a draft.
  assert.deepEqual(decide({ published: false, dispatched: false, state: 'draft' }), {
    output: 'render=true',
    created: false,
  });
  assert.deepEqual(decide({ published: false, dispatched: false, state: 'published' }), {
    output: 'render=false',
    created: false,
  });
});
