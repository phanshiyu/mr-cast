# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue. Fixes go into the latest release only, so upgrade with `mr-cast upgrade` to get them.

## Dependencies

- CI runs `pnpm audit --audit-level moderate` on every push and pull request, and audits a plain `npm install` of the packed tarball, which is what users get.
- Renovate keeps dependencies, Node and pnpm current. It waits 3 days after a release before it proposes it, except for security fixes, which it proposes at once. Minor and patch updates, lockfile maintenance and action digests merge themselves once the `ci-ok` check passes. Major updates wait for a review.
- Dependency install scripts do not run: `pnpm-workspace.yaml` denies them (`allowBuilds`), and npm 11.19 and later skip them for users. mr-cast needs none of them.
- `bin/lib/kokoro/` is vendored from kokoro-js 1.2.1 (Apache-2.0), which pinned a vulnerable `@huggingface/transformers` 3. Its README says what changed.

## Setting up Renovate

Renovate runs as the hosted Renovate GitHub App (github.com/apps/renovate), installed on this repository. It reads `renovate.json` in the repository root, so there is no workflow or token to set up. Its pull requests start CI like any other.

### Repository settings for auto-merge

1. **Settings → General → Pull Requests**: select **Allow auto-merge**. Optionally also select **Automatically delete head branches**.
2. **Settings → Rules → Rulesets → New ruleset → New branch ruleset**:
   - Name it `main`, set **Enforcement status** to **Active**, and under **Target branches** choose **Add target → Include default branch**.
   - Under **Bypass list**, choose **Add bypass → Repository admin**, so that your own pushes to `main` still go through.
   - Select **Require status checks to pass**, choose **Add checks**, and add `ci-ok`. It passes only when every CI job passes. The check appears in the list after CI has run once.
   - Leave **Require a pull request before merging** cleared. Auto-merge needs only the required check.
   - Choose **Create**.
3. The Renovate app opens the **Dependency Dashboard** issue and the first pull requests on its next run. Check its run logs at developer.mend.io.
