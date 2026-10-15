# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

It can also animate an explanation that has no diff behind it, such as how a subsystem works or why a bug happens. The scenes are the same, and code scenes show snippets of real source files instead of diff hunks.

## Use it from Claude Code

In any git repository, ask Claude to "create a video from this merge request", or run `/mr-cast-review [base-branch]` for the browser player or `/mr-cast-render [base-branch]` for an MP4. The `mr-cast-review` skill extracts the diff, writes `.mr-cast/storyboard.json`, and validates it. It then shows you the outline of the walkthrough and waits for your go-ahead or changes before it plays or renders. Say "just render it" in your request to skip that question.

After Claude explains something in a conversation, such as a system, a flow, a bug, or a design, ask it to "animate that", or run `/mr-cast-explain` for the browser player or `/mr-cast-explain-render` for an MP4. The `mr-cast-explain` skill turns the explanation into a storyboard of diagrams and real code snippets, shows you the outline, then plays or renders it. See [Explain mode](#explain-mode).

The MP4 is named after the walkthrough's title, such as `.mr-cast/rate-limiting-for-the-orders-api.mp4`, and Claude gives you its path.

To update mr-cast, ask Claude to "upgrade mr-cast". See [Upgrade](#upgrade).

For a walkthrough that explains the code line by line in plain words, ask for it "like I'm new to this", "line by line", "ELI5", or "for a non-native speaker", or pass `--simple` to `/mr-cast-render`. Claude then reads the callers, types, tests and config around the change, shows the key ones before the change, and voices each changed line or small group while it is highlighted. See [Simple style](#simple-style).

To free disk space, ask Claude to "prune mr-cast" or "clean up old mr-cast videos". The `mr-cast-prune` skill lists the walkthroughs, rendered videos, stills, voice clips and cached downloads with their sizes, asks you which to delete, and deletes only what you pick. See [Pruning](#pruning).

### Upgrading from 0.5

0.6 renames the skills and commands. `mr-video` is now `mr-cast-review`, and `explain-in-animation` is now `mr-cast-explain`. The `/mr-cast`, `/mr-render` and `/explain-in-animation` commands are replaced by `/mr-cast-review`, `/mr-cast-render`, `/mr-cast-explain` and `/mr-cast-explain-render`. Rerun `mr-cast install-skill` after you upgrade. It installs the new names and deletes the old skill and command files, but only those whose content shows mr-cast wrote them. It prints each file it removes and leaves any other file with an old name in place.

Explanations now live in `.mr-cast/explain/<slug>/` instead of `.mr-cast/explain/`. An explanation made by 0.5 stays where it is, and `--dir .mr-cast/explain` still reaches it. Rendered videos are named after the storyboard title instead of `walkthrough.mp4`.

## Install

Requires Node 20 to 24 on macOS or Linux. Remotion rendering hangs on Node 26. The `mr-cast` launcher finds a suitable Node through PATH, nvm, or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill   # installs the mr-cast-review, mr-cast-explain, mr-cast-prune and mr-cast-upgrade skills and the commands
mr-cast --version       # prints the mr-cast and Node versions
```

The skills point at the installed package, so rerun `mr-cast install-skill` after you move it. After an upgrade, the next `mr-cast` command reinstalls them (see [Upgrade](#upgrade)). Each install records what it wrote in `~/.claude/.mr-cast-install.json` and deletes anything an earlier install wrote that this version no longer does. `mr-cast uninstall-skill` removes every skill and command mr-cast installed, and the record. Both print each file they remove and keep any file whose content mr-cast did not write.

From a clone instead:

```bash
npm install
npm run build           # prebuilds the player into dist/
npm run install-skill
```

## Upgrade

```bash
mr-cast upgrade --check   # prints the installed and the latest version
mr-cast upgrade           # npm install -g @shiyuphan/mr-cast@latest, then reinstalls the skills
```

From Claude Code, ask Claude to "upgrade mr-cast". The `mr-cast-upgrade` skill checks the versions, asks before it upgrades, and runs `mr-cast upgrade`. Start a new Claude Code session afterwards so the new skills load.

`mr-cast upgrade` runs npm only when `npm install -g` installed mr-cast. For a clone it prints the steps to update it (`git pull`, `npm install`, `npm run build`, `npm run install-skill`), and for any other install it prints the npm command. If npm cannot write to its global directory, follow [npm's guide to a user-owned prefix](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

You can also run `npm install -g @shiyuphan/mr-cast@latest` yourself. The skills record which package installed them and its version. When that package runs as a new version, the next `mr-cast` command reinstalls them and prints `mr-cast: updated Claude Code skills to <version>`. Skills installed from another copy, such as a clone, stay as they are.

Once a day, a command starts a check of the latest version on npm in the background, and never waits for it. When a newer version is out, later commands print ``mr-cast <version> is available (you have <version>). Run `mr-cast upgrade`.`` on stderr. The check caches its result in `~/.cache/mr-cast/update-check.json`, or `$XDG_CACHE_HOME/mr-cast/update-check.json` when that is set. It is off in a clone and when `CI`, `NO_UPDATE_NOTIFIER` or `MR_CAST_NO_UPDATE_CHECK` is set.

## License

MIT. mr-cast renders with [Remotion](https://www.remotion.dev/license), which is free for individuals and companies with up to 3 employees. Larger companies need a Remotion company license to render videos with mr-cast.

## Commands

Run these from inside the repository you want to explain. Output goes to `.mr-cast/`, which `extract` adds to `.git/info/exclude`.

| Command | What it does |
| --- | --- |
| `mr-cast extract [base] [--working] [--simple]` | Diffs `base...HEAD` and writes `hunks.json` and `meta.json`. Prints a compact hunk index with line numbers. `--working` diffs the merge base against uncommitted changes. `--simple` records the [simple style](#simple-style). Lockfiles and build output are skipped unless you pass `--all-files`. Snippets added earlier are kept. |
| `mr-cast snippet <file>:<start>-<end> ...` | Adds those lines of unchanged source to `hunks.json` as snippets `s1`, `s2`, ... beside the diff's hunks, for the callers, definitions, types or config a change depends on. Prints each snippet with the file's own line numbers. Snippets do not count toward hunk coverage. Also accepts `<file> <start>-<end>`, keeps the id when the same range is added again, and holds at most 80 lines each. |
| `mr-cast validate` | Checks `storyboard.json` against the schema and `hunks.json`, and against the simple style's rules when `meta.json` records it. Exits 1 on errors. |
| `mr-cast outline` | Prints a short plan of a valid storyboard to show a person before rendering. It lists the title, one line per scene with its type, chapter and what it shows, the length, the style, and the hunk coverage. A code scene shows its file and its steps, or its focus lines and `flow` step count. A diagram shows its node, state or participant counts, and a tests scene its cases and gaps. |
| `mr-cast voice [--voice name]` | Speaks each scene's narration and each code step into `.mr-cast/audio/` and writes `voiceover.json`. Only changed text is spoken again. |
| `mr-cast play [--port N] [--no-open] [--voice name] [--no-voice]` | Voices the narration, then serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes, after any changed narration is voiced. |
| `mr-cast render [--out file.mp4] [--voice name] [--no-voice]` | Voices the narration, then renders an MP4 at 1920x1080, 30 fps, with the voice-over and burned-in subtitles, and prints its path. The file goes in the data directory and is named after the storyboard title, such as `rate-limiting-for-the-orders-api.mp4`. Without a usable title it takes the run's name, then `walkthrough.mp4`. The first run downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`, or `$XDG_CACHE_HOME/mr-cast/remotion` when that is set. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene's settled end state, just before it fades out, to check layout. |
| `mr-cast prune [id...] [--older-than days] [--json]` | Without ids, lists what can be deleted, with an id, size, age and description for each, and the total. With ids from that list, deletes exactly those. See [Pruning](#pruning). |
| `mr-cast upgrade [--check]` | Updates mr-cast to the latest version on npm and reinstalls the skills. `--check` only reports the versions. See [Upgrade](#upgrade). |
| `mr-cast version` | Prints `mr-cast <version> (node <version>)`. Also `--version` and `-v`. |

`validate`, `outline`, `voice`, `play`, `render` and `still` take `--dir <path>` to read the storyboard from another directory instead of `.mr-cast/`.

### Named runs

Every command above takes `--name <slug>` to keep a walkthrough in `.mr-cast/<slug>/` instead of `.mr-cast/`. The slug is lowercase letters, digits and dashes. Run `mr-cast extract --name rate-limit`, write `.mr-cast/rate-limit/storyboard.json`, then pass the same `--name` to `validate`, `outline`, `play` and `render`. Without `--name` the commands use `.mr-cast/` as before. The names `explain`, `audio` and `stills` are reserved, since the default run and explain mode use those folders.

Several runs can render at the same time, in one repository or several. They share the cache in `~/.cache/mr-cast`. Each render bundles the player into its own temporary folder and moves it into the cache when it is complete, so a render never reads a half-written bundle. A bundle stays while its source is current, and bundles of other versions are deleted after an hour without use. The Chrome download and the voice model download take a lock file, so a second render waits for the first download instead of starting its own. A render also marks the bundle and Chrome caches in use while it runs, so `mr-cast prune` refuses to delete them meanwhile.

### Pruning

`mr-cast prune` lists everything mr-cast stored that you can delete. It looks in `.mr-cast/` of the git repository, or of the current directory outside one, and in the shared cache. Each line has an id to pass back to delete it.

| Id | What it deletes |
| --- | --- |
| `run:.`, `run:<name>` | A diff walkthrough: the default run's own files in `.mr-cast/` (named runs and explanations stay), or `.mr-cast/<name>/`. |
| `explain:<name>` | An explanation in `.mr-cast/explain/<name>/`. If it is the current explanation, `.current` is cleared, so later `explain` commands need `--name` or a new `explain init`. |
| `video:<run>/<file>.mp4` | A rendered video. `<run>` is `.`, a run name, or `explain/<name>`. |
| `stills:<run>`, `audio:<run>` | A run's PNG stills, or its voice-over clips and `voiceover.json`. `still` and `voice` make them again. |
| `cache:bundle`, `cache:remotion`, `cache:models` | The player bundle, Chrome Headless Shell (about 580 MB), or the Kokoro voice model (about 90 MB). The next render or voice-over downloads or rebuilds them. |

`--older-than <days>` lists only what has not changed in that many days. `--json` prints the list as JSON for scripts and the skill. `mr-cast prune <id>...` deletes only ids from a fresh listing, with the same `--older-than` filter. An unknown id, or a cache entry that a render is using or a download holds the lock on, makes it delete nothing. Deleting a run also deletes its videos, stills and clips.

## Explain mode

Explain mode makes a walkthrough of an explanation instead of a diff. Code scenes reference snippets of unchanged source files. Run these from the directory the explanation is about, usually the repository root.

| Command | What it does |
| --- | --- |
| `mr-cast explain init [--title text] [--name slug] [--simple] [--reset]` | Creates the explanation's data directory with an empty `hunks.json` and a `meta.json` that marks it as an explanation, and prints its path and slug. The directory is `.mr-cast/explain/<slug>` in the git repository, or in the current directory outside one. The slug is a short kebab-case form of the title, or `--name`. If another explanation already has that slug, the new one gets a numbered suffix such as `-2`. Rerunning it with the same title or name reopens that explanation and keeps its storyboard and snippets. `--reset` deletes them. `--simple` records the [simple style](#simple-style). |
| `mr-cast explain snippet <file>:<start>-<end> ...` | The same as `mr-cast snippet`, on the explanation's directory. |
| `mr-cast explain validate`, `outline`, `voice`, `play`, `render`, `still` | The commands above, on the explanation's directory. |

Every `explain` command takes `--name <slug>` to pick an explanation. Without it, the commands use the explanation that `explain init` started most recently in this repository, recorded in `.mr-cast/explain/.current`, and print its name on stderr. `--dir <path>` uses any directory instead. Several explanations can coexist and render at the same time.

A snippet renders as a code scene with a neutral SOURCE badge and its line range. It has no added or removed lines, so it uses the single-column view. Focus steps, the callout and the `flow` step diagram work as they do for a diff hunk. Without a focus the whole snippet is one step, and `validate` requires a focus on snippets longer than 12 lines.

`validate` skips the diff rules in explain mode. It does not check hunk coverage, `skipped`, test files, or the tests scene, and the intent scene's `risk` is optional. It still checks the schema, focus limits, `flow` steps, and that the video opens with an intent scene and shows a diagram before the code. Its summary ends in `explain` instead of hunk coverage. A highlighted `arch` node is badged KEY instead of CHANGED.

## Simple style

The simple style is for a viewer who is new to the code, reads English as a second language, or both. The walkthrough explains the changed code line by line in plain words, and shows the unchanged code the change depends on before the change itself. `mr-cast extract --simple` and `mr-cast explain init --simple` record `"style": "simple"` in `meta.json`. A later `extract` or `init` without the flag drops the style and says so. `validate` and `outline` name the style, and in it `validate` also checks:

- Every code scene uses `steps`, and each step highlights at most 3 lines. A step past 6 lines is an error.
- Every changed line of a hunk the video shows is inside a step of some scene showing it. The warning lists the lines left out. Blank lines and snippets are not counted.
- Sentences stay short. It warns about a sentence over 18 words and about a scene whose sentences average more than 12.

The skills switch to this style when the request asks for it, and pass `--simple` through from the `/mr-cast-render` and `/mr-cast-explain-render` commands. `examples/demo-simple/` is the demo change told this way.

## Voice

`play` and `render` read each scene's narration aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small text-to-speech model that runs offline on the CPU. The first run downloads the model (about 90 MB) into `~/.cache/mr-cast/models`, or `$XDG_CACHE_HOME/mr-cast/models` when that is set. Speaking a scene takes a few seconds.

Each spoken text, a scene's narration or a code step's `say`, is one clip, cached in `.mr-cast/audio/` under a hash of the voice and the text. A rerun speaks only the texts that changed and deletes clips that no scene uses.

- `--voice <name>` picks the voice. The default is `af_heart`. Others include `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `bf_emma`, and `bm_george`. The choice is saved in `voiceover.json`, so later runs keep it.
- `--no-voice` skips the voice-over. Scenes are silent and timed from word count.
- If the model cannot load, for example offline on the first run, `play` and `render` print a warning and continue without voice. `mr-cast voice` exits 1 instead.

The player does not autoplay a voiced walkthrough, because browsers block autoplay with sound. Click the play button to start it.

## Storyboard

`src/types.ts` defines the schema. A storyboard has a title and a list of scenes, and each scene has `narration`. A voiced scene lasts as long as its clip, plus 0.4 seconds before it and 0.8 seconds after. Without a voice-over, scene length is the narration word count at 160 words per minute plus 1.5 seconds, with a 3-second minimum.

A code scene may walk its hunk in `steps` instead of `focusLinesAfter` and `flow`. Each step names its `lines` (or `oldLines` for removed code) and what to `say` while they are highlighted, and lasts as long as that takes, so the voice tracks the line. The scene's `narration` is then the intro spoken before the first step, while the diff morphs in. Removed lines stay on screen until the narration moves past the last step about them, then collapse. A `label` on every step draws the step diagram beside the code, as `flow` does. Steps are written top to bottom, at most 8 per scene and 6 with labels.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets, and diff stats. |
| `arch` | Components and edges, laid out automatically. Changed nodes are highlighted. |
| `code` | One hunk or snippet, in split or morph view. Focused lines stay bright, and a callout explains them. With `steps`, each highlight has its own spoken words. |
| `flow` | A step-by-step trace with the payload at each step. |
| `sequence` | A sequence diagram: participants with lifelines, and call, return and async messages drawn in order. Changed messages are highlighted. |
| `er` | An entity-relationship diagram with crow's-foot relations. Added, removed and modified tables, fields and relations are marked. |
| `state` | A state machine with an entry dot, final states, and labelled transitions. Added, removed and modified states and transitions are marked. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph, pie, ...) drawn as a static themed SVG. A fallback for diagrams the other scenes don't cover. |
| `tests` | A test matrix: each test case with its status (added, changed, removed, existing) and the behavior it proves, then a "Not tested" panel listing important behaviors no test covers. With no cases it states that the change has no tests. |
| `table` | Rows and columns of text, such as settings, API parameters or error codes. Added, removed and modified rows are marked, a changed cell strikes its old value beside the new one, and `highlight` spotlights rows one at a time. |

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/demo-simple/` tells the same change in the simple style, with a context snippet and steps on every code scene. `examples/gallery/` shows the `state`, `table`, `mermaid` and `tests` scenes.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` generates the voice-over. `lib/runs.mjs` resolves `--name` and `--dir` to a data directory, `lib/lock.mjs` guards downloads into the shared cache and marks caches in use, and `lib/prune.mjs` lists and deletes artifacts for `prune`.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share: a scene is a sequence of spoken segments, its narration and then each code step. `shared/voice.mjs` names each clip by its text.
- `bin/lib/explain.mjs` turns source line ranges into snippets for `snippet` and `explain snippet`.
- `skill/mr-cast-review/SKILL.md`, `skill/mr-cast-explain/SKILL.md`, `skill/mr-cast-prune/SKILL.md` and `skill/mr-cast-upgrade/SKILL.md` are the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
