# Run settings, status and help

A run keeps its settings from `extract` or `init`: `--audience familiar|new|overview` (`--simple` is `new`), `--pace`, `--speed`, `--voice` and `--no-voice`. Later commands use them without the flags, and a flag on a later command changes them from then on. The last audience and pace a user chose are kept per user in `$XDG_CONFIG_HOME/mr-cast/last-choices.json`, and `mr-cast status` prints them with the branch's changes, which is what the skill decides the video's source from. `mr-cast help` shows the commands a person runs first and the skill's pipeline after, and `help --all` adds the rest.

## Sub-features

- `settings-persist` stores the settings in the run's `meta.json` under `settings`, and `validate` and `outline` estimate at the stored pace.
- `settings-override` lets a flag on a later command change the stored setting.
- `silent-run` makes `render` silent with no flag after `--no-voice` at creation.
- `last-choices` writes the audience and named pace (or `silent`) the user chose last.
- `status` prints the branch, commits and files ahead of the base, uncommitted files, and the last choices, also on the base branch and outside a repo.
- `help-split` prints the human commands, then "Used by the Claude Code skills"; `help --all` adds `voice`, `still` and the rarer options.

## How to get to it (user POV)

- Run `mr-cast extract --audience new --pace slower` or `mr-cast init --title "…" --no-voice`, then the later commands without flags.
- Run `mr-cast status` and `mr-cast help [--all]`.
- In Claude Code, answer the skill's Audience and Pace questions. The next `/mr-cast` offers them first, marked "(Last time)".

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`. `verify.sh env` sets `XDG_CONFIG_HOME=$RUN/work/config`, so the real `~/.config/mr-cast` is never written.

- **Status before a run.** Run `$V mrc $RUN status -- status`. Exit 0 and stdout `branch: feature/rate-limit · 1 commit and 6 files ahead of main`, six file lines such as `  src/api/rate-limit.ts +20 −0`, `working tree: clean` and `last choices: none yet`.
- **Create with settings.** Run `$V mrc $RUN extract -- extract --audience new --pace slower`. Then `node -p 'JSON.stringify(require(process.argv[1]).settings)' $DEMO/.mr-cast/feature-rate-limit/meta.json` prints `{"audience":"new","pace":{"speed":0.85,"pauses":1.5}}`, and `cat $RUN/work/config/mr-cast/last-choices.json` has `"audience": "new"` and `"pace": "slower"`.
- **Persisted pace honoured.** Run `cp $REPO/examples/demo/storyboard.json $DEMO/.mr-cast/feature-rate-limit/ && $V mrc $RUN outline-slow -- outline`. Its last lines include `about 3:38 (estimated from word count) · slower pace · simple style`, with no `--pace` passed.
- **Flag override.** Run `$V mrc $RUN outline-fast -- outline --pace faster`, which ends `· faster pace`, then `$V mrc $RUN validate-after -- validate`, whose verdict shows the shorter `2:36`, so the override stuck. `last-choices.json` now has `"pace": "faster"`.
- **Silent run.** Run `$V mrc $RUN extract-silent -- extract --no-voice --name quiet && cp $REPO/examples/demo/storyboard.json $DEMO/.mr-cast/quiet/ && node -e 'const f=process.argv[1],s=require(f);s.scenes=[s.scenes[0],s.scenes[6]];require("fs").writeFileSync(f,JSON.stringify(s))' $DEMO/.mr-cast/quiet/storyboard.json && $V mrc $RUN render-quiet -- render --out $EV/quiet.mp4`. `$V probe $EV/quiet.mp4` shows no audio stream, though `render` got no `--no-voice`.
- **Status after.** Run `$V mrc $RUN status-after -- status`. The last line is `last choices: audience new · pace silent`. On the base branch, `git -C $DEMO checkout -q main && $V mrc $RUN status-main -- status; git -C $DEMO checkout -q feature/rate-limit` prints `branch: main · nothing ahead of main`. Outside a repo, `mkdir -p $RUN/work/norepo && $V mrc $RUN status-norepo --cwd $RUN/work/norepo -- status` prints `branch: none (not in a git repository), so only an explanation can be animated`.
- **Help.** Run `$V mrc $RUN help -- help`. Stdout lists `install-skill`, `uninstall-skill`, `upgrade`, `prune`, `version` and `help` before `Used by the Claude Code skills:`, and does not mention `still` or `--context`. `$V mrc $RUN help-all -- help --all` adds `More commands and options:` with `voice`, `still`, `--speed` and `extract --context N`.

## Gotchas

- The remembered choices are per user, not per repo. Without `XDG_CONFIG_HOME` under `$RUN`, a verify run would overwrite the user's real ones.
- `--voice <name>` turns a silent run's voice back on. `--pace` alone does not.
- Settings flags are sticky: an `outline --pace faster` used only to compare lengths leaves the run at the faster pace. Pass `--pace` again to go back.
