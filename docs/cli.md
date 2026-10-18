# Command reference

`mr-cast help` lists the commands you run yourself first, then the ones the skills run. `mr-cast help --all` adds every option.

Run the commands from inside the repository the video is about. Output goes to `.mr-cast/`, which `extract` and `init` add to `.git/info/exclude`.

## Commands

| Command | What it does |
| --- | --- |
| `mr-cast install-skill` | Installs the `mr-cast`, `mr-cast-prune` and `mr-cast-upgrade` skills into `~/.claude`, or `$CLAUDE_CONFIG_DIR`, and removes what earlier versions installed there. |
| `mr-cast uninstall-skill` | Removes every skill mr-cast installed. |
| `mr-cast status` | Prints the branch, the commits and files it has ahead of its base, the uncommitted files, and the pace and voice you chose last time. The skill picks the video's source from it. |
| `mr-cast extract [base] [--working]` | Starts a walkthrough of the branch's diff in `.mr-cast/<branch-slug>/`. It diffs `base...HEAD`, writes `hunks.json` and `meta.json`, and prints a compact hunk index with line numbers. `--working` diffs the merge base against uncommitted changes. Running it again on the same branch keeps the storyboard and the snippets. |
| `mr-cast init --title text [--reset] [--quick]` | Starts a walkthrough of an explanation in `.mr-cast/<title-slug>/`, in the git repository or in the current directory outside one, and prints its path. A slug already in use gets a numbered suffix such as `-2`. The same title reopens the walkthrough and keeps its storyboard and snippets. `--reset` deletes them. `--quick` starts a quick video in `.mr-cast/quick-<title-slug>/`, and needs `--title`. The player ends a quick video on three phrases to say to Claude next: "go deeper", "the whole branch" and "save it". A later `init` of the same title without `--quick` starts the full video from the quick one's storyboard, snippets and voice, unless the full video already has a storyboard or snippets, or `--reset` is given. |
| `mr-cast snippet <file>:<start>-<end> ...` | Adds those lines of unchanged source to `hunks.json` as snippets `s1`, `s2` and so on, and prints each with the file's own line numbers. Each snippet holds at most 80 lines. `<file> <start>-<end>` also works, and adding the same range again keeps its id. A later `extract` keeps the snippets. |
| `mr-cast plan [--port N] [--no-open] [--idle-exit minutes]` | Checks the run's `plan.json`, serves the plan page at `http://127.0.0.1:4747/plan`, and opens the browser. The page writes each pick into `plan.json`, and reloads when `plan.json` changes. It replaces a plan server already running for the run, and exits like `play` when no page is open. See [The plan](#the-plan). |
| `mr-cast schema [type\|all]` | Prints the storyboard's TypeScript schema from `src/types.ts`. With a scene type such as `array`, it prints that scene and every type it uses. Alone, it prints the storyboard and what every scene shares. `all` prints everything. |
| `mr-cast validate` | Checks `storyboard.json` against the schema and `hunks.json`, and against `plan.json` when the run has one. Prints the length. Exits 1 on errors. `--read-only` writes nothing: no `review.md`, `reading.md` or plan picks, and no remembered choice. |
| `mr-cast outline` | Prints a short plan of a valid storyboard to show before rendering: the title, one line per scene with its type, chapter and contents, and the length. |
| `mr-cast steps [sceneIndex...]` | Prints each step's words beside what it lights and what it changes on screen, with the highlight warnings. Code scenes are left out. |
| `mr-cast still [sceneIndex...] [--out dir] [--step k]` | Renders a PNG of each scene's end state, just before it fades out, into the run's `stills/`. Scene indexes start at 0. With `--step k`, it renders each scene as its step k ends, just before the next step starts, into `scene-NN-type-step-k.png`; every scene it renders must have that step. |
| `mr-cast voice` | Speaks each scene's narration and each step into the run's `audio/` and writes `voiceover.json`. Only changed text is spoken again. |
| `mr-cast play [--port N] [--no-open] [--idle-exit minutes]` | Serves the player at `http://127.0.0.1:4747` and prints its URL at once, voices the narration with its progress on one line, then opens the browser. See [The player](#the-player). |
| `mr-cast render [--out file.mp4]` | Voices the narration, then renders a 1920x1080, 30 fps MP4 with the voice, burned-in subtitles and chapter markers, and prints its path. See [Render](#render). |
| `mr-cast prune [id...] [options]` | Lists what mr-cast stored, with sizes, or deletes exactly what you pick. See [Prune](#prune). |
| `mr-cast ps [--json]` | Lists the mr-cast processes running: players, plan pages, renders, and their voice children. See [Running processes](#running-processes). |
| `mr-cast stop <pid\|run\|all> [options]` | Stops the processes you pick, with their children. See [Running processes](#running-processes). |
| `mr-cast upgrade [--check]` | Updates mr-cast to the latest version and reinstalls the skills. `--check` only reports the versions. See [Upgrade](#upgrade). |
| `mr-cast voices [--sample engine:name] [--out file.wav]` | Lists the voice engines, whether each model is downloaded, and their voices. `--sample` voices one sentence into a WAV file. See [The voice](#the-voice). |
| `mr-cast version` | Prints `mr-cast <version> (node <version>)`. Also `--version` and `-v`. |

`extract` also takes `--context N` (context lines per hunk, default 4), `--max-lines N` (changed lines shown per hunk in the index, default 14) and `--all-files`. Without `--all-files`, `extract` skips lockfiles, minified files and build output.

## Runs

Each walkthrough is a run: one directory in `.mr-cast/`, made by `extract` or `init`. The new run becomes the current one, recorded in `.mr-cast/.current`. Later commands work on the current run and print its name on stderr.

- `--name <slug>` on `extract` or `init` names the run. On a later command, it picks that run instead of the current one. A slug is lowercase letters, digits and dashes. `explain`, `audio` and `stills` are reserved for the folders of older versions.
- `--dir <path>` points a command at any other directory, such as a walkthrough made by mr-cast 0.11.

Several runs can render at once, in one repository or in several, and they share the cache in `~/.cache/mr-cast`. Each render bundles the player into a temporary folder and moves it into the cache when complete, so no render reads a half-written bundle. Bundles of other versions are deleted after an hour unused. The Chrome and voice model downloads take a lock, so a second render waits for the first download. A running render marks the bundle and Chrome caches in use, and `mr-cast prune` refuses to delete them while it runs.

## Settings flags

`extract`, `init`, `plan`, `validate`, `outline`, `steps`, `voice`, `play`, `render` and `still` take these flags. A command without a flag uses the default, so pass the same flags to each command of a walkthrough.

| Flag | What it does |
| --- | --- |
| `--audience preread` | Makes a [pre-read](storyboard.md#pre-read): no code on screen, and the reading order in `reading.md`. |
| `--pace slower\|normal\|faster` | The voice's speed and the pauses around it. The default is `normal`. |
| `--speed x` | The voice's speed alone, from 0.5 to 2. It overrides the speed that `--pace` sets. |
| `--voice engine:name` | The voice, such as `kitten:luna` (the default) or `kokoro:af_heart`. A name alone, such as `bruno` or `af_heart`, picks the engine that has it. `mr-cast voices` lists them. |
| `--engine kitten\|kokoro` | The voice engine. Alone, it picks the engine's default voice: `kitten:luna` or `kokoro:af_heart`. |
| `--no-voice` | A silent walkthrough, with subtitles timed for reading. |

`--audience` also accepts `familiar`, `new` and `overview`, and these commands also accept `--simple`, so skills from before 0.25 keep working. All four make the plain video, the same as no flag. Any other `--audience` value is an error.

Each of these commands records the audience it ran with in the run's `meta.json`, the plain video when no flag names one. The skill's hook validates `storyboard.json` with that audience, so it checks the run as its latest command did.

mr-cast remembers your last pace and voice in `~/.config/mr-cast/last-choices.json`, or under `$XDG_CONFIG_HOME` when that is set. `mr-cast status` prints them.

## The voice

`play`, `render` and `voice` read the narration aloud with a small text-to-speech model that runs offline on the CPU. There are two engines, and each has its own voices:

| Engine | Model | First use downloads | Voices |
| --- | --- | --- | --- |
| `kitten` (the default) | [Kitten TTS mini 0.8](https://huggingface.co/KittenML/kitten-tts-mini-0.8), Apache 2.0 | About 82 MB into `~/.cache/mr-cast/kitten`, checked against a pinned sha256 | `bella`, `luna` (the default), `rosie` and `kiki` (female); `jasper`, `bruno`, `hugo` and `leo` (male); all American English |
| `kokoro` | [Kokoro 82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M), Apache 2.0 | About 90 MB into `~/.cache/mr-cast/models`, and about 0.5 MB for each voice | 28 voices, such as `af_heart` (its default), `af_bella`, `am_michael`, `bf_emma` and `bm_george`, in American and British English |

Only the engine you use is downloaded.

- `mr-cast voices` lists each engine, its size and whether it is downloaded, then its voices with a description. It marks the default and the voice you chose last.
- `mr-cast voices --sample <engine:name>` voices one sentence into a WAV file and prints its path, so you can hear a voice before you choose it. `--out <file.wav>` names the file, and `--pace` or `--speed` sets its speed. The first sample of an engine downloads its model.
- `--voice <engine:name>` picks the voice, and `--engine <engine>` picks an engine's default voice. Voice names of mr-cast 0.26 and earlier, such as `af_heart`, still pick Kokoro.
- `--pace slower` is speed 0.85 with pauses 1.5 times as long. `--pace faster` is speed 1.15 with pauses 0.85 times as long. `play` and `render` print `mr-cast: pace: slower` when the pace is not `normal`.
- `--no-voice` makes every scene silent and timed for reading at 130 words a minute, scaled by the pace.

Each spoken text, a scene's narration or a step's `say`, is one clip in the run's `audio/`, named by a hash of the voice with its engine, the speed and the text. A rerun speaks only the texts that changed, and each voice and speed keeps its own clips. `voiceover.json` records when each sentence of a clip starts and ends, so the subtitles follow the voice through the pauses.

The voice reads a few written forms as words. "e.g." becomes "for example", "5s" becomes "5 seconds", "200 ms" becomes "200 milliseconds", an arrow becomes "to", and "v0.14.0" becomes "version 0 point 14 point 0". The subtitles show the same words.

If the model cannot load, for example offline on the first run, `play` and `render` warn and continue without a voice, and `mr-cast voice` exits 1.

## The player

`mr-cast play` prints the URL at once and opens the browser when the voice is ready. A page opened earlier waits for the voice. If the voice fails, the page opens silent and says so.

A second `play` of the same run stops the first player and its voicing, then starts, so it runs with the new command's flags. A player exits by itself once no page has been open for 30 minutes, counted from the last page closing, or from the start when none opened. It does not count while the first voicing runs. `--idle-exit <minutes>` changes the limit, and `--idle-exit 0` keeps it running until stopped.

When `storyboard.json` changes, the page keeps playing its version and shows "Updating..." until the changed narration is voiced, then reloads once. The speed control goes from 0.75x to 1.5x. With a `plan.json`, the player has a **Plan** tab. For a pre-read, it has a **Reading order** panel.

## Render

`mr-cast render` writes the MP4 in the run's directory. It names the file after the storyboard title, or else the run's name, or else `walkthrough.mp4`. `--out file.mp4` writes it somewhere else. When the run has a `review.md` or a `reading.md`, `render --out` also writes a copy of each beside the MP4, named after it, such as `demo.review.md` and `demo.reading.md`.

The first render downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`.

## The plan

`plan.json` holds the topics of one walkthrough. Each topic has an `id`, a `title`, a one-line `summary`, its `files`, a suggested `depth` (`skip`, `brief` or `deep`), one to three `views` with the suggested one first, an optional `why`, and `seconds`: about how long it takes at `brief` and at `deep`. The schema is `Plan` in `src/types.ts`. `shared/views.mjs` lists the views, each with the label the page shows and the scene types that draw it.

The page writes your pick as the topic's `choice`, such as `{ "depth": "deep", "view": "compare" }`, and nothing else. The server accepts only a `choice` for a known topic, with a depth and a view that the topic offers. It writes `plan.json` by renaming a complete file into place.

Each scene names its topic in `topic`, and the storyboard records the picks it was written from in `plan`. `validate` fails on a topic that is not in the plan. It warns about a topic whose scenes do not draw its picked view, and about a pick that changed in `plan.json` since the storyboard was written.

## Prune

`mr-cast prune` lists everything mr-cast stored that you can delete: walkthroughs in `.mr-cast/` of the git repository (or of the current directory outside one), and the shared cache. Each line has an id, a size, an age and a description.

| Id | What it deletes |
| --- | --- |
| `run:<name>` | A walkthrough in `.mr-cast/<name>/`, of a branch (kind `run`) or an explanation (kind `explain`). Deleting the current run clears `.current`, so later commands need `--name` or a new `extract` or `init`. |
| `run:.`, `explain:<name>` | A walkthrough from mr-cast 0.11 or earlier: the default run's files in `.mr-cast/` (other runs stay), or an explanation in `.mr-cast/explain/<name>/`. |
| `video:<run>/<file>.mp4` | A rendered video. `<run>` is a run name, or `.` or `explain/<name>` for 0.11 data. |
| `stills:<run>`, `audio:<run>` | A run's PNG stills, or its voice clips and `voiceover.json`. `still` and `voice` make them again. |
| `cache:bundle`, `cache:remotion`, `cache:kitten`, `cache:models` | The player bundle, Chrome Headless Shell (about 580 MB), the Kitten voice model (about 82 MB), or the Kokoro voice model (about 90 MB). The next render or voice-over in that engine rebuilds or downloads them. |

Selectors pick what to delete, and they combine:

- Ids pick those artifacts.
- `--kind run,explain` picks every artifact of those kinds: `run`, `explain`, `video`, `stills`, `audio` or `cache`.
- `--all` picks everything.
- `--older-than <days>` keeps only what has not changed in that many days. Without another selector, it filters the listing.
- `--except <id>`, repeatable, keeps an artifact. Keeping a walkthrough keeps its parts, and keeping a part keeps its walkthrough.

`prune` makes the selection from a fresh listing. It never picks an artifact in use, such as the Chrome cache during a render, and prints it as `in use, not removed`. An unknown id, or an id in use, makes it delete nothing. Deleting a run also deletes its videos, stills and clips, and their bytes count once.

`--dry-run` prints exactly what would be removed and the bytes, and removes nothing. `--json` prints the listing as JSON. With `--json`, a dry run or a deletion prints `dryRun`, the `artifacts` with their bytes, `inUse`, and the total `bytes`.

`mr-cast prune --choices --json` prints the menu the prune skill shows. It has up to four groups (rendered videos, stills and voice clips, walkthroughs, and cache), each with at most 4 options, and leaves out empty groups. Each option has a `label`, a `description` with its size and what deleting it means, the `ids` it deletes, and a `command`: the exact arguments that delete it, such as `["prune", "--kind", "video"]`.

## Running processes

play, plan, render, and the voice and download children of play record themselves while they run in `~/.local/state/mr-cast/procs`, or `$XDG_STATE_HOME/mr-cast/procs` when that is set. Each one removes its record as it exits.

`mr-cast ps` lists them, from any directory:

```
pid    kind      age  page                 url                                               run
41234  play      12m  1 open               http://127.0.0.1:4747/#token=9f2c...             rate-limit · ~/code/shop
41240    voice   12m                                                                         with pid 41234
41300  plan      3h   none · exits in 18m  http://127.0.0.1:4748/plan#token=51ab...         retry · ~/code/shop
39000  play      1d   ?                    http://127.0.0.1:4749                             unregistered · ~/code/api
```

- `page` is the number of pages open on a server, or `none` with the time until it exits by itself. A process that wrote no record shows `?`.
- A process counts only while `ps` shows its pid owned by you, started at the recorded time and running mr-cast. Any other record is stale, for example from a process that was killed, and the listing removes it. A reused pid is never taken for the process that had it.
- `unregistered` marks an mr-cast process with no record: one started by mr-cast 0.27 or older, or one that records itself under another `XDG_STATE_HOME`. `ps` finds these in the process list, with their port and working directory from `lsof`.
- `--json` prints `stateDir` and `processes`, each with `pid`, `ppid`, `kind`, `registered`, `parent`, `startedAt`, `url`, `repo`, `run`, `dir`, `version`, `viewers`, `idleSince` and `idleExit`.

`mr-cast stop` stops what its targets pick, and they combine:

- A pid, a run name such as `rate-limit`, or `all`. Several can be given.
- `--idle` keeps only servers with no page open.
- `--older-than <30m|2h|1d>` keeps only processes started longer ago than that.

A process's voice and download children always go with it. `stop` sends SIGTERM, waits up to 5 seconds, and sends SIGKILL only to a process still running. Before each signal it checks the pid again, and it never signals a process that is not an mr-cast process of yours. A pid or run that matches nothing stops nothing and exits 1. Each line it prints says `stopped`, `killed` (SIGKILL was needed), `already gone` or `could not stop`.

`--dry-run` prints `would stop` lines and stops nothing. `--json` prints `dryRun` and the `processes`, each with its `outcome`. `mr-cast stop --choices --json` prints a menu in the shape of prune's: one group, `Running processes`, with up to 4 options, such as every process, the servers with no page open, those running for over 2 hours, or each process. Each option has the exact `command` that stops it and the pids it stops as `ids`. `mr-cast prune --choices` adds the same group after its own.

`mr-cast status` adds a line such as `running: 2 players and 1 render` when anything is running.

## Upgrade

```bash
mr-cast upgrade --check   # prints the installed and the latest version
mr-cast upgrade           # installs the latest version, then reinstalls the skills
```

`mr-cast upgrade` updates mr-cast in place only when `npm install -g` or `pnpm add -g` installed it, and it uses that same package manager. In a clone it prints the update steps instead (`git pull`, `pnpm install`, `pnpm build`, `pnpm install-skill`). For any other install it prints the npm command. If npm cannot write to its global directory, follow [npm's guide to a user-owned prefix](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

You can also run `npm install -g @shiyuphan/mr-cast@latest` yourself. The skills record which package installed them and its version. The next `mr-cast` command after an upgrade reinstalls them and prints `mr-cast: updated Claude Code skills to <version>`. Skills installed from another copy, such as a clone, stay as they are.

Once a day, a command checks npm for a newer version in the background, without waiting for the answer. When one is out, later commands print ``mr-cast <version> is available (you have <version>). Run `mr-cast upgrade`.`` on stderr. The result is cached in `~/.cache/mr-cast/update-check.json`, or under `$XDG_CACHE_HOME` when that is set. The check is off in a clone and when `CI`, `NO_UPDATE_NOTIFIER` or `MR_CAST_NO_UPDATE_CHECK` is set.
