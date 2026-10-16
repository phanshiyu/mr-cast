# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue. Fixes go into the latest release only, so upgrade with `mr-cast upgrade` to get them.

## Dependencies

- CI runs `pnpm audit --audit-level moderate` on every push and pull request, and audits a plain `npm install` of the packed tarball, which is what users get.
- Renovate keeps dependencies, Node and pnpm current. It waits 3 days after a release before it proposes it, except for security fixes, which it proposes at once. Minor and patch updates, lockfile maintenance and action digests merge themselves once the `ci-ok` check passes. Major updates wait for a review.
- Dependency install scripts do not run: `pnpm-workspace.yaml` denies them (`allowBuilds`), and npm 11.19 and later skip them for users. mr-cast needs none of them.
- `bin/lib/kokoro/` is vendored from kokoro-js 1.2.1 (Apache-2.0), which pinned a vulnerable `@huggingface/transformers` 3. Its README says what changed.

## Setting up Renovate

Renovate runs from `.github/workflows/renovate.yml` every 4 hours and on demand from the Actions tab. Until it has a token, each run is skipped with a notice. Pull requests opened with the workflow's own `GITHUB_TOKEN` would never start CI, so Renovate needs a token of its own. Use a GitHub App (preferred) or a fine-grained personal access token.

### Option A: GitHub App

1. Open **Settings → Developer settings → GitHub Apps → New GitHub App**. Name it, for example, `mr-cast-renovate`. Set any homepage URL, and clear **Webhook → Active**.
2. Under **Repository permissions**, set:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Issues**: Read and write (the dependency dashboard)
   - **Workflows**: Read and write (to update pinned actions in `.github/workflows`)
   - **Commit statuses**: Read and write
   - **Checks**: Read-only
   - **Dependabot alerts**: Read-only (security updates)
   - **Administration**: Read-only (lets Renovate see that auto-merge is allowed)
   - **Metadata**: Read-only (set automatically)
3. Under **Where can this GitHub App be installed?**, choose **Only on this account**, then **Create GitHub App**.
4. Note the **App ID**. Under **Private keys**, choose **Generate a private key**, which downloads a `.pem` file.
5. Choose **Install App**, then install it on **Only select repositories → phanshiyu/mr-cast**.
6. In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `RENOVATE_APP_ID`: the App ID
   - `RENOVATE_APP_PRIVATE_KEY`: the whole content of the `.pem` file

### Option B: fine-grained personal access token

1. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set **Repository access** to **Only select repositories → phanshiyu/mr-cast**, and an expiry you will renew.
3. Under **Repository permissions**, set **Contents**, **Pull requests**, **Issues**, **Workflows** and **Commit statuses** to Read and write, and **Dependabot alerts** and **Administration** to Read-only.
4. Add the token as the repository secret `RENOVATE_TOKEN`.

The workflow uses the App when both App secrets exist, and the token otherwise. Pull requests opened with a personal token show you as their author.

### Repository settings for auto-merge

1. **Settings → General → Pull Requests**: select **Allow auto-merge**. Optionally also select **Automatically delete head branches**.
2. **Settings → Rules → Rulesets → New ruleset → New branch ruleset**:
   - Name it `main`, set **Enforcement status** to **Active**, and under **Target branches** choose **Add target → Include default branch**.
   - Under **Bypass list**, choose **Add bypass → Repository admin**, so that your own pushes to `main` still go through.
   - Select **Require status checks to pass**, choose **Add checks**, and add `ci-ok`. It passes only when every CI job passes. The check appears in the list after CI has run once.
   - Leave **Require a pull request before merging** cleared. Auto-merge needs only the required check.
   - Choose **Create**.
3. Run the workflow once from **Actions → Renovate → Run workflow**. It opens the **Dependency Dashboard** issue and the first pull requests.
