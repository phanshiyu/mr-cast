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
  assert.deepEqual(writers, ['release', 'upload']);
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
  assert.match(jobs['dependency-plan'], /persist-credentials: false/);
});

test('the push job holds no token permission, reads only the deploy key, checks nothing out, and ssh trusts only GitHub', () => {
  const push = jobs['dependency-push'];
  assert.match(push, /\n {4}permissions: \{\}\n/);
  assert.doesNotMatch(push, /contents: write|id-token|GH_TOKEN|github\.token|actions\/checkout@/);
  assert.deepEqual(
    [...push.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]),
    ['RELEASE_PUSH_KEY'],
  );
  assert.match(push, /environment: prod/);
  assert.match(push, /git@github\.com:\$\{GITHUB_REPOSITORY\}\.git/);
  assert.match(push, /IdentitiesOnly=yes/);
  assert.match(push, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(push, /StrictHostKeyChecking=no|ssh-keyscan/);
  assert.match(push, /chmod 600/);
  assert.match(push, /if: always\(\)\n\s+run: rm -f .*release_key/);
  assert.doesNotMatch(push, /echo "?\$RELEASE_PUSH_KEY|cat .*release_key/);
});

test('only the publish job publishes to npm, so a release pushed by the dependency jobs is published once', () => {
  const publishers = Object.entries(jobs)
    .filter(([, text]) => /npm publish/.test(text))
    .map(([name]) => name);
  assert.deepEqual(publishers, ['publish']);
  assert.equal(jobs.publish.match(/id-token: write/g).length, 1);
  assert.equal(workflow.match(/id-token: write/g).length, 1);
  assert.doesNotMatch(workflow, /^\s+tags:/m);
});

test('the dependency jobs run only on main, and the publish job still runs on a bare manual start', () => {
  assert.match(jobs['dependency-plan'], /github\.ref == 'refs\/heads\/main'/);
  assert.match(
    jobs['dependency-plan'],
    /contains\(github\.event\.workflow_run\.head_commit\.message, '\[SECURITY\]'\)/,
  );
  assert.match(jobs.publish, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
});

const workflowDir = new URL('../.github/workflows/', import.meta.url);
const uncachedSetup = fs.readFileSync(new URL('../.github/actions/setup-uncached/action.yml', import.meta.url), 'utf8');
const hasCache = (text) => /actions\/cache(\/\w+)?@|^\s+cache(-dependency-path)?:|package-manager-cache/m.test(text);

test('no job that can write, publish or hold an id-token restores or saves a cache, through the setup action too', () => {
  // CodeQL reads a cache option anywhere in a composite action as a cache a privileged job can poison, so the jobs
  // here call a setup action that has none; ../setup (with the pnpm store cached) is for CI's unprivileged jobs.
  assert.equal(hasCache(uncachedSetup), false);
  const cachedSetup = fs.readFileSync(new URL('../.github/actions/setup/action.yml', import.meta.url), 'utf8');
  assert.match(cachedSetup, /actions\/cache\/restore@/);
  // Only a push to main saves the store, after pruning it; a pull request restores and never saves.
  assert.match(cachedSetup, /pnpm store prune/);
  assert.match(
    cachedSetup,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[^\n]*\n\s+uses: actions\/cache\/save@/,
  );
  const privileged = Object.entries(jobs).filter(([, text]) => /(contents|id-token): write|secrets\./.test(text));
  assert.ok(privileged.length >= 4);
  for (const [name, text] of privileged) {
    assert.equal(hasCache(text), false, `${name} restores or saves a cache`);
    assert.doesNotMatch(text, /uses: \.\/\.github\/actions\/setup\n/, `${name} calls the setup action that caches`);
  }
});

test('no job in the publish workflow restores or saves a cache, because jobs run a ref a manual start can name', () => {
  assert.equal(hasCache(workflow), false);
  assert.doesNotMatch(workflow, /uses: \.\/\.github\/actions\/setup\n/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-uncached\n/);
});

test('the render job checks out the head of main as the event gives it, then moves only to a commit on main', () => {
  assert.doesNotMatch(jobs.render, /^\s+ref:/m);
  assert.match(jobs.render, /git merge-base --is-ancestor "\$SHA" origin\/main/);
  assert.ok(jobs.render.indexOf('merge-base') < jobs.render.indexOf('setup-uncached'));
});

test('a manual start publishes only from main, and no run step interpolates an expression', () => {
  assert.match(
    jobs.publish,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && !inputs\.dependencies/,
  );
  for (const file of ['publish.yml', 'ci.yml', 'audit.yml']) {
    const text = fs.readFileSync(new URL(file, workflowDir), 'utf8');
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
