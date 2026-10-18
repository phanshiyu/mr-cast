# mr-cast

- Record each big decision as an ADR in docs/adr/ before or with the change that makes it; supersede rather than edit an accepted ADR.
- Every commit must pass `pnpm check` (typecheck, lint, format check and fallow); run `pnpm format` to fix formatting.
- Commits are small, with a plain-prose subject, and end with the model's line, such as `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit an MP4 (for example `examples/explain-webhooks.mp4`). Stills and storyboards are fine.
- Never `npm publish` locally. npm publishes only from `.github/workflows/publish.yml` (see docs/adr/0012-publish-from-ci.md).
- Run every `mr-cast` command in tests and evals with a temporary `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR` (and `XDG_CACHE_HOME` where it fits; `quality/shim.sh` does this), so nothing touches `~/.config/mr-cast`, `~/.claude` or `~/.cache/mr-cast`. Tests also set a temporary `XDG_STATE_HOME`, since play, plan, render and the voice children record themselves in `~/.local/state/mr-cast/procs`, and `MR_CAST_PROCS_SCAN=0`, since the scan for unregistered processes sees every mr-cast on the machine, other agents' included. A test stops only pids it started, and never runs `stop all`, `--idle`, `--older-than`, a run name, or a `stop` option from a menu for real.
