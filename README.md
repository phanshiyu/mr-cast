# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

It can also animate an explanation that has no diff behind it, such as how a subsystem works or why a bug happens. The scenes are the same, and code scenes show snippets of real source files instead of diff hunks.

## Use it from Claude Code

In any git repository, ask Claude to "create a video from this merge request", or run `/mr-cast-review [base-branch]` for the browser player or `/mr-cast-render [base-branch]` for an MP4. The `mr-cast-review` skill extracts the diff and asks you three multiple-choice questions: who the video is for (a reviewer, someone new to the code, or a quick overview for the team), which areas to go deeper on, and the pace (normal, slower, faster, or no voice). The recommended answers come first, so pressing enter gives the default video, and it skips any question your request already answers. It then writes `.mr-cast/storyboard.json` and validates it. Before a render it shows the outline and asks once whether to render it, make it shorter or longer, or change something else. The player skips that question, since it reloads as Claude edits. Say "just render it" in your request to skip the questions.

After Claude explains something in a conversation, such as a system, a flow, a bug, or a design, ask it to "animate that", or run `/mr-cast-explain` for the browser player or `/mr-cast-explain-render` for an MP4. The `mr-cast-explain` skill asks the same questions, turns the explanation into a storyboard of diagrams and real code snippets, shows you the outline, then plays or renders it. See [Explain mode](#explain-mode).

The MP4 is named after the walkthrough's title, such as `.mr-cast/rate-limiting-for-the-orders-api.mp4`, and Claude gives you its path. It has a chapter marker for each chapter, so video players can jump between them.

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
| `mr-cast validate [--pace p] [--speed x]` | Checks `storyboard.json` against the schema and `hunks.json`, and against the simple style's rules when `meta.json` records it. Prints the length, estimated at `--pace` and `--speed` until the narration is voiced. Exits 1 on errors. |
| `mr-cast outline [--pace p] [--speed x]` | Prints a short plan of a valid storyboard to show a person before rendering. It lists the title, one line per scene with its type, chapter and what it shows, the length, the style, and the hunk coverage. A code scene shows its file and its steps, or its focus lines and `flow` step count. A diagram shows its node, state or participant counts, and a tests scene its cases and gaps. A table shows its columns and rows, a chart its series and labels, a timeline its events and range, and a files scene its files and line counts. |
| `mr-cast voice [--voice name] [--pace p] [--speed x]` | Speaks each scene's narration and each step into `.mr-cast/audio/` and writes `voiceover.json`. Only changed text is spoken again. |
| `mr-cast play [--port N] [--no-open] [--voice name] [--pace p] [--speed x] [--no-voice]` | Voices the narration, then serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes, after any changed narration is voiced. The player has a playback speed control from 0.75x to 1.5x. |
| `mr-cast render [--out file.mp4] [--voice name] [--pace p] [--speed x] [--no-voice]` | Voices the narration, then renders an MP4 at 1920x1080, 30 fps, with the voice-over, burned-in subtitles and chapter markers, and prints its path. The file goes in the data directory and is named after the storyboard title, such as `rate-limiting-for-the-orders-api.mp4`. Without a usable title it takes the run's name, then `walkthrough.mp4`. The first run downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`, or `$XDG_CACHE_HOME/mr-cast/remotion` when that is set. |
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

`validate` skips the diff rules in explain mode. It does not check hunk coverage, `skipped`, test files, or the tests scene, and the intent scene's `risk` is optional. It still checks the schema, focus limits, `flow` steps, and that the video opens with an intent scene and shows a diagram before the code. Its summary ends in `explain` instead of hunk coverage. An older node's `modified: true` becomes a KEY highlight instead of a CHANGED mark.

## Simple style

The simple style is for a viewer who is new to the code, reads English as a second language, or both. The walkthrough explains the changed code line by line in plain words, and shows the unchanged code the change depends on before the change itself. `mr-cast extract --simple` and `mr-cast explain init --simple` record `"style": "simple"` in `meta.json`. A later `extract` or `init` without the flag drops the style and says so. `validate` and `outline` name the style, and in it `validate` also checks:

- Every code scene uses `steps`, and each step highlights at most 3 lines. A step past 6 lines is an error.
- Every changed line of a hunk the video shows is inside a step of some scene showing it. The warning lists the lines left out. Blank lines and snippets are not counted.
- Sentences stay short. It warns about a sentence over 18 words and about a scene whose sentences average more than 12.

The skills switch to this style when you answer that the video is for someone new to the code, or when the request asks for it. They pass `--simple` through from the `/mr-cast-render` and `/mr-cast-explain-render` commands. `examples/demo-simple/` is the demo change told this way.

## Voice

`play` and `render` read each scene's narration aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small text-to-speech model that runs offline on the CPU. The first run downloads the model (about 90 MB) into `~/.cache/mr-cast/models`, or `$XDG_CACHE_HOME/mr-cast/models` when that is set. Speaking a scene takes a few seconds.

Each spoken text, a scene's narration or a step's `say`, is one clip, cached in `.mr-cast/audio/` under a hash of the voice, the speed and the text. A rerun speaks only the texts that changed and deletes clips that no scene uses. `voiceover.json` also records when each sentence of a clip starts and ends, so the subtitles follow the voice through the pauses.

- `--voice <name>` picks the voice. The default is `af_heart`. Others include `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `bf_emma`, and `bm_george`. The choice is saved in `voiceover.json`, so later runs keep it.
- `--pace <slower|normal|faster>` sets how fast the voice speaks and how long it pauses. `slower` is speed 0.85 with every pause 1.5 times as long, and `faster` is speed 1.15 with pauses 0.85 times as long. The choice is saved like the voice, and `play` and `render` print `mr-cast: pace: slower (saved; pass --pace normal to change)` when they use a saved pace that is not normal. Changing the speed voices every clip again.
- `--speed <x>` sets the voice's speed alone, from 0.5 to 2, and overrides the speed `--pace` sets.
- `--no-voice` skips the voice-over. Scenes are silent and timed for reading at 130 words a minute, scaled by the pace.
- If the model cannot load, for example offline on the first run, `play` and `render` print a warning and continue without voice. `mr-cast voice` exits 1 instead.

The player does not autoplay a voiced walkthrough, because browsers block autoplay with sound. Click the play button to start it.

## Storyboard

`src/types.ts` defines the schema. A storyboard has a title and a list of scenes, and each scene has `narration`. Each spoken text is a segment with a lead, the voice, and a tail. The narration waits until the scene has drawn in: 1 second, or the scene type's build time plus 0.3 seconds when that is longer (1.5 seconds for most diagrams, so the voice starts at 1.8). New code finishes drawing by then too. Each step's items appear or light up 0.5 seconds before its voice, and hold 1.2 seconds after it, or 0.8 seconds after the narration. Without a clip, a segment reads at 130 words per minute and holds 1.5 seconds after, at least 3 seconds in all. The pace scales the reading speed and every pause.

A code scene may walk its hunk in `steps` instead of `focusLinesAfter` and `flow`. Each step names its `lines` (or `oldLines` for removed code) and what to `say` while they are highlighted, and lasts as long as that takes, so the voice tracks the line. The scene's `narration` is then the intro spoken before the first step, while the diff morphs in. Removed lines stay on screen until the narration moves past the last step about them, then collapse. A `label` on every step draws the step diagram beside the code, as `flow` does. Steps are written top to bottom, at most 8 per scene and 6 with labels.

Diagrams take `steps` too, one segment each after the narration, so the video can move the viewer's attention as it explains. Each step names what to light in `focus`, one ref or an array of them, and what to `say`. The whole diagram draws first. Then, half a second before each step's words, what it focuses lights up, what earlier steps lit stays softly visible, and the rest dims. Walk a path by focusing a node, then the edge leaving it, then the next node, or name them together in one step. A node stays readable while an edge touching it is lit. A sequence and a timeline also reveal their messages or events as the steps reach them. Each scene type takes its own refs:

| Scene | A `focus` ref is |
| --- | --- |
| `arch` | A node id, an edge `"from->to"` (or `"a-b"` for either direction), a group `"group:Support team"`, or an edge index. |
| `sequence` | A message index, an `"a-b"` range of them, or a participant id. A step draws every message up to the last one it focuses. |
| `er` | An entity id, a field `"orders.status"`, a relation `"users->orders"`, or a relation index. |
| `state` | A state id, a transition `"pending->paid"`, a transition's exact label such as `"pay"`, or a transition index. |
| `table` | A row index, a column `"col:Value"`, or one cell `"Value@2"` (column, then row index). |
| `chart` | A label, a series `"series:after"`, or one value `"after@p99"`. |
| `timeline` | An event index, an `"a-b"` range of them, or a span `"span:wait"`. The playhead moves to the furthest one. |
| `files` | A path in the tree. |
| `tests` | A case index, a case's name, or a gap `"gap:0"`. |
| `intent` | A bullet index. |

A `flow` gives every step a `say` instead, and each step becomes current just before its words. Without steps, every diagram is fully drawn before the narration starts. `validate` checks every ref and suggests the closest names when one names nothing, and `outline` counts the spoken steps. Storyboards from 0.10 and earlier, whose steps named `messages`, `events`, `entity`, `state`, `transition`, `label`, `row` or `path`, still work.

### Diagram nodes

Arch nodes and sequence participants are the same kind of card, so they can show people, teams, places and documents as well as services. Each has an `id` and a `label`, plus:

- `icon`: any [Lucide icon](https://lucide.dev/icons) name in kebab-case, such as `user`, `users`, `headset`, `building-2`, `server` or `database`. `validate` rejects a name Lucide lacks and suggests close ones. Without it the card has no icon.
- `caption`: a short line under the label, such as `customer` or `datastore`. Without it there is none.
- `change`: `added` (green, NEW), `removed` (dashed and struck through) or `modified` (CHANGED), as in the er and state scenes.
- `highlight`: a key part of the idea, drawn in the accent colour with a KEY badge.
- `tone`: the icon's colour (`neutral`, `accent`, `good`, `bad` or `warn`), to tell kinds of things apart.

An arch node also takes a `group`. Nodes with the same group are drawn inside one labelled box, in the order each group's first node appears. An arch edge takes a `label`, a `direction` (`forward` by default, `both` for a two-way relationship, `none` for a plain line), a `style` (`flow` moves dashes along a forward edge, `solid` is a still line and the default otherwise, `dashed` is for a weak or indirect link), and a `change`. An arch scene lays out left to right, or top to bottom with `"layout": "TB"`, which suits hierarchies and teams. `validate` warns past 12 nodes. A flow step takes an `icon` and a `tone` for its actor.

Older storyboards that give a node `kind` (`service`, `db`, `queue` or `client`) and `modified: true` still work: `kind` stands for an icon and caption, and `modified` for a `modified` change, or a highlight in an explanation.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets, and diff stats. |
| `arch` | Nodes and edges, laid out automatically left to right or top to bottom, with groups drawn as labelled boxes. Nodes can be services, people, teams or anything with a [Lucide icon](https://lucide.dev/icons). Changed and key nodes and changed edges are marked. With `steps`, the voice walks the graph node by node and edge by edge. |
| `code` | One hunk or snippet, in split or morph view. Focused lines stay bright, and a callout explains them. With `steps`, each highlight has its own spoken words. |
| `flow` | A step-by-step trace with the payload at each step. With a `say` on each step, the current step follows the voice. |
| `sequence` | A sequence diagram: participants (the same cards as arch nodes) with lifelines, and call, return and async messages drawn in order. Changed messages are highlighted. With `steps`, messages draw in as the voice reaches them. |
| `er` | An entity-relationship diagram with crow's-foot relations. Added, removed and modified tables, fields and relations are marked. With `steps`, each table, field or relation lights as the voice names it. |
| `state` | A state machine with an entry dot, final states, and labelled transitions. Added, removed and modified states and transitions are marked. With `steps`, each state or transition lights as the voice names it. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph, pie, ...) drawn as a static themed SVG. A fallback for diagrams the other scenes don't cover. |
| `tests` | A test matrix: each test case with its status (added, changed, removed, existing) and the behavior it proves, then a "Not tested" panel listing important behaviors no test covers. With no cases it states that the change has no tests. |
| `table` | Rows and columns of text, such as settings, API parameters or error codes. Added, removed and modified rows are marked, a changed cell strikes its old value beside the new one, and `highlight` spotlights rows one at a time. With `steps`, each row, column or cell lights just before its own spoken words. |
| `chart` | A bar or line chart of one or more series over labels, with value labels and a unit. Bars grow and lines draw in. With two series, such as before and after, each label gets a change badge like −42%, green or red by `better`. `annotation` calls out one point. With `steps`, each label, series or value lights as the voice names it. |
| `timeline` | Events on a time axis in ms, s, min, h or d, each with a label and detail, and `spans` for waits and windows drawn under the axis with their length. A playhead reveals them left to right before the voice starts, or with `steps` moves to each step's events as the voice reaches them. |
| `files` | The changed files as a tree with line counts and a diffstat bar, tests marked, and a short note beside the files the narration names. Without `files` it lists every file in `hunks.json`; an explanation lists its own. Files with notes, or `highlight`, are spotlit in turn, and with `steps` each file lights just before its own spoken words. A long tree flows into two columns. |

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/demo-simple/` tells the same change in the simple style, with a context snippet and steps on every code scene. `examples/gallery/` shows the `files`, `state`, `table`, `chart`, `timeline`, `mermaid` and `tests` scenes, with steps on the state, table, chart and timeline. `examples/people/` explains how a support ticket gets resolved, with no code at all: people and teams in groups, a path walked step by step, a sequence between people, and a timeline.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` generates the voice-over. `lib/runs.mjs` resolves `--name` and `--dir` to a data directory, `lib/lock.mjs` guards downloads into the shared cache and marks caches in use, and `lib/prune.mjs` lists and deletes artifacts for `prune`.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share: a scene is a sequence of spoken segments, its narration and then each step, each with a lead and a tail scaled by the pace, and each scene type's build time, which the narration waits for. `shared/steps.mjs` lists the steps each scene type speaks, and `shared/targets.mjs` what a step's `focus` can name in each scene type. `shared/normalize.mjs` rewrites older field names once, where a storyboard enters. `shared/voice.mjs` names each clip by its voice, speed and text, and defines the paces. `shared/files.mjs` builds the file list of a `files` scene for both.
- `bin/lib/explain.mjs` turns source line ranges into snippets for `snippet` and `explain snippet`.
- `skill/mr-cast-review/SKILL.md`, `skill/mr-cast-explain/SKILL.md`, `skill/mr-cast-prune/SKILL.md` and `skill/mr-cast-upgrade/SKILL.md` are the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
