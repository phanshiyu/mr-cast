# 40. An advisory on main must not block the pull request that fixes it

- Status: Accepted
- Date: 2026-11-15

## Context

`main` requires the status check `ci-ok` (ruleset 25329911), and `ci-ok` passes only when every CI job passes. Two jobs
ran an audit that fails on any advisory of moderate severity or worse: "Dependency audit" (`pnpm audit`) and the audit
step of "Pack and install with npm" (`npm audit`). When a new advisory was published for a package mr-cast already
used (zod, through Remotion, and fast-uri), both jobs failed on every pull request, so `ci-ok` failed, so nothing could
merge. That includes the Renovate pull requests that fix the advisory. Eleven of them sat open with auto-merge on and
every other check green.

An advisory that already sits on main is not something a pull request did. A rule that blocks the pull request for it
turns a published advisory into a lock on the repository.

## Decision

- The audits in CI compare the pull request with its base. They fail only on an advisory, of moderate severity or
  worse, that the head has and the base does not. `scripts/audit-new.mjs` does the comparison for both `pnpm audit
  --json` and `npm audit --json`. A pull request that fixes an advisory, or touches nothing, passes. A pull request that
  makes a package newly vulnerable fails.
- The base is the pull request's base commit, or on a push the commit it replaced. For the npm install test the base's
  tree is the install of the dependencies in the base's `package.json`, since that is what npm resolves from. The
  `package` job keeps its install test of the packed tarball.
- An audit that did not run (no JSON, or an error from the registry) fails the job. It never reads as a clean tree.
- main itself is audited by `.github/workflows/audit.yml`, every day and on every push to main. It is not part of
  `ci-ok`. It fails loudly when main has an advisory, and opens one issue that lists them, updates it, and closes it
  when main is clean. A scheduled run that cannot reach the registry fails without touching the issue.
- Renovate's vulnerability alerts open the fix. Its update rules already merge a minor or patch fix by itself once
  `ci-ok` passes, and the fix now can.
- `rebaseWhen` is `behind-base-branch` in `renovate.json`. A pull request's checks run on the workflows of the commit
  they ran on, and a re-run of an old run uses the old workflows. When this change lands, the open pull requests are
  behind main, Renovate rebases them, and they run the new audit.

## Consequences

Good:
- An advisory on main shows in an issue and a red daily run, but it blocks nobody. The fix merges itself.
- A pull request still cannot add a vulnerable dependency.

Bad:
- A pull request's audit says nothing about advisories already on main, so a person who never opens the issue can ship
  a version with a known advisory. The daily run, the issue and the Renovate alert are what keep it in view, and
  ADR 41 makes a release when the fix merges.
- The base's audit and the head's audit are two calls to the advisory service, so the job takes a little longer.
- An advisory is told apart by its id and its package, so a pull request that bumps a package from one affected
  version to another is judged as the base was, but a second advisory on a package already affected counts as new.

## Alternatives considered

- Take the audits out of `ci-ok` and run them only on a schedule and on pushes to main. It is simpler, but a pull
  request that adds a vulnerable dependency would then merge. The comparison keeps that check.
- Keep the audits as they were and merge the fix by hand as an administrator. It works once and leaves the next
  advisory to lock the repository again.
- Ignore known advisories by id in a list in the repository. The list is another file to keep up to date, and an
  advisory that is not listed still blocks the pull request that fixes it.
