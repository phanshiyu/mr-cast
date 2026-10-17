# 12. Publish to npm only from CI, with trusted publishing

- Status: Accepted
- Date: 2026-10-16

## Context

mr-cast ships as `@shiyuphan/mr-cast` on npm. A publish from a laptop depends on whose machine and whose token, and
skips the checks CI runs. A token publish from CI also failed: npm restricts tokens that bypass 2FA, so it failed with
EOTP (commit d9d3bfc).

## Decision

- `.github/workflows/publish.yml` publishes after the CI workflow passes on a push to main, when `package.json` holds a
  version npm does not have yet. It can also be started by hand (`workflow_dispatch`) (CHANGELOG 0.18.1).
- It uses npm trusted publishing: npm checks the run's GitHub OIDC identity against the package's trusted publisher, so
  no token is stored, and the release gets a provenance statement. The job runs in the `prod` environment, which the
  trusted publisher names, with `id-token: write`.
- A release is a version bump in `package.json`, a "Release x.y.z" commit and a `vx.y.z` tag (tags run from v0.2.0
  to v0.22.0). The tag marks the release; the push to main with the new version is what triggers the publish.
- Nobody publishes locally. The builder briefs for every feature say "no publish".

## Consequences

Good:
- Every published version passed typecheck, unit tests on Node 22, 24 and 26, validate on every example, `pnpm audit`, a
  render smoke and an npm install of the packed tarball (.github/workflows/ci.yml).
- No long-lived npm token exists to leak.

Bad:
- A publish waits for the full CI run.
- A version bump merged to main publishes; there is no separate approval beyond the `prod` environment's rules.

## Alternatives considered

- A token stored as a secret: failed with EOTP under npm's 2FA rules, and is a secret to rotate.
- Publish on a pushed version tag: not what the workflow does today; the trigger is CI success on main with a new
  version.
- Local `npm publish`: no provenance, and skips CI.
