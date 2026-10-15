# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

It can also animate an explanation that has no diff behind it, such as how a subsystem works or why a bug happens. The scenes are the same, and code scenes show snippets of real source files instead of diff hunks.

## Use it from Claude Code

In any git repository, ask Claude to "create a video from this merge request", or run `/mr-cast-review [base-branch]` for the browser player or `/mr-cast-render [base-branch]` for an MP4. The `mr-cast-review` skill extracts the diff, writes `.mr-cast/storyboard.json`, and validates it. It then shows you the outline of the walkthrough and waits for your go-ahead or changes before it plays or renders. Say "just render it" in your request to skip that question.

After Claude explains something in a conversation, such as a system, a flow, a bug, or a design, ask it to "animate that", or run `/mr-cast-explain` for the browser player or `/mr-cast-explain-render` for an MP4. The `mr-cast-explain` skill turns the explanation into a storyboard of diagrams and real code snippets, shows you the outline, then plays or renders it. See [Explain mode](#explain-mode).

The MP4 is named after the walkthrough's title, such as `.mr-cast/rate-limiting-for-the-orders-api.mp4`, and Claude gives you its path.

### Upgrading from 0.5

0.6 renames the skills and commands. `mr-video` is now `mr-cast-review`, and `explain-in-animation` is now `mr-cast-explain`. The `/mr-cast`, `/mr-render` and `/explain-in-animation` commands are replaced by `/mr-cast-review`, `/mr-cast-render`, `/mr-cast-explain` and `/mr-cast-explain-render`. Rerun `mr-cast install-skill` after you upgrade. It installs the new names and deletes the old skill and command files, but only those whose content shows mr-cast wrote them. It prints each file it removes and leaves any other file with an old name in place.

Explanations now live in `.mr-cast/explain/<slug>/` instead of `.mr-cast/explain/`. An explanation made by 0.5 stays where it is, and `--dir .mr-cast/explain` still reaches it. Rendered videos are named after the storyboard title instead of `walkthrough.mp4`.

## Install

Requires Node 20 to 24 on macOS or Linux. Remotion rendering hangs on Node 26. The `mr-cast` launcher finds a suitable Node through PATH, nvm, or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill   # installs the mr-cast-review and mr-cast-explain skills and their commands
mr-cast --version       # prints the mr-cast and Node versions
```

The skills point at the installed package, so rerun `mr-cast install-skill` after you upgrade or move it. Each install records what it wrote in `~/.claude/.mr-cast-install.json` and deletes anything an earlier install wrote that this version no longer does. `mr-cast uninstall-skill` removes every skill and command mr-cast installed, and the record. Both print each file they remove and keep any file whose content mr-cast did not write.

From a clone instead:

```bash
npm install
npm run build           # prebuilds the player into dist/
npm run install-skill
```

## License

MIT. mr-cast renders with [Remotion](https://www.remotion.dev/license), which is free for individuals and companies with up to 3 employees. Larger companies need a Remotion company license to render videos with mr-cast.

## Commands

Run these from inside the repository you want to explain. Output goes to `.mr-cast/`, which `extract` adds to `.git/info/exclude`.

| Command | What it does |
| --- | --- |
| `mr-cast extract [base] [--working]` | Diffs `base...HEAD` and writes `hunks.json` and `meta.json`. Prints a compact hunk index with line numbers. `--working` diffs the merge base against uncommitted changes. Lockfiles and build output are skipped unless you pass `--all-files`. |
| `mr-cast validate` | Checks `storyboard.json` against the schema and `hunks.json`. Exits 1 on errors. |
| `mr-cast outline` | Prints a short plan of a valid storyboard to show a person before rendering. It lists the title, one line per scene with its type, chapter and what it shows, the length, and the hunk coverage. A code scene shows its file, focus lines and `flow` step count. A diagram shows its node, state or participant counts, and a tests scene its cases and gaps. |
| `mr-cast voice [--voice name]` | Speaks each scene's narration into `.mr-cast/audio/` and writes `voiceover.json`. Only changed narration is spoken again. |
| `mr-cast play [--port N] [--no-open] [--voice name] [--no-voice]` | Voices the narration, then serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes, after any changed narration is voiced. |
| `mr-cast render [--out file.mp4] [--voice name] [--no-voice]` | Voices the narration, then renders an MP4 at 1920x1080, 30 fps, with the voice-over and burned-in subtitles, and prints its path. The file goes in the data directory and is named after the storyboard title, such as `rate-limiting-for-the-orders-api.mp4`. Without a usable title it takes the run's name, then `walkthrough.mp4`. The first run downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`, or `$XDG_CACHE_HOME/mr-cast/remotion` when that is set. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene's settled end state, just before it fades out, to check layout. |
| `mr-cast version` | Prints `mr-cast <version> (node <version>)`. Also `--version` and `-v`. |

`validate`, `outline`, `voice`, `play`, `render` and `still` take `--dir <path>` to read the storyboard from another directory instead of `.mr-cast/`.

### Named runs

Every command above takes `--name <slug>` to keep a walkthrough in `.mr-cast/<slug>/` instead of `.mr-cast/`. The slug is lowercase letters, digits and dashes. Run `mr-cast extract --name rate-limit`, write `.mr-cast/rate-limit/storyboard.json`, then pass the same `--name` to `validate`, `outline`, `play` and `render`. Without `--name` the commands use `.mr-cast/` as before. The names `explain`, `audio` and `stills` are reserved, since the default run and explain mode use those folders.

Several runs can render at the same time, in one repository or several. They share the cache in `~/.cache/mr-cast`. Each render bundles the player into its own temporary folder and moves it into the cache when it is complete, so a render never reads a half-written bundle. A bundle stays while its source is current, and bundles of other versions are deleted after an hour without use. The Chrome download and the voice model download take a lock file, so a second render waits for the first download instead of starting its own.

## Explain mode

Explain mode makes a walkthrough of an explanation instead of a diff. Code scenes reference snippets of unchanged source files. Run these from the directory the explanation is about, usually the repository root.

| Command | What it does |
| --- | --- |
| `mr-cast explain init [--title text] [--name slug] [--reset]` | Creates the explanation's data directory with an empty `hunks.json` and a `meta.json` that marks it as an explanation, and prints its path and slug. The directory is `.mr-cast/explain/<slug>` in the git repository, or in the current directory outside one. The slug is a short kebab-case form of the title, or `--name`. If another explanation already has that slug, the new one gets a numbered suffix such as `-2`. Rerunning it with the same title or name reopens that explanation and keeps its storyboard and snippets. `--reset` deletes them. |
| `mr-cast explain snippet <file>:<start>-<end> ...` | Reads those lines of each file and adds them to `hunks.json` as snippets `s1`, `s2`, ... Prints each snippet with the file's own line numbers for `focusLinesAfter`. Also accepts `<file> <start>-<end>`. Adding the same range again keeps its id. A snippet holds at most 80 lines. |
| `mr-cast explain validate`, `outline`, `voice`, `play`, `render`, `still` | The commands above, on the explanation's directory. |

Every `explain` command takes `--name <slug>` to pick an explanation. Without it, the commands use the explanation that `explain init` started most recently in this repository, recorded in `.mr-cast/explain/.current`, and print its name on stderr. `--dir <path>` uses any directory instead. Several explanations can coexist and render at the same time.

A snippet renders as a code scene with a neutral SOURCE badge and its line range. It has no added or removed lines, so it uses the single-column view. Focus steps, the callout and the `flow` step diagram work as they do for a diff hunk. Without a focus the whole snippet is one step, and `validate` requires a focus on snippets longer than 12 lines.

`validate` skips the diff rules in explain mode. It does not check hunk coverage, `skipped`, test files, or the tests scene, and the intent scene's `risk` is optional. It still checks the schema, focus limits, `flow` steps, and that the video opens with an intent scene and shows a diagram before the code. Its summary ends in `explain` instead of hunk coverage. A highlighted `arch` node is badged KEY instead of CHANGED.

## Voice

`play` and `render` read each scene's narration aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small text-to-speech model that runs offline on the CPU. The first run downloads the model (about 90 MB) into `~/.cache/mr-cast/models`, or `$XDG_CACHE_HOME/mr-cast/models` when that is set. Speaking a scene takes a few seconds.

Clips are cached in `.mr-cast/audio/` under a hash of the voice and the narration text. A rerun speaks only the scenes whose narration changed and deletes clips that no scene uses.

- `--voice <name>` picks the voice. The default is `af_heart`. Others include `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `bf_emma`, and `bm_george`. The choice is saved in `voiceover.json`, so later runs keep it.
- `--no-voice` skips the voice-over. Scenes are silent and timed from word count.
- If the model cannot load, for example offline on the first run, `play` and `render` print a warning and continue without voice. `mr-cast voice` exits 1 instead.

The player does not autoplay a voiced walkthrough, because browsers block autoplay with sound. Click the play button to start it.

## Storyboard

`src/types.ts` defines the schema. A storyboard has a title and a list of scenes, and each scene has `narration`. A voiced scene lasts as long as its clip, plus 0.4 seconds before it and 0.8 seconds after. Without a voice-over, scene length is the narration word count at 160 words per minute plus 1.5 seconds, with a 3-second minimum.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets, and diff stats. |
| `arch` | Components and edges, laid out automatically. Changed nodes are highlighted. |
| `code` | One hunk, in split or morph view. Focused lines stay bright, and a callout explains them. |
| `flow` | A step-by-step trace with the payload at each step. |
| `sequence` | A sequence diagram: participants with lifelines, and call, return and async messages drawn in order. Changed messages are highlighted. |
| `er` | An entity-relationship diagram with crow's-foot relations. Added, removed and modified tables, fields and relations are marked. |
| `state` | A state machine with an entry dot, final states, and labelled transitions. Added, removed and modified states and transitions are marked. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph, pie, ...) drawn as a static themed SVG. A fallback for diagrams the other scenes don't cover. |
| `tests` | A test matrix: each test case with its status (added, changed, removed, existing) and the behavior it proves, then a "Not tested" panel listing important behaviors no test covers. With no cases it states that the change has no tests. |

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/gallery/` shows the `state`, `mermaid` and `tests` scenes.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` generates the voice-over. `lib/runs.mjs` resolves `--name` and `--dir` to a data directory, and `lib/lock.mjs` guards downloads into the shared cache.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share. `shared/voice.mjs` names each clip by its narration.
- `bin/lib/explain.mjs` turns source line ranges into snippets for explain mode.
- `skill/mr-cast-review/SKILL.md` and `skill/mr-cast-explain/SKILL.md` are the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
