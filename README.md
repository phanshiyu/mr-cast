# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

## Use it from Claude Code

In any git repository, ask Claude to "create a video from this merge request", or run `/mr-cast [base-branch]` for the browser player or `/mr-render [base-branch]` for an MP4. The `mr-video` skill extracts the diff, writes `.mr-cast/storyboard.json`, validates it, and plays or renders it.

## Install

Requires Node 20 to 24 on macOS or Linux. Remotion rendering hangs on Node 26. The `mr-cast` launcher finds a suitable Node through PATH, nvm, or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill   # installs the mr-video skill plus the /mr-cast and /mr-render commands
```

The skill points at the installed package, so rerun `mr-cast install-skill` after you upgrade or move it.

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
| `mr-cast voice [--voice name]` | Speaks each scene's narration into `.mr-cast/audio/` and writes `voiceover.json`. Only changed narration is spoken again. |
| `mr-cast play [--port N] [--no-open] [--voice name] [--no-voice]` | Voices the narration, then serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes, after any changed narration is voiced. |
| `mr-cast render [--out file.mp4] [--voice name] [--no-voice]` | Voices the narration, then renders `walkthrough.mp4` at 1920x1080, 30 fps, with the voice-over and burned-in subtitles. The first run downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`, or `$XDG_CACHE_HOME/mr-cast/remotion` when that is set. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene, 60% of the way through, to check layout. |

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

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/gallery/` shows the `state` and `mermaid` scenes.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` generates the voice-over.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share. `shared/voice.mjs` names each clip by its narration.
- `skill/SKILL.md` is the skill template that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
