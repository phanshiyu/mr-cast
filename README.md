# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

## Use it from Claude Code

In any git repository, ask Claude to "create a video from this merge request", or run `/mr-cast [base-branch]`. The `mr-video` skill extracts the diff, writes `.mr-cast/storyboard.json`, validates it, and starts the player.

## Install

Requires Node 20 to 24 on macOS or Linux. Remotion rendering hangs on Node 26. The `mr-cast` launcher finds a suitable Node through PATH, nvm, or Homebrew.

```bash
npm install -g mr-cast
mr-cast install-skill   # writes ~/.claude/skills/mr-video/SKILL.md and ~/.claude/commands/mr-cast.md
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
| `mr-cast play [--port N] [--no-open]` | Serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes. |
| `mr-cast render [--out file.mp4]` | Renders `walkthrough.mp4` at 1920x1080, 30 fps, with subtitles burned in. The first run downloads Chrome Headless Shell into `node_modules/.remotion`. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene, 60% of the way through, to check layout. |

## Storyboard

`src/types.ts` defines the schema. A storyboard has a title and a list of scenes, and each scene has `narration`. Scene length is the narration word count at 160 words per minute plus 1.5 seconds, with a 3-second minimum.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets, and diff stats. |
| `arch` | Components and edges, laid out automatically. Changed nodes are highlighted. |
| `code` | One hunk, in split or morph view. Focused lines stay bright, and a callout explains them. |
| `flow` | A step-by-step trace with the payload at each step. |

`examples/demo/` has a complete storyboard. `scripts/demo.sh <dir>` creates the git repository it describes.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, and `lib/render.mjs` wraps the Remotion renderer.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share.
- `skill/SKILL.md` is the skill template that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
