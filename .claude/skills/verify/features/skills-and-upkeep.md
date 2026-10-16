# Skills and upkeep

`install-skill` installs the `mr-cast` skill (`SKILL.md` and `references/branch.md` and `references/explanation.md`) and the `mr-cast-prune` and `mr-cast-upgrade` skills into the Claude config dir, and removes what an earlier version installed that this one no longer does, such as 0.11's `mr-cast-review` and `mr-cast-explain` skills and `/mr-cast-render` and `/mr-cast-explain-render` commands. The skills point at this install's `bin/mr-cast`, and the storyboard schema is copied in from `src/types.ts`. A manifest `.mr-cast-install.json` records the version, the root and the files. Any later command reinstalls them when the manifest's root is this package and its version differs. `uninstall-skill` removes what the manifest lists, but keeps files whose content is no longer mr-cast's. `prune` lists and deletes walkthroughs, videos, stills, voice clips and the shared cache. `upgrade` reports the latest npm version and updates an `npm install -g` install. For a git clone it prints the steps instead. Installs that are not git clones print a one-line update notice on stderr when a cached check found a newer version.

## Sub-features

- `install` writes 5 files in 3 skill dirs and the manifest, with no `{{…}}` placeholders left.
- `migrate-0.11` removes exactly 0.11's four files from a 0.11 install and leaves three skills.
- `refresh` reinstalls on the next command after a version change and prints `mr-cast: updated Claude Code skills to <version>`.
- `uninstall` removes the files and the manifest, and keeps a user-edited file with a note.
- `prune-list` lists runs, videos, stills, audio and cache entries with sizes, and supports `--json` and `--older-than`.
- `prune-delete` deletes exactly the given ids and reports `freed <size>`. An unknown id exits 1.
- `upgrade-check` prints the available version and the changelog link, and for a clone says it prints steps.
- `upgrade-clone` prints the `git pull` / `pnpm install` / `pnpm build` / `pnpm install-skill` steps.
- `upgrade-other` tells a copy not installed by `npm install -g` or `pnpm add -g` how to install globally, and changes nothing.
- `upgrade-global` updates an `npm install -g` or `pnpm add -g` install with the same package manager, then reinstalls the skills from the new copy.
- `upgrade-offline` fails with `could not look up the latest version on npm`.
- `update-notice` prints `mr-cast <latest> is available (you have <version>). Run \`mr-cast upgrade\`.` on stderr from a non-clone install.
- `version` prints `mr-cast <version> (node <version>)`.

## How to get to it (user POV)

- Run `mr-cast install-skill`, `mr-cast uninstall-skill`, `mr-cast prune [id...] [--older-than days] [--json]`, `mr-cast upgrade [--check]` and `mr-cast --version`.
- In Claude Code, ask for a video (`/mr-cast`), to free mr-cast disk space (`mr-cast-prune` skill) or to upgrade mr-cast (`mr-cast-upgrade` skill).

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`. `CLAUDE_CONFIG_DIR` is `$RUN/work/claude` (set by `env`), so the user's `~/.claude` is untouched.
- For prune and upgrade, every command carries `XDG_CACHE_HOME=$RUN/work/xdg`, so the real `~/.cache/mr-cast` is neither listed for deletion nor written.
- For prune, the diff walkthrough recipe ran up to **Render silent** and **Voice**, so `.mr-cast/short` has audio and a default-named video.

- **Version.** Run `$V mrc $RUN version -- --version`. Stdout is `mr-cast <package.json version> (node 2x.y.z)`.
- **Install.** Run `$V mrc $RUN install -- install-skill`. Five `wrote $RUN/work/claude/...` lines appear. `cat $CLAUDE_CONFIG_DIR/.mr-cast-install.json` shows the version, `"root": "$REPO"` and 5 files. `ls $CLAUDE_CONFIG_DIR/skills` prints `mr-cast`, `mr-cast-prune` and `mr-cast-upgrade`. `grep -rc '{{' $CLAUDE_CONFIG_DIR/skills` prints 0 for each file, and `grep -m1 -o "$REPO/bin/mr-cast" $CLAUDE_CONFIG_DIR/skills/mr-cast/references/branch.md` matches.
- **Refresh.** Set the manifest's version back, then run any command. Run `sed -i '' 's/"version": "[^"]*"/"version": "0.0.1"/' $CLAUDE_CONFIG_DIR/.mr-cast-install.json && $V mrc $RUN refresh -- --version`. Stderr has `mr-cast: updated Claude Code skills to <version>`, and the manifest's version is current again.
- **Migrate from 0.11.** Install 0.11 into a second config dir from a worktree of the tag, then install this checkout over it. Run `git -C $REPO worktree add --detach $RUN/work/v011 v0.11.0 && ln -s $REPO/node_modules $RUN/work/v011/node_modules && mkdir -p $RUN/work/claude011 && CLAUDE_CONFIG_DIR=$RUN/work/claude011 $RUN/work/v011/bin/mr-cast install-skill && (cd $DEMO && CLAUDE_CONFIG_DIR=$RUN/work/claude011 $MRC install-skill) | tee $EV/migrate.txt`. Call `$MRC` directly here, because `$V mrc` always sets the run's own `CLAUDE_CONFIG_DIR`. The second command prints four `removed …` lines, for `skills/mr-cast-review/SKILL.md`, `skills/mr-cast-explain/SKILL.md`, `commands/mr-cast-render.md` and `commands/mr-cast-explain-render.md`, each `(installed by an earlier mr-cast, no longer used)`. `ls $RUN/work/claude011/skills` prints the three skills. Remove the worktree afterwards with `git -C $REPO worktree remove --force $RUN/work/v011`.
- **Uninstall keeps edits.** Run `echo "user notes" > $CLAUDE_CONFIG_DIR/skills/mr-cast/references/branch.md && $V mrc $RUN uninstall -- uninstall-skill`. Exit 0 with 5 `removed` lines (4 files and the manifest) and `note: kept …/skills/mr-cast/references/branch.md; mr-cast installed this path but its content is not mr-cast's`. `find $CLAUDE_CONFIG_DIR -type f` lists only that file.
- **Harness guard.** Run `$V mrc $RUN prune-guard -- prune cache:bundle` without `XDG_CACHE_HOME`. Exit 1 with `verify: refusing to prune cache:* outside $RUN`. mr-cast never runs.
- **Prune list.** Run `mkdir -p $RUN/work/xdg/mr-cast/bundle/x && echo x > $RUN/work/xdg/mr-cast/bundle/x/f && XDG_CACHE_HOME=$RUN/work/xdg $V mrc $RUN prune-list -- prune`. It prints an `id size age what` table with `run:feature-rate-limit`, `run:short`, `  video:short/short-verify-cut.mp4`, `  audio:short` and `cache:bundle`, then `reclaimable: … · prune with \`mr-cast prune <id>...\``. `XDG_CACHE_HOME=$RUN/work/xdg $V mrc $RUN prune-json -- prune --json` prints JSON whose `cacheDir` is under `$RUN/work/xdg`.
- **Prune delete.** Run `XDG_CACHE_HOME=$RUN/work/xdg $V mrc $RUN prune-delete -- prune video:short/short-verify-cut.mp4 audio:short cache:bundle`. Exit 0 with three `removed` lines and `freed …`. `ls $DEMO/.mr-cast/short` lists only `hunks.json`, `meta.json` and `storyboard.json`, and `$RUN/work/xdg/mr-cast/bundle` is gone.
- **Prune unknown id.** Run `XDG_CACHE_HOME=$RUN/work/xdg $V mrc $RUN prune-bad -- prune nope:id`. Exit 1 and `mr-cast: unknown id: nope:id; run \`mr-cast prune\` to list what can be pruned`.
- **Fake registry.** Start a local registry that answers `9.9.9`. Run `node -e 'require("http").createServer((q,r)=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({version:"9.9.9"}))}).listen(0,"127.0.0.1",function(){console.log(this.address().port)})' > $RUN/work/reg.port & echo $! > $RUN/work/reg.pid; sleep 0.5`. Then set `REG=http://127.0.0.1:$(cat $RUN/work/reg.port)`.
- **Upgrade check (clone).** Run `XDG_CACHE_HOME=$RUN/work/xdg MR_CAST_REGISTRY=$REG $V mrc $RUN upgrade-check -- upgrade --check`. Exit 0 with `mr-cast 9.9.9 is available (you have <version>); changes: https://github.com/phanshiyu/mr-cast/blob/main/CHANGELOG.md` and `this mr-cast is a git clone; \`mr-cast upgrade\` prints the steps to update it`.
- **Upgrade (clone).** Run the same with `upgrade` and no `--check`. It prints `this mr-cast is a git clone; update it with:` and the five steps, and runs no npm. `$RUN/work/xdg/mr-cast/update-check.json` records `"latest":"9.9.9"`.
- **Offline.** Run `XDG_CACHE_HOME=$RUN/work/xdg MR_CAST_REGISTRY=http://127.0.0.1:1 $V mrc $RUN upgrade-offline -- upgrade --check`. Exit 1 and `mr-cast: could not look up the latest version on npm: …`.
- **Update notice (non-clone copy).** Export the package without `.git` and seed the cache. Run `mkdir -p $RUN/work/pkg && git -C $REPO archive HEAD | tar -x -C $RUN/work/pkg && ln -s $REPO/node_modules $RUN/work/pkg/node_modules && mkdir -p $RUN/work/xdg/mr-cast && node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({checkedAt:Date.now(),latest:"9.9.9"}))' $RUN/work/xdg/mr-cast/update-check.json`. Then run `(cd $DEMO && env -u MR_CAST_NO_UPDATE_CHECK XDG_CACHE_HOME=$RUN/work/xdg $RUN/work/pkg/bin/mr-cast --version) > $EV/notice.out 2> $EV/notice.err`. `notice.out` has the version line, and `notice.err` is `mr-cast 9.9.9 is available (you have <version>). Run \`mr-cast upgrade\`.`. With `MR_CAST_NO_UPDATE_CHECK=1` (the `env` default), stderr is empty.
- **Upgrade from a non-npm install.** Call the copy's own launcher, because `$V mrc` always runs the checkout's. Run `(cd $DEMO && XDG_CACHE_HOME=$RUN/work/xdg MR_CAST_REGISTRY=$REG $RUN/work/pkg/bin/mr-cast upgrade --check) > $EV/upgrade-copy.txt 2>&1`. Exit 0, and the file has `this mr-cast was not installed by \`npm install -g\`; to install the latest globally, run:` and `npm install -g @shiyuphan/mr-cast@latest`. Nothing is installed.
- **Stop the registry.** Run `kill $(cat $RUN/work/reg.pid)`.

## Gotchas

- `~/.claude/.mr-cast-install.json` on this machine points at this clone. Running any mr-cast command with the default `CLAUDE_CONFIG_DIR` after a version bump rewrites the user's real skills. Always use the run's config dir.
- The update notice never shows from a git clone, because `isGitClone` skips it. Prove it from the `git archive` copy only.
- The update notice uses only the cached result. When the cache is a day old, the command starts a detached background fetch to `MR_CAST_REGISTRY` (default npm). Seed `checkedAt` with the current time so no fetch starts.
- A real `upgrade` from an `npm install -g` install runs `npm install -g @shiyuphan/mr-cast@latest` and changes the user's global install, and from a `pnpm add -g` install runs `pnpm add -g @shiyuphan/mr-cast@latest`. Drive it only in a disposable prefix: `T=$(mktemp -d)`, then `pnpm pack`, `npm i -g --prefix $T/npm <tgz>` and run `NPM_CONFIG_PREFIX=$T/npm $T/npm/bin/mr-cast upgrade`, or `PNPM_HOME=$T/pnpm PATH=$T/pnpm/bin:$PATH pnpm add -g <tgz>` and run `mr-cast upgrade` there. Use `mktemp -d`, not the session scratchpad: npm redacts a UUID-like path segment in `npm root -g` output (`/***/`), so a prefix under a scratchpad named by a session id reads as "not installed by npm install -g".
- pnpm 11 and later install each global package in its own `<pnpm root -g>/<hash>/node_modules`, and an upgrade moves it to a new hash and deletes the old one. `upgrade` finds the new copy before it reinstalls the skills.
- Prune refuses `cache:remotion` and `cache:models` while a render holds them, with `kept …: in use`. The harness refuses any `cache:` id unless `XDG_CACHE_HOME` is under `$RUN`.
- `prune` lists only what is inside `.mr-cast` and the cache. Stills and videos written with `--out $EV/...` are never listed, so evidence is safe from prune.
