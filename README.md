# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that references diff hunks by id. mr-cast plays it in a browser or renders it to MP4 with Remotion.

It can also animate an explanation that has no diff behind it, such as how a subsystem works or why a bug happens. The scenes are the same, and code scenes show snippets of real source files instead of diff hunks.

## Use it from Claude Code

Type `/mr-cast`, or ask Claude to "create a video from this merge request" or, after it explains something, to "animate that". One skill makes both kinds of video. It works out the source from your words and arguments. A base branch, `--working`, or "this branch", "PR", "MR" or "diff" means the branch's changes. "That", "what you said" or "this explanation" means the explanation Claude gave in the conversation. For a bare "make a video of this", it uses whichever source exists: the branch when it has changes and nothing was explained, the explanation when the branch has no changes. When both exist, its first question asks which one. When neither does, it says what it can make and stops.

The skill asks up to three multiple-choice questions in one go: who the video is for (a reviewer or teammate, someone new to the code, or a quick overview for the team), which areas to go deeper on, and the pace (normal, slower, faster, or no voice). The recommended answers come first, so pressing enter gives the default video, and it skips any question your request already answers. Your last audience and pace come first next time, marked "(Last time)". Say "just make it", "use the defaults" or "no questions" to skip the questions.

It then writes the storyboard, validates it, and opens the browser player, which reloads as Claude edits. For a file to share, say "mp4", "video file", "render", "save" or "share", or type `/mr-cast mp4` (`/mr-cast mp4 main` for another base). Before an MP4 it shows the outline and asks once whether to render it, make it shorter or longer, or change something else. The MP4 is named after the walkthrough's title, such as `.mr-cast/feature-rate-limit/rate-limiting-for-the-orders-api.mp4`, and Claude gives you its path. It has a chapter marker for each chapter, so video players can jump between them.

For a walkthrough that explains the code line by line in plain words, ask for the video "like I'm new to this", "line by line", "ELI5", or "for a non-native speaker", or answer that it is for someone new to the code. Claude then reads the callers, types, tests and config around the code, shows the key ones first, and voices each line or small group while it is highlighted. See [Simple style](#simple-style).

To free disk space, ask Claude to "prune mr-cast" or "clean up old mr-cast videos". The `mr-cast-prune` skill lists the walkthroughs, rendered videos, stills, voice clips and cached downloads with their sizes, asks you which to delete, and deletes only what you pick. See [Pruning](#pruning).

To update mr-cast, ask Claude to "upgrade mr-cast". See [Upgrade](#upgrade).

### Upgrading from 0.13

0.14 never cuts text on screen. A storyboard whose labels ended in an ellipsis before now wraps and shrinks them, and `validate` fails on any that still does not fit, saying what to shorten (see [Text on screen](#text-on-screen)). The `arch` scene is now called `graph`; a storyboard that says `arch` still works.

### Upgrading from 0.11

0.12 replaces four entries with one. The `mr-cast-review` and `mr-cast-explain` skills and the `/mr-cast-render` and `/mr-cast-explain-render` commands are gone, and `/mr-cast` does all four jobs:

| Before | After |
|---|---|
| `/mr-cast-review [base]` | `/mr-cast [base]` |
| `/mr-cast-render [base]` | `/mr-cast mp4 [base]` |
| `/mr-cast-explain` | `/mr-cast` (after Claude explains something) |
| `/mr-cast-explain-render` | `/mr-cast mp4` (after Claude explains something) |
| `/mr-cast-prune`, `/mr-cast-upgrade` | unchanged |

The first `mr-cast` command after `npm install -g` reinstalls the skills, which deletes the two old skills and the two commands. `mr-cast install-skill` does the same. Either one deletes only files whose content shows mr-cast wrote them, and prints each one. Start a new Claude Code session afterwards, since open sessions keep the skills they loaded.

Walkthroughs now live in `.mr-cast/<name>/`, one directory each, whether they show a branch or an explanation. A walkthrough made by 0.11 stays where it is. Reach the default one with `--dir .mr-cast` and an explanation with `--dir .mr-cast/explain/<name>`. `mr-cast explain <command>` still works, for a session that loaded the old skill before the upgrade.

### Upgrading from 0.5

0.6 renamed `mr-video` to `mr-cast-review` and `explain-in-animation` to `mr-cast-explain`, which 0.12 then replaced with `mr-cast`. Installing 0.12 deletes the old skill and command files of any earlier version, but only those whose content shows mr-cast wrote them. An explanation made by 0.5 stays in `.mr-cast/explain/`, and `--dir .mr-cast/explain` reaches it.

## Install

Requires Node 20 to 24 on macOS or Linux. Remotion rendering hangs on Node 26. The `mr-cast` launcher finds a suitable Node through PATH, nvm, or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill   # installs the mr-cast, mr-cast-prune and mr-cast-upgrade skills
mr-cast --version       # prints the mr-cast and Node versions
```

The skills point at the installed package, so rerun `mr-cast install-skill` after you move it. After an upgrade, the next `mr-cast` command reinstalls them (see [Upgrade](#upgrade)). Each install records what it wrote in `~/.claude/.mr-cast-install.json` and deletes anything an earlier install wrote that this version no longer does. `mr-cast uninstall-skill` removes every skill mr-cast installed, and the record. Both print each file they remove and keep any file whose content mr-cast did not write.

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

`mr-cast help` lists the commands you run yourself first, then the ones the skills run. `mr-cast help --all` adds every option.

Run these from inside the repository you want to explain. Output goes to `.mr-cast/`, which `extract` and `init` add to `.git/info/exclude`.

| Command | What it does |
| --- | --- |
| `mr-cast status` | Prints the branch, the commits and files it has ahead of its base, the uncommitted files, and the audience and pace you chose last time. The skill decides the video's source from it. |
| `mr-cast extract [base] [--working]` | Starts a walkthrough of the branch's diff in `.mr-cast/<branch-slug>/`. Diffs `base...HEAD`, writes `hunks.json` and `meta.json`, and prints a compact hunk index with line numbers. `--working` diffs the merge base against uncommitted changes. Lockfiles and build output are skipped unless you pass `--all-files`. Running it again on the same branch keeps the storyboard and the snippets. |
| `mr-cast init --title text [--reset]` | Starts a walkthrough of an explanation, which has no diff, in `.mr-cast/<title-slug>/` (in the git repository, or the current directory outside one), and prints its path. If another walkthrough already has that slug, the new one gets a numbered suffix such as `-2`. Rerunning it with the same title reopens the walkthrough and keeps its storyboard and snippets. `--reset` deletes them. |
| `mr-cast snippet <file>:<start>-<end> ...` | Adds those lines of unchanged source to `hunks.json` as snippets `s1`, `s2`, ...: the code of an explanation, or the callers, definitions, types or config a change depends on. Prints each snippet with the file's own line numbers. Snippets do not count toward hunk coverage, and a later `extract` keeps them. Also accepts `<file> <start>-<end>`, keeps the id when the same range is added again, and holds at most 80 lines each. |
| `mr-cast validate` | Checks `storyboard.json` against the schema and `hunks.json`, and against the simple style's rules when the audience is `new`. Prints the length, estimated at the `--pace` given until the narration is voiced at it. Exits 1 on errors. |
| `mr-cast outline` | Prints a short plan of a valid storyboard to show a person before rendering. It lists the title, one line per scene with its type, chapter and what it shows, the length, the style, and the hunk coverage. A code scene shows its file and its steps, or its focus lines and `flow` step count. A diagram shows its node, state or participant counts, and a tests scene its cases and gaps. A table shows its columns and rows, a chart its series and labels, a timeline its events and range, and a files scene its files and line counts. Each scene also counts the steps that draw a pen mark. |
| `mr-cast voice` | Speaks each scene's narration and each step into the run's `audio/` and writes `voiceover.json`. Only changed text is spoken again. |
| `mr-cast play [--port N] [--no-open]` | Voices the narration, then serves the player at `http://127.0.0.1:4747` and opens the browser. The page reloads data when `storyboard.json` changes, after any changed narration is voiced. The player has a playback speed control from 0.75x to 1.5x. |
| `mr-cast render [--out file.mp4]` | Voices the narration, then renders an MP4 at 1920x1080, 30 fps, with the voice-over, burned-in subtitles and chapter markers, and prints its path. The file goes in the run's directory and is named after the storyboard title, such as `rate-limiting-for-the-orders-api.mp4`. Without a usable title it takes the run's name, then `walkthrough.mp4`. The first run downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`, or `$XDG_CACHE_HOME/mr-cast/remotion` when that is set. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene's settled end state, just before it fades out, to check layout. |
| `mr-cast prune [id...] [--older-than days] [--json]` | Without ids, lists what can be deleted, with an id, size, age and description for each, and the total. With ids from that list, deletes exactly those. See [Pruning](#pruning). |
| `mr-cast upgrade [--check]` | Updates mr-cast to the latest version on npm and reinstalls the skills. `--check` only reports the versions. See [Upgrade](#upgrade). |
| `mr-cast version` | Prints `mr-cast <version> (node <version>)`. Also `--version` and `-v`. |

### Runs

Each walkthrough is a run: one directory in `.mr-cast/`, from `extract` or `init`. The run either starts becomes the current run, recorded in `.mr-cast/.current`, and every later command works on it and prints its name on stderr. Pass `--name <slug>` to `extract` or `init` to name a run yourself, and to any later command to work on another run. The slug is lowercase letters, digits and dashes, and `explain`, `audio` and `stills` are reserved, since earlier versions used those folders. `--dir <path>` points any command after `extract` or `init` at another directory, such as a walkthrough from 0.11 in `.mr-cast` or `.mr-cast/explain/<name>`.

These settings are flags on `extract`, `init`, `validate`, `outline`, `voice`, `play`, `render` and `still`. A flag applies to its own command only, and the run does not keep it. A command without a flag uses its default, so pass the same flags to each command of a walkthrough.

| Setting | What it does |
| --- | --- |
| `--audience familiar\|new\|overview` | Who the video is for: someone who knows the code (the default), someone new to it, or the team in a quick overview. `new` is the [simple style](#simple-style), and `--simple` is the same as `--audience new`. |
| `--pace slower\|normal\|faster` | How fast the voice speaks and how long it pauses. The default is `normal`. See [Voice](#voice). |
| `--speed x` | The voice's speed alone, from 0.5 to 2. It overrides the speed `--pace` sets. |
| `--voice name` | The Kokoro voice. The default is `af_heart`. |
| `--no-voice` | A silent walkthrough with subtitles timed for reading. |

The last `--audience` and `--pace` (or `--no-voice`) you chose are also kept in `~/.config/mr-cast/last-choices.json`, or `$XDG_CONFIG_HOME/mr-cast/last-choices.json` when that is set. `mr-cast status` prints them, and the skill offers them first.

Several runs can render at the same time, in one repository or several. They share the cache in `~/.cache/mr-cast`. Each render bundles the player into its own temporary folder and moves it into the cache when it is complete, so a render never reads a half-written bundle. A bundle stays while its source is current, and bundles of other versions are deleted after an hour without use. The Chrome download and the voice model download take a lock file, so a second render waits for the first download instead of starting its own. A render also marks the bundle and Chrome caches in use while it runs, so `mr-cast prune` refuses to delete them meanwhile.

### Pruning

`mr-cast prune` lists everything mr-cast stored that you can delete. It looks in `.mr-cast/` of the git repository, or of the current directory outside one, and in the shared cache. Each line has an id to pass back to delete it.

| Id | What it deletes |
| --- | --- |
| `run:<name>` | A walkthrough in `.mr-cast/<name>/`, of a branch (kind `run`) or an explanation (kind `explain`). If it is the current run, `.current` is cleared, so later commands need `--name` or a new `extract` or `init`. |
| `run:.`, `explain:<name>` | A walkthrough from 0.11 or earlier: the default run's own files in `.mr-cast/` (other runs stay), or an explanation in `.mr-cast/explain/<name>/`. |
| `video:<run>/<file>.mp4` | A rendered video. `<run>` is a run name, or `.` or `explain/<name>` for 0.11 data. |
| `stills:<run>`, `audio:<run>` | A run's PNG stills, or its voice-over clips and `voiceover.json`. `still` and `voice` make them again. |
| `cache:bundle`, `cache:remotion`, `cache:models` | The player bundle, Chrome Headless Shell (about 580 MB), or the Kokoro voice model (about 90 MB). The next render or voice-over downloads or rebuilds them. |

`--older-than <days>` lists only what has not changed in that many days. `--json` prints the list as JSON for scripts and the skill. `mr-cast prune <id>...` deletes only ids from a fresh listing, with the same `--older-than` filter. An unknown id, or a cache entry that a render is using or a download holds the lock on, makes it delete nothing. Deleting a run also deletes its videos, stills and clips.

## Explanations

A walkthrough of an explanation has no diff. `mr-cast init` starts it, `mr-cast snippet` adds the code it shows, and the other commands work on it as on a branch's walkthrough. Run them from the directory the explanation is about, usually the repository root.

A snippet renders as a code scene with a neutral SOURCE badge and its line range. It has no added or removed lines, so it uses the single-column view. Focus steps, the callout and the `flow` step diagram work as they do for a diff hunk. Without a focus the whole snippet is one step, and `validate` requires a focus on snippets longer than 12 lines.

`validate` skips the diff rules for an explanation. It does not check hunk coverage, `skipped`, test files, or the tests scene, and the intent scene's `risk` is optional. It still checks the schema, focus limits, `flow` steps, and that the video opens with an intent scene and shows a diagram before the code. Its summary ends in `explain` instead of hunk coverage. An explanation has no diff, so `validate` warns about every `change` mark in one, unless the storyboard or the scene sets `"explainsChange": true` because it explains a change. An older `modified: true` on a node or message becomes a highlight there instead of a CHANGED mark.

## Simple style

The simple style is for a viewer who is new to the code, reads English as a second language, or both. The walkthrough explains the changed code line by line in plain words, and shows the unchanged code the change depends on before the change itself. Pass `--audience new` (or `--simple`) to each command. `validate` and `outline` then name the style, and in it `validate` also checks:

- Every code scene uses `steps`, and each step highlights at most 3 lines. A step past 6 lines is an error.
- Every changed line of a hunk the video shows is inside a step of some scene showing it. The warning lists the lines left out. Blank lines and snippets are not counted.
- Sentences stay short. It warns about a sentence over 18 words and about a scene whose sentences average more than 12.

The skill switches to this style when you answer that the video is for someone new to the code, or when the request asks for it. `examples/demo-simple/` is the demo change told this way.

## Voice

`play` and `render` read each scene's narration aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small text-to-speech model that runs offline on the CPU. The first run downloads the model (about 90 MB) into `~/.cache/mr-cast/models`, or `$XDG_CACHE_HOME/mr-cast/models` when that is set. Speaking a scene takes a few seconds.

Each spoken text, a scene's narration or a step's `say`, is one clip, cached in the run's `audio/` under a hash of the voice, the speed and the text. A rerun speaks only the texts that changed and deletes clips that no scene uses. `voiceover.json` also records when each sentence of a clip starts and ends, so the subtitles follow the voice through the pauses.

These are [settings](#runs): flags that apply to the one command they are given to. `voiceover.json` records the voice and pace its clips were made with, but a later command does not take them from it.

- `--voice <name>` picks the voice. The default is `af_heart`. Others include `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `bf_emma`, and `bm_george`.
- `--pace <slower|normal|faster>` sets how fast the voice speaks and how long it pauses. `slower` is speed 0.85 with every pause 1.5 times as long, and `faster` is speed 1.15 with pauses 0.85 times as long. `play` and `render` print `mr-cast: pace: slower` when the pace is not normal. Changing the speed voices every clip again, and so does going back to it.
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
| `graph` | A node id, an edge `"from->to"` (or `"a-b"` for either direction), a group `"group:Support team"`, or an edge index. |
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

### Pen marks

A step can also draw on what it points at, the way a reviewer circles something on a printout. Give the step a `mark` and, if you like, a `note`:

```json
{ "focus": "redis", "mark": "arrow", "note": "no fallback", "say": "If Redis goes down, every order fails." }
```

| `mark` | Draws |
| --- | --- |
| `circle` | A loop around it. |
| `underline` | A line under it. |
| `box` | A rectangle around it. |
| `arrow` | An arrow at it from a free spot nearby, with the note at its tail. |
| `strike` | One line through it. |
| `cross` | An X over it. |

The mark goes on the step's first `focus` ref, all of it for a range such as `"3-5"`. A code step marks its `lines`, or, with a `token`, only that text on them: `{ "lines": 8, "mark": "circle", "token": "max: 20", "say": "..." }`. The `note` is a few handwritten words, up to 40 characters, placed beside the mark where it covers the least, never on the target.

The pen starts just after the step lights, and the mark is complete one frame before the step's words begin, which is half a second later at the normal pace. The mark fades out when the next step starts, and a mark on the last step stays until the scene ends. A mark never carries over to later steps, since a screen with several old marks on it points nowhere.

Each scene works out where its items are from the layout it already draws, so stills and renders always put a mark in the same place. The intent scene, which the browser lays out, measures where its bullets landed. The notes use the Caveat typeface ([SIL Open Font License](src/assets/caveat-OFL.txt)), bundled with mr-cast.

`validate` rejects an unknown `mark`, a `note` over 40 characters or without a `mark`, a `token` on a step that is not a code step, and a `token` that does not occur exactly once on its step's lines. It warns when a scene marks more than 2 steps, because a mark on most steps stops telling the viewer where to look. `outline` counts each scene's marks.

These are not the `change`, `highlight` and `badge` marks below, which belong to an item for the whole scene. A pen mark belongs to one step.

### Text on screen

A scene never cuts its text. Every label, caption, bullet, note, cell and title wraps to the lines its place allows, then shrinks to the smallest size it still reads at. Text that does not fit even then is drawn at that size, running a little past its box, and `validate` fails, naming the scene, the item, the exact text and a fix:

```
scenes[2] ("Who calls whom").messages[4].label: "POST /orders/{orderId}/line-items/{lineItemId}/adjustments" does not fit its message label, even at 15px; shorten the label, or split the message in two
```

`validate` runs the player's own layout code to decide this, so it and the video always agree. A file's name or path, a hunk header and a line of code are the source's own, so they shrink further with a warning instead. Widths come from `shared/font-metrics.mjs`, measured per character, weight and size in the browser that renders stills and videos.

On-screen text takes inline markup, for the one word or value a sentence is about:

| Markup | Draws |
| --- | --- |
| `**bold**` | Heavier weight. |
| `` `code` `` | A monospace chip. Everything inside is literal. |
| `==marked==` | A highlighter behind the words. |
| `[words]{tone}` | The words in a tone: `good`, `bad`, `warn`, `accent` or `neutral`. |

Bold and code may sit inside a mark or a tone, and nothing else nests. `**` and `==` open only before a word and close only after one, so `a ** b` stays literal, and `[` is markup only when `]{tone}` follows. A backslash keeps `*`, `` ` ``, `=`, `[`, `]`, `{` or `}` literal. Code names, file paths and test names are shown as written. `validate` fails on unclosed markup or an unknown tone, with its column, and warns when more than a third of a text of three or more words is styled. Narration, `say` and pen notes stay plain: their markup is dropped before the voice and the subtitles, with a warning.

### Diagram nodes

Graph nodes and sequence participants are the same kind of card, so they can show people, teams, places and documents as well as services. Each has an `id` and a `label`, plus:

- `icon`: any [Lucide icon](https://lucide.dev/icons) name in kebab-case, such as `user`, `users`, `headset`, `building-2`, `server` or `database`. `validate` rejects a name Lucide lacks and suggests close ones. Without it the card has no icon.
- `caption`: a short line under the label, such as `customer` or `datastore`. Without it there is none.
- `change`, `highlight` and `badge`: see [Marks](#marks).
- `tone`: the colour of the icon and the badge (`neutral`, `accent`, `good`, `bad` or `warn`), to tell kinds of things apart.

A graph node also takes a `group`. Nodes with the same group are drawn inside one labelled box, in the order each group's first node appears. A graph edge takes a `label`, a `direction` (`forward` by default, `both` for a two-way relationship, `none` for a plain line), a `style` (`flow` moves dashes along a forward edge, `solid` is a still line and the default otherwise, `dashed` is for a weak or indirect link), and a `change` or `highlight`. A graph scene lays out left to right, or top to bottom with `"layout": "TB"`, which suits hierarchies and teams. `validate` warns past 12 nodes. Storyboards from 0.13 and earlier call this scene `arch`, which still works.

A graph node's `shape` draws a flowchart:

| `shape` | Draws |
| --- | --- |
| `card` | The default: the card above, with its icon and caption. |
| `decision` | A diamond holding a short question, such as `"Cache hit?"`. Label each edge leaving it with its answer, such as `"yes"` and `"no"`. |
| `terminal` | A pill, for where the flow starts or ends. |
| `step` | A plain box for an action, with a caption and no icon. |

Each node gets a cell as tall as the graph's diamonds, which take the least height at which every question keeps 20px, and edges meet a diamond at its points and a pill at its ends. A graph with a decision lays out top to bottom unless it sets `layout`, draws still arrows unless an edge sets `style`, and its header says Flowchart. Focus, pen marks, badges, `change` and `highlight` work on every shape. `validate` warns about an icon or caption a shape does not draw, a decision with fewer than two outgoing edges, and a decision's edge without a label. A flow step takes an `icon` and a `tone` for its actor.

Older storyboards that give a node `kind` (`service`, `db`, `queue` or `client`) and `modified: true` still work: `kind` stands for an icon and caption, and `modified` for a `modified` change, or a highlight in an explanation.

### Marks

Three marks say three different things, and one never stands in for another:

- `change` says what the diff does to an item: `added` (green, NEW), `removed` (red, dashed and struck through, REMOVED) or `modified` (blue, CHANGED). Mark exactly what the diff changes. A viewer reads every change mark as a fact about the diff.
- `highlight: true` says "look here" for a part the whole scene is about. It draws a soft white glow and no word, a colour no change uses. To point at parts one at a time as the voice names them, use `steps` instead.
- `badge` is a label of your own, up to 14 characters, such as `"hot path"`, `"v2"`, `"owner"` or `"key"`, drawn as a pill in the item's `tone` (neutral by default). Next to a change badge it comes second.

| Item | `change` | `highlight` | `badge`, `tone` |
| --- | --- | --- | --- |
| graph node, sequence participant | yes, with a badge | yes | yes |
| graph edge | yes | yes | no |
| sequence message | yes, with a badge | yes | yes |
| er table | yes, with a badge | yes | yes |
| er field, er relation, state transition | yes, by colour and a `+`/`−`/`~` marker | yes | yes |
| state | yes, with a badge | yes | yes |
| table row | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| timeline event, span | no | yes | yes (events and spans already take `tone`) |
| files entry | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| tests case | its `status` | no | yes |

Badges, legends, code headers and the tests scene use one set of words for a change: NEW, CHANGED and REMOVED. A code scene's header says RENAMED for a renamed file and SOURCE for a snippet.

`validate` keeps the marks honest:

- In a diff walkthrough it warns when more than 60% of the items of a graph, sequence, er or state scene carry change marks (from 4 items up), since the marks then stop telling the viewer what changed.
- It warns when an er table or field, a state, or a table row is marked `added` or `removed` but its name appears on no changed line of the diff, and when a files entry's `change` disagrees with `hunks.json`.
- In an explanation it warns about any change mark unless `"explainsChange": true` is set on the storyboard or the scene.
- It warns when a `badge` is a change word (`new`, `added`, `changed`, `modified`, `removed` or `deleted`): use `change` for the diff instead.

A tests scene that is not about a diff's tests can rename its panels with `titles`, for example `{ "subject": "Checked", "proves": "Shows", "gaps": "Open questions", "none": "Nothing checks this yet" }`.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets, and diff stats. |
| `graph` | Nodes and edges, laid out automatically left to right or top to bottom, with groups drawn as labelled boxes. Nodes can be services, people, teams or anything with a [Lucide icon](https://lucide.dev/icons), or flowchart shapes: decisions, terminals and steps. Changed, highlighted and badged nodes and edges are marked. With `steps`, the voice walks the graph node by node and edge by edge. |
| `code` | One hunk or snippet, in split or morph view. Focused lines stay bright, and a callout explains them. With `steps`, each highlight has its own spoken words. |
| `flow` | A step-by-step trace with the payload at each step. With a `say` on each step, the current step follows the voice. |
| `sequence` | A sequence diagram: participants (the same cards as graph nodes) with lifelines, and call, return and async messages drawn in order. Changed, highlighted and badged messages are marked. With `steps`, messages draw in as the voice reaches them. A sequence taller than the frame keeps its rows readable and scrolls under its pinned participants: each step eases the camera to its messages, and without steps the camera pans from the first to the last while the narration speaks. A still shows where the last step leaves it. `validate` warns past 24 messages. |
| `er` | An entity-relationship diagram with crow's-foot relations. Added, removed and modified tables, fields and relations are marked. With `steps`, each table, field or relation lights as the voice names it. |
| `state` | A state machine with an entry dot, final states, and labelled transitions. Added, removed and modified states and transitions are marked. With `steps`, each state or transition lights as the voice names it. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph, pie, ...) drawn as a static themed SVG. A fallback for diagrams the other scenes don't cover. |
| `tests` | A test matrix: each test case with its status (new, changed, removed, existing) and the behavior it proves, then a "Not tested" panel listing important behaviors no test covers. With no cases it states that the change has no tests. `titles` renames the panels. |
| `table` | Rows and columns of text, such as settings, API parameters or error codes. Added, removed and modified rows are marked, a changed cell strikes its old value beside the new one, and `highlight` spotlights rows one at a time. With `steps`, each row, column or cell lights just before its own spoken words. |
| `chart` | A bar or line chart of one or more series over labels, with value labels and a unit. Bars grow and lines draw in. With two series, such as before and after, each label gets a change badge like −42%, green or red by `better`. `annotation` calls out one point. With `steps`, each label, series or value lights as the voice names it. |
| `timeline` | Events on a time axis in ms, s, min, h or d, each with a label and detail, and `spans` for waits and windows drawn under the axis with their length. A playhead reveals them left to right before the voice starts, or with `steps` moves to each step's events as the voice reaches them. |
| `files` | The changed files as a tree with line counts and a diffstat bar, tests marked, and a short note beside the files the narration names. Without `files` it lists every file in `hunks.json`; an explanation lists its own. Files with notes, or `highlight`, are spotlit in turn, and with `steps` each file lights just before its own spoken words. A long tree flows into two columns. |

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/demo-simple/` tells the same change in the simple style, with a context snippet and steps on every code scene. `examples/gallery/` shows the `files`, `state`, `table`, `chart`, `timeline`, `mermaid` and `tests` scenes and a flowchart `graph`, with steps on the state, the flowchart, the table, chart and timeline. `examples/people/` explains how a support ticket gets resolved, with no code at all: people and teams in groups, a path walked step by step, a sequence between people, and a timeline. The demo arrows a note at Redis and circles `max: 20` in the code, the gallery circles the flowchart's new step and a table cell, and the people example circles one item. The demo and the gallery each style a few words with markup.

## Layout

- `bin/` holds the CLI. `lib/diff.mjs` is the unified diff parser, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` generates the voice-over. `lib/runs.mjs` finds a command's run (the current one, `--name` or `--dir`), `lib/settings.mjs` turns a command's flags into its settings and keeps the last choices, `lib/lock.mjs` guards downloads into the shared cache and marks caches in use, and `lib/prune.mjs` lists and deletes artifacts for `prune`.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/timing.mjs` holds the duration formula that the CLI and the player share: a scene is a sequence of spoken segments, its narration and then each step, each with a lead and a tail scaled by the pace, and each scene type's build time, which the narration waits for. `shared/steps.mjs` lists the steps each scene type speaks, and `shared/targets.mjs` what a step's `focus` can name in each scene type. `shared/normalize.mjs` rewrites older field names once, where a storyboard enters. `shared/voice.mjs` names each clip by its voice, speed and text, and defines the paces. `shared/files.mjs` builds the file list of a `files` scene for both. `shared/pen-marks.mjs` says what a step's pen mark draws on, and `src/components/PenMarks.tsx` draws every scene's marks from the boxes the scene gives it.
- `shared/textfit.mjs` fits a text to its place: it wraps, shrinks and reports what does not fit, from the widths in `shared/font-metrics.mjs` (made by `node scripts/measure-fonts.mjs`). `shared/markup.mjs` parses inline markup. Each scene fits its text in layout code under `src/utils/`, against the places listed in `src/fit/slots.ts`, and draws it with `src/components/FitText.tsx`; `src/fit/report.ts` runs the same layouts for `validate` (`bin/lib/validate-fit.mjs` bundles it with esbuild). `scripts/check-text.mjs`, part of `npm run typecheck`, fails on text clipping or an ellipsis under `src/`.
- `bin/lib/explain.mjs` turns source line ranges into snippets for `snippet`.
- `skill/mr-cast/` (`SKILL.md` and `references/branch.md` and `references/explanation.md`), `skill/mr-cast-prune/SKILL.md` and `skill/mr-cast-upgrade/SKILL.md` are the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).

For development, run `npm run dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set.
