---
name: mr-cast-upgrade
description: Update mr-cast to the latest version and refresh its Claude Code skills. Use when the user asks to upgrade or update mr-cast, asks which version is installed or whether a new one is out, or after an mr-cast command printed "mr-cast <version> is available" and the user wants it.
---

# mr-cast upgrade

The CLI is `{{MR_CAST}}/bin/mr-cast`. The wrapper finds a working Node itself, so call it directly rather than through `node`.

## 1. Check

```bash
{{MR_CAST}}/bin/mr-cast upgrade --check
```

It prints the installed version and the latest version on npm, then what `upgrade` would do: run `npm install -g` (or `pnpm add -g` for a pnpm install), print the steps for a git clone, or print the npm command for an install it cannot update itself. If it cannot reach npm, tell the user and stop.

Tell the user the installed and latest versions. If a newer version is out, point them to https://github.com/phanshiyu/mr-cast/blob/main/CHANGELOG.md for what changed. If they have the latest version, say so and stop.

## 2. Upgrade

If the user did not already ask to upgrade, ask them before you continue. Then run:

```bash
{{MR_CAST}}/bin/mr-cast upgrade
```

- For an `npm install -g` install, it runs `npm install -g @shiyuphan/mr-cast@latest` (for a `pnpm add -g` install, `pnpm add -g @shiyuphan/mr-cast@latest`) and reinstalls the skills from the new version. npm usually installs it at the same path. If `{{MR_CAST}}/bin/mr-cast` is gone afterwards, use `mr-cast` on PATH.
- For a git clone or another kind of install, it prints the commands to run instead. Show them to the user, and run them only if the user asks you to.
- If npm fails with a permissions error, the command explains how to fix the npm prefix. Pass that on. Do not run `sudo` yourself.

Report the result. When the version changed, tell the user to start a new Claude Code session so the new and renamed skills load.
