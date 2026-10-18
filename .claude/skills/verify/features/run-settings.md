# Settings, status and help

The settings are flags: `--audience familiar|new|overview` (`--simple` is `new`), `--pace`, `--speed`, `--voice` and `--no-voice`. `extract`, `init`, `validate`, `outline`, `voice`, `play`, `render` and `still` take them. A flag applies to its own command only. A command without it uses the default: audience familiar, normal pace, voice `kitten:luna`, voiced. Nothing keeps the flags: `meta.json` has no `settings`, and `voiceover.json` records the voice and pace its clips were made with but is never read as a default. Old `settings` and `style` keys in a `meta.json` from 0.11 to 0.14 are ignored. The last audience and pace a user chose are kept per user in `$XDG_CONFIG_HOME/mr-cast/last-choices.json`, and `mr-cast status` prints them with the branch's changes, which is what the skill decides the video's source from. `mr-cast help` shows the commands a person runs first and the skill's pipeline after, and `help --all` adds the rest.

## Sub-features

- `flags-one-command` applies `--pace`, `--audience` and `--no-voice` to the command they are given to; the next command without them uses the defaults, also after `voiceover.json` was made at another pace.
- `legacy-settings-ignored` ignores `settings` and `style` in an older run's `meta.json`, without an error.
- `last-choices` writes the audience and named pace (or `silent`) the user chose last.
- `status` prints the branch, commits and files ahead of the base, uncommitted files, and the last choices, also on the base branch and outside a repo.
- `help-split` prints the human commands, then "Used by the Claude Code skills"; `help --all` adds `voice`, `still` and the rarer options.

## How to get to it (user POV)

- Run `mr-cast extract --audience new --pace slower`, then each later command with the same flags, or without them for the defaults.
- Run `mr-cast status` and `mr-cast help [--all]`.
- In Claude Code, answer the skill's Audience and Pace questions. The skill passes them to every command, and the next `/mr-cast` offers them first, marked "(Last time)".

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`. `verify.sh env` sets `XDG_CONFIG_HOME=$RUN/work/config`, so the real `~/.config/mr-cast` is never written.

- **Status before a run.** Run `$V mrc $RUN status -- status`. Exit 0 and stdout `branch: feature/rate-limit · 1 commit and 6 files ahead of main`, six file lines such as `  src/api/rate-limit.ts +20 −0`, `working tree: clean` and `last choices: none yet`.
- **Cut-down run.** Run `$V mrc $RUN extract -- extract && D=$DEMO/.mr-cast/feature-rate-limit && cp $REPO/examples/demo/storyboard.json $D/ && node -e 'const f=process.argv[1],s=require(f);s.scenes=[s.scenes[0],s.scenes[6]];require("fs").writeFileSync(f,JSON.stringify(s))' $D/storyboard.json`. `grep -c settings $D/meta.json` prints `0`.
- **Pace for one command.** Run `$V mrc $RUN outline-slow -- outline --pace slower`, which ends `2 scenes · about 0:59 (estimated from word count) · slower pace`, then `$V mrc $RUN outline-plain -- outline`, which ends `2 scenes · about 0:47 (estimated from word count)` with no pace named.
- **Voiced at one pace, then the default.** Run `$V mrc $RUN render-slow -- render --pace slower --out $EV/A.mp4`, then `$V mrc $RUN render-plain -- render --out $EV/B.mp4`. Each voices 4 clips; only the first prints `mr-cast: pace: slower`. `$V probe` shows an audio stream in both, and B shorter (about 36.5 s against 43.4 s). `voiceover.json` has `"speed": 0.85` after A and `"speed": 1` after B. `outline` then ends `2 scenes · 0:37 (voiced)`.
- **Silent for one command.** Run `$V mrc $RUN extract-silent -- extract --no-voice --name quiet`, copy and cut the storyboard into `$DEMO/.mr-cast/quiet/` as above, then `$V mrc $RUN render-quiet -- render --out $EV/quiet.mp4`. `$V probe $EV/quiet.mp4` shows an `aac` audio stream, since `render` got no `--no-voice`. `render --no-voice --out $EV/silent.mp4` has none.
- **Older settings ignored.** Run `$V mrc $RUN extract-legacy -- extract --name legacy`, copy the full `examples/demo/storyboard.json` into it, and add the keys 0.11 to 0.14 wrote: `node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f));m.settings={audience:"new",pace:{speed:0.85,pauses:1.5},silent:true};m.style="simple";fs.writeFileSync(f,JSON.stringify(m,null,2))' $DEMO/.mr-cast/legacy/meta.json`. `validate --name legacy` exits 0 with `✓ storyboard ok · 9 scenes · 3:39 · shows 3/6 hunks · …` and no `simple style`, and `outline --name legacy` ends `about 3:39 (estimated from word count)`. With `--audience new` the same validate says `simple style` and warns on `scenes[5]` and `scenes[7]`.
- **Status after.** Run `$V mrc $RUN status-after -- status`. The last line names the last audience and pace given, such as `last choices: audience new · pace slower`. On the base branch, `git -C $DEMO checkout -q main && $V mrc $RUN status-main -- status; git -C $DEMO checkout -q feature/rate-limit` prints `branch: main · nothing ahead of main`. Outside a repo, `mkdir -p $RUN/work/norepo && $V mrc $RUN status-norepo --cwd $RUN/work/norepo -- status` prints `branch: none (not in a git repository), so only an explanation can be animated`.
- **Help.** Run `$V mrc $RUN help -- help`. Stdout lists `install-skill`, `uninstall-skill`, `upgrade`, `prune`, `version` and `help` before `Used by the Claude Code skills:`, and does not mention `still` or `--context`. `$V mrc $RUN help-all -- help --all` adds `More commands and options:` with `voice`, `still`, `--speed` and `extract --context N`.

## Gotchas

- The remembered choices are per user, not per repo. Without `XDG_CONFIG_HOME` under `$RUN`, a verify run would overwrite the user's real ones.
- Every command given `--audience`, a named `--pace` or `--no-voice` records it in the last choices, so `status` shows the last flag any command got, not what a run was made with.
- Switching pace voices every clip again: clips are cached per voice and speed, and a voicing drops clips no scene uses at the current speed.
- `--voice` and `--no-voice` together are an error.
