# 41. Release dependency updates from CI when users would get something new

- Status: Accepted
- Date: 2026-11-15

## Context

[ADR 12](0012-publish-from-ci.md) publishes when `package.json` holds a version npm does not have. A person bumps the
version. Renovate's updates merge to main by themselves, so a security fix in a package that ships with mr-cast reached
main and then waited for a person to remember to bump and release. Users of the npm package kept the old, vulnerable
version meanwhile.

Not every update changes what users get. The package ships `bin/`, `src/`, `shared/`, the built player in `dist/`, and
the packages named in `dependencies`. Linting, formatting, type and test tools never reach a user.

## Decision

`.github/workflows/publish.yml` gets a second way to run, the `dependency-*` jobs. They run:

- after CI passes on a push to main whose head commit message contains `[SECURITY]`, which is how Renovate marks a
  security update. The whole message is matched, because a squash-merge puts the pull request number after the title;
- every Monday at 03:17 UTC, after Renovate's lock file maintenance has merged;
- when started by hand with "dependencies" ticked. Started by hand without it, the workflow does what it did before.

It releases only when all of these hold:

- the head of main is not a release commit and is not already tagged, so a release never starts another;
- the latest `v*` tag is behind the head and equals the version in `package.json`, so a version bump that a person
  made and has not published is left to the existing publish job;
- the CI workflow succeeded on the head commit, which is the same gate as a tag release;
- a shipped package changed between `pnpm-lock.yaml` at that tag and now. `scripts/dependency-release.mjs` decides.
  Shipped means the runtime `dependencies`, the dev dependencies the player build bundles (only `tailwindcss`, whose CSS
  Vite writes into `dist/`; a test fails when shipped code imports another), and everything they depend on in the lock
  file. `@types/*` packages are skipped, since they never run. A change to lint, format, type or test tools never releases.

The workflow `publish.yml` makes the release in one run, in three jobs, so that the job that runs the repository's code
holds no write access. A compromised dependency, the very thing an update may bring, then cannot push to main.

1. `dependency-plan` (read-only) decides as above, raises the patch version (the `version` line of `package.json` only,
   so no lock file changes; `npm version` would add its own), adds a changelog entry that lists the packages that
   changed, installs, builds and packs. It hands the tarball, `package.json` and `CHANGELOG.md` on as an artifact.
2. `dependency-push` (`contents: write`) checks nothing out and runs nothing from the repository. It fetches the
   planned head of main, takes the two files, refuses anything but one changed version line and added changelog lines,
   commits as `github-actions[bot]`, tags `vX.Y.Z`, and pushes both in one atomic push. It is refused if main moved.
3. `dependency-release` (`id-token: write`, the `prod` environment) publishes the tarball with trusted publishing.

It is one run because a commit or tag pushed with the workflow's token starts no other workflow, so nothing else would
publish it. The release job, the six render shards and the upload job then run for the new version as for any release.

The `publish` job keeps `contents: read`. `dependency-plan` shares the `publish` concurrency group, queued and never
cancelled. GitHub keeps only the newest queued run, which is enough, because each run decides from the head of main and
the atomic push fails when another release got there first. `test/publish-workflow.test.mjs` checks that no job that
checks out the repository can write to it, and runs the plan's decision against a throwaway repository.

The release commit is pushed straight to main, and the ruleset requires `ci-ok` there. The release commit gets no CI run
of its own (the token starts none), so the repository owner must let this workflow past that one rule. The ruleset
keeps the rule for everyone else. See CONTRIBUTING.md.

## Consequences

Good:
- A security fix, or a week of ordinary updates to shipped packages, reaches npm without a person.
- The changelog says what changed in each such release.
- Tool updates stay quiet.

Bad:
- A release commit has not had a CI run of its own. It differs from the commit CI passed on only in the version line
  and the changelog.
- The push comes before the publish, so that npm never holds a version that is missing from main. If the push succeeds
  and the publish fails, main holds a version npm lacks. The next CI success on main runs the
  existing publish job, which publishes it.
- A security fix that merges while CI on a newer commit is still running waits for the next Monday, because a run
  releases only from a head commit that CI has passed.
- The workflow's token bypasses a required check on main. It can only be used by a job that has `contents: write`, and
  only `dependency-push` has it, a job that runs no code from the repository.

## Alternatives considered

- Release on every dependency update: a release for every tool bump, and many for a busy week.
- Release only by hand, as before: the vulnerable version stays on npm until someone remembers.
- Open a pull request for the bump and merge it: a pull request opened with the workflow's token starts no CI, so
  `ci-ok` would never pass, and a token that does start CI is a stored secret.
- Tag only, and publish from the tag in a second workflow: a tag pushed with the workflow's token starts no workflow,
  and trusted publishing is bound to `publish.yml`.

## Amended: no cache in the publish workflow, and a manual start only from main

CodeQL reported cache poisoning in `publish.yml`: a job that checks out a ref and then restores or saves a cache can
leave a poisoned entry that a later run on main restores. The publish workflow now restores and saves no cache at all.
The setup action has a `cache` input (default `'true'`, which CI keeps), every job here passes `'false'`, and the render
job no longer caches the Chrome download or the voice model, so each shard downloads them. A manual start of the
publish job now runs only from main, so a dispatch cannot publish a branch. The jobs that publish or push also no longer
put job outputs into scripts: they pass them through `env`. `test/publish-workflow.test.mjs` holds these rules.
