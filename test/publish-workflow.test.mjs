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
