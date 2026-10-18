# mr-cast

- Record each big decision as an ADR in docs/adr/ before or with the change that makes it; supersede rather than edit an accepted ADR.
- Commits are small, with a plain-prose subject, and end with the model's line, such as `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit an MP4 (for example `examples/explain-webhooks.mp4`). Stills and storyboards are fine.
- Never `npm publish` locally. npm publishes only from `.github/workflows/publish.yml` (see docs/adr/0012-publish-from-ci.md).
- Run every `mr-cast` command in tests and evals with a temporary `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR` (and `XDG_CACHE_HOME` where it fits; `quality/shim.sh` does this), so nothing touches `~/.config/mr-cast`, `~/.claude` or `~/.cache/mr-cast`. Tests also set a temporary `XDG_STATE_HOME`, since play, plan, render and the voice children record themselves in `~/.local/state/mr-cast/procs`, and never run a `stop` option from a menu: `stop all` reaches every mr-cast process on the machine.
