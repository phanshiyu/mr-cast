# mr-cast

mr-cast turns the diff of a git branch into an animated walkthrough video. An LLM writes a short storyboard that points at diff hunks by id, and mr-cast plays it in a browser or renders it to MP4 with Remotion.

It can also animate an explanation that has no diff behind it, such as how a subsystem works or why a bug happens. The scenes are the same, and code scenes show snippets of real source files instead of diff hunks.

## Install

mr-cast needs Node 22.12 or newer on macOS or Linux. CI tests Node 22, 24 and 26, and Node 24 LTS is the one to pick. The `mr-cast` launcher finds Node through PATH, nvm or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill   # installs the mr-cast, mr-cast-prune and mr-cast-upgrade skills
mr-cast --version       # prints the mr-cast and Node versions
```

npm 11.19 and later skip the install scripts of dependencies and list them as warnings. mr-cast needs none of them. `pnpm add -g @shiyuphan/mr-cast` works too.

The skills point at the installed package, so rerun `mr-cast install-skill` after you move it. After an upgrade, the next `mr-cast` command reinstalls them (see [Upgrade](#upgrade)). Each install records what it wrote in `~/.claude/.mr-cast-install.json` and deletes anything an earlier install wrote that this version no longer does. `mr-cast uninstall-skill` removes every skill mr-cast installed, and the record. Both print each file they remove, and neither touches a file whose content mr-cast did not write.

To run from a clone, use [pnpm](https://pnpm.io). `corepack enable` provides the version pinned in `package.json`.

```bash
pnpm install
pnpm build              # prebuilds the player into dist/
pnpm install-skill
```

## Use it from Claude Code

Type `/mr-cast`, or ask Claude to "create a video from this merge request". After Claude explains something, ask it to "animate that". One skill makes both kinds of video, and it picks the source from your words:

- A base branch, `--working`, "this branch", "PR", "MR" or "diff" means the branch's changes.
- "That", "what you said" or "this explanation" means the explanation Claude just gave.
- A bare "make a video of this" uses whichever source exists. When the branch has changes and both exist, the first question asks which one. When neither exists, the skill says what it can make and stops.

For a short diagram of one thing, say "quick", "just a diagram" or "explain this flow in a diagram", or highlight code in your editor and type a bare `/mr-cast`. Quick mode asks nothing, opens no plan page, and plays 1 to 3 scenes, about a minute, in the browser about 20 seconds later. The page opens once the voice is ready, about 16 seconds for a 2-scene video. The selection reaches Claude only when Claude Code is connected to the IDE, through `/ide` or the IDE's integrated terminal. The video ends on three next steps: "go deeper" for a full video of the same code, "the whole branch", and "save it" for an MP4.

For a full video, the skill asks up to three multiple-choice questions at once:

- Who the video is for: a reviewer or teammate, someone new to the code, the team in a short overview, or a reviewer who will read the code next. See [Pre-read](#pre-read).
- The pace: normal, slower, faster, or no voice.
- For a branch, whether Claude should also flag what looks wrong. The default is no. See [Review mode](#review-mode).

The recommended answer is first in each question, so pressing enter gives the default video. A question your request already answers is skipped. Your last audience and pace are offered first next time, marked "(Last time)". Say "just make it", "use the defaults" or "no questions" to skip the questions.

Next, Claude reads the change and opens the plan page in your browser. It lists the topics of this change, such as "Rate limiter: twenty orders a minute", with Claude's suggestion preselected. For each topic you pick a depth and a way to show it:

- **Skip, Brief or Deep.** Brief shows the topic's picture and its key lines. Deep shows the picture, then the code line by line.
- **How it is shown.** Two or three options in plain words, such as "Who calls whom, in order", "The data at each step" or "Before vs after". Hover one to see which scene draws it.

The length estimate at the top follows your picks, and every change saves at once. Use the mouse, or the keys: up and down move between topics, 1, 2 and 3 pick Skip, Brief and Deep, and left and right change how it is shown. Then go back to the terminal and press Enter on the question Claude is waiting with. Answer "Use your picks" to skip the page, or type a change such as "add the migration as its own topic", and the page reloads with it. Claude skips the page when you said "just make it" or "no questions", and when the change has two topics or fewer.

Claude then writes a short teaching article from your picks, `article.md` in the run's directory: the takeaways, one section per idea traced through one running example, questions with answers, and what it left out. A second Claude reads only the article, without the answers, and answers its questions; Claude revises the article where that reader went wrong, at most twice. You see the takeaways in a few lines. Say "just the article" or "no video" to stop there. See [The article](#the-article).

Claude adapts the article into the storyboard, validates it, and opens the browser player, which reloads as Claude edits. The player has a Plan tab with the same picks. A pick you change there is marked "Changed, not in the video yet". Say "update the video", and Claude rewrites only those topics. For a file to share, say "mp4", "video file", "render", "save" or "share", or type `/mr-cast mp4` (`/mr-cast mp4 main` for another base). Before rendering, Claude shows the outline and asks once whether to render it, make it shorter or longer, or change something. The MP4 is named after the walkthrough's title, such as `.mr-cast/feature-rate-limit/rate-limiting-for-the-orders-api.mp4`, and has a chapter marker for each chapter.

For a walkthrough that explains the code line by line in plain words, ask for it "like I'm new to this", "line by line", "ELI5" or "for a non-native speaker", or answer that the video is for someone new to the code. Claude then reads the callers, types, tests and config around the change, shows the important ones first, and voices each line or small group of lines while it is highlighted. See [Simple style](#simple-style).

To free disk space, ask Claude to "prune mr-cast" or "clean up old mr-cast videos". The `mr-cast-prune` skill shows a menu of what to delete that the CLI builds, with sizes, and runs the command the CLI gives for each pick. Claude never chooses files or deletes them itself. See [Pruning](#pruning).

To update mr-cast, ask Claude to "upgrade mr-cast". See [Upgrade](#upgrade).

## Upgrade

```bash
mr-cast upgrade --check   # prints the installed and the latest version
mr-cast upgrade           # installs the latest version, then reinstalls the skills
```

From Claude Code, ask Claude to "upgrade mr-cast". The `mr-cast-upgrade` skill checks the versions, asks before it upgrades, and runs `mr-cast upgrade`. Start a new Claude Code session afterwards, since an open session keeps the skills it loaded.

`mr-cast upgrade` updates mr-cast in place only when `npm install -g` or `pnpm add -g` installed it, and it uses that same package manager. In a clone it prints the update steps instead (`git pull`, `pnpm install`, `pnpm build`, `pnpm install-skill`), and for any other install it prints the npm command. If npm cannot write to its global directory, follow [npm's guide to a user-owned prefix](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

You can also run `npm install -g @shiyuphan/mr-cast@latest` yourself. The skills record which package installed them and its version, so the next `mr-cast` command after an upgrade reinstalls them and prints `mr-cast: updated Claude Code skills to <version>`. Skills installed from another copy, such as a clone, stay as they are.

Once a day, a command checks npm for a newer version in the background without waiting for the answer. When one is out, later commands print ``mr-cast <version> is available (you have <version>). Run `mr-cast upgrade`.`` on stderr. The result is cached in `~/.cache/mr-cast/update-check.json`, or under `$XDG_CACHE_HOME` when that is set. The check is off in a clone and when `CI`, `NO_UPDATE_NOTIFIER` or `MR_CAST_NO_UPDATE_CHECK` is set.

## Commands

`mr-cast help` lists the commands you run yourself first, then the ones the skills run. `mr-cast help --all` adds every option.

Run these from inside the repository you want to explain. Output goes to `.mr-cast/`, which `extract` and `init` add to `.git/info/exclude`.

| Command | What it does |
| --- | --- |
| `mr-cast status` | Prints the branch, the commits and files it has ahead of its base, the uncommitted files, and the audience and pace you chose last time. The skill picks the video's source from it. |
| `mr-cast extract [base] [--working]` | Starts a walkthrough of the branch's diff in `.mr-cast/<branch-slug>/`. It diffs `base...HEAD`, writes `hunks.json` and `meta.json`, and prints a compact hunk index with line numbers. `--working` diffs the merge base against uncommitted changes. Lockfiles and build output are skipped unless you pass `--all-files`. Running it again on the same branch keeps the storyboard and the snippets. |
| `mr-cast init --title text [--reset] [--quick]` | Starts a walkthrough of an explanation in `.mr-cast/<title-slug>/` (in the git repository, or the current directory outside one) and prints its path. A slug already in use gets a numbered suffix such as `-2`. Running it again with the same title reopens the walkthrough and keeps its storyboard and snippets. `--reset` deletes them. `--quick` starts a quick video in `.mr-cast/quick-<title-slug>/`, which `validate` lets open without an intent scene and warns past 3 scenes or about 60 seconds of narration. `--quick` needs `--title`. A later `init` of the same title without `--quick` starts the full video from the quick one's storyboard, snippets and voice, unless the full video already has a storyboard or snippets, or `--reset` is given. |
| `mr-cast snippet <file>:<start>-<end> ...` | Adds those lines of unchanged source to `hunks.json` as snippets `s1`, `s2` and so on, and prints each with the file's own line numbers. Use it for the code of an explanation, or for the callers, types or config a change depends on. Snippets don't count toward hunk coverage, a later `extract` keeps them, and each holds at most 80 lines. `<file> <start>-<end>` also works, and adding the same range again keeps its id. |
| `mr-cast plan [--port N] [--no-open]` | Checks the run's `plan.json`, the topics Claude cut the change into, then serves the plan page at `http://127.0.0.1:4747/plan` and opens the browser. The page saves each pick into `plan.json`, and reloads when Claude edits it. See [The plan](#the-plan). |
| `mr-cast article [--reader]` | Checks the run's `article.md` and prints its takeaways. `--reader` prints it without the answers to its questions. See [The article](#the-article). |
| `mr-cast schema [type]` | Prints the storyboard's TypeScript schema from `src/types.ts`: with a scene type such as `array`, that scene and every type it uses; alone, the storyboard and what every scene shares; `all` for everything. |
| `mr-cast validate` | Checks `storyboard.json` against the schema and `hunks.json`, and against the simple style's rules when the audience is `new`. With a `plan.json`, it also checks each scene's `topic` and the storyboard's `plan` against your picks, and records that `plan` in `plan-built.json`. Prints the length, estimated at the given `--pace` until the narration is voiced. Exits 1 on errors. |
| `mr-cast outline` | Prints a short plan of a valid storyboard to show a person before rendering. It has the title, one line per scene with its type, chapter and contents, the length, the style, the hunk coverage, and how many steps draw a pen mark. With a `plan.json`, the scenes are grouped by topic, and skipped topics are listed. |
| `mr-cast voice` | Speaks each scene's narration and each step into the run's `audio/` and writes `voiceover.json`. Only changed text is spoken again. |
| `mr-cast play [--port N] [--no-open]` | Serves the player at `http://127.0.0.1:4747` and prints its URL at once, voices the narration with its progress on one line, then opens the browser. A page opened before the voice is ready waits for it. If the voice fails, the page opens silent and says so. When `storyboard.json` changes, the page keeps playing its version and shows "Updating..." until the changed narration is voiced, then reloads once. The player's speed control goes from 0.75x to 1.5x. With a `plan.json`, the player has a Plan tab. |
| `mr-cast render [--out file.mp4]` | Voices the narration, then renders a 1920x1080, 30 fps MP4 with the voice-over, burned-in subtitles and chapter markers, and prints its path. The file goes in the run's directory, named after the storyboard title, or the run's name, or `walkthrough.mp4`. The first render downloads Chrome Headless Shell into `~/.cache/mr-cast/remotion`. |
| `mr-cast still [sceneIndex...]` | Renders a PNG of each scene's end state, just before it fades out, to check layout. |
| `mr-cast steps [sceneIndex...]` | Prints each step's words beside what it lights and what it changes on screen, with the highlight warnings, to check that the lit part matches the words. Code scenes are left out. |
| `mr-cast prune [id...] [--kind k,k] [--all] [--older-than days] [--except id] [--dry-run] [--json]` | Without a selector, lists what can be deleted, with an id, size, age and description for each. With ids, `--kind` or `--all`, deletes exactly what they pick, or with `--dry-run` only prints it. `--choices` prints a menu of common picks. See [Pruning](#pruning). |
| `mr-cast upgrade [--check]` | Updates mr-cast to the latest version and reinstalls the skills. `--check` only reports the versions. See [Upgrade](#upgrade). |
| `mr-cast version` | Prints `mr-cast <version> (node <version>)`. Also `--version` and `-v`. |

### Runs

Each walkthrough is a run, one directory in `.mr-cast/` made by `extract` or `init`. The new run becomes the current one, recorded in `.mr-cast/.current`. Later commands work on it and print its name on stderr. Pass `--name <slug>` to `extract` or `init` to name a run, and to any later command to work on another run. A slug is lowercase letters, digits and dashes, and `explain`, `audio` and `stills` are reserved for older versions' folders. `--dir <path>` points a command at any other directory, such as a walkthrough made by 0.11.

These settings are flags on `extract`, `init`, `validate`, `outline`, `voice`, `play`, `render` and `still`. A flag applies to its own command only, and the run does not keep it, so pass the same flags to every command of a walkthrough.

| Setting | What it does |
| --- | --- |
| `--audience familiar\|new\|overview\|preread` | Who the video is for: someone who knows the code (the default), someone new to it, the team in a short overview, or a reviewer who reads the code next. `new` is the [simple style](#simple-style), and `--simple` means the same. `preread` is the [pre-read](#pre-read). |
| `--pace slower\|normal\|faster` | How fast the voice speaks and how long it pauses. The default is `normal`. See [Voice](#voice). |
| `--speed x` | The voice's speed alone, from 0.5 to 2. It overrides the speed `--pace` sets. |
| `--voice name` | The Kokoro voice. The default is `af_heart`. |
| `--no-voice` | A silent walkthrough with subtitles timed for reading. |

The skill remembers your last `--audience` and `--pace` (or `--no-voice`) in `~/.config/mr-cast/last-choices.json`, or under `$XDG_CONFIG_HOME` when that is set, to offer them first next time. `mr-cast status` prints them.

Several runs can render at once, in one repository or several, and they share the cache in `~/.cache/mr-cast`. Each render bundles the player into a temporary folder and moves it into the cache when complete, so no render reads a half-written bundle. Bundles of other versions are deleted after an hour unused. The Chrome and voice model downloads take a lock, so a second render waits for the first download. A running render marks the bundle and Chrome caches in use, and `mr-cast prune` refuses to delete them meanwhile.

### Pruning

`mr-cast prune` lists everything mr-cast stored that you can delete, from `.mr-cast/` in the git repository (or the current directory outside one) and from the shared cache. Each line has an id to pass back.

| Id | What it deletes |
| --- | --- |
| `run:<name>` | A walkthrough in `.mr-cast/<name>/`, of a branch (kind `run`) or an explanation (kind `explain`). Deleting the current run clears `.current`, so later commands need `--name` or a new `extract` or `init`. |
| `run:.`, `explain:<name>` | A walkthrough from 0.11 or earlier: the default run's files in `.mr-cast/` (other runs stay), or an explanation in `.mr-cast/explain/<name>/`. |
| `video:<run>/<file>.mp4` | A rendered video. `<run>` is a run name, or `.` or `explain/<name>` for 0.11 data. |
| `stills:<run>`, `audio:<run>` | A run's PNG stills, or its voice clips and `voiceover.json`. `still` and `voice` make them again. |
| `cache:bundle`, `cache:remotion`, `cache:models` | The player bundle, Chrome Headless Shell (about 580 MB), or the Kokoro voice model (about 90 MB). The next render or voice-over rebuilds or downloads them. |

`--older-than <days>` lists only what has not changed in that many days. `--json` prints the list as JSON.

To delete, pick with selectors, which combine. Ids pick those artifacts, `--kind run,explain` picks every artifact of those kinds (`run`, `explain`, `video`, `stills`, `audio`, `cache`), and `--all` picks everything. `--older-than <days>` then keeps only what has not changed in that many days, and `--except <id>`, repeatable, keeps an artifact. Keeping a walkthrough keeps its parts, and keeping a part keeps its walkthrough. The selection is made from a fresh listing. An artifact in use, such as the Chrome cache during a render, is never picked and is printed as `in use, not removed`. An unknown id, or one in use named by id, makes it delete nothing. Deleting a run also deletes its videos, stills and clips, and their bytes count once.

`--dry-run` prints exactly what would be removed and the bytes, and removes nothing. With `--json`, a dry run or a deletion prints `dryRun`, the `artifacts` with their bytes, `inUse`, and the total `bytes`.

`mr-cast prune --choices --json` prints the menu the prune skill shows. It has up to four groups (rendered videos, stills and voice clips, walkthroughs, cache), each with at most 4 options, and leaves out empty groups. Each option has a `label`, a `description` with its size and what deleting it means, the `ids` it deletes, and a `command`, the exact arguments that delete it, such as `["prune", "--kind", "video"]`.

## The plan

`plan.json` holds the topics of one walkthrough. Claude writes it in the run's directory before the storyboard. Each topic has an `id`, a `title`, a one-line `summary`, its `files`, a suggested `depth` (`skip`, `brief` or `deep`), one to three `views` with the suggested one first, an optional `why`, and `seconds`, about how long it takes at `brief` and at `deep`. The schema is `Plan` in `src/types.ts`, and the views are listed in `shared/views.mjs`, each with the plain label the page shows and the scene types that draw it.

The page writes your pick as the topic's `choice`, `{ "depth": "deep", "view": "compare" }`, and nothing else. It sends each pick to the local server, which listens on 127.0.0.1 only. Every write needs the random token in the URL mr-cast opened, so another web page cannot change your plan. The server accepts only a `choice` for a known topic with a depth and view that topic offers, and writes `plan.json` by renaming a complete file into place. Opened without the token, the page is read-only.

Each scene of the storyboard names its topic in `topic`. `validate` fails on a topic that is not in the plan, and warns when a topic you kept has no scene, when a topic you skipped still has scenes, and when a scene does not draw the view you picked.

## The article

A full video starts as an article that teaches on its own: "explain quicksort" gives an article you can learn quicksort from. It is written with no thought of the screen, then adapted. Its shape is fixed so `mr-cast article` can check it:

```markdown
# How quicksort sorts a list
## Takeaways
1. ...
## A partition puts the pivot in its final place {#partition}
...
## Questions
1. After the first partition of [7, 2, 9, 4, 3], which values are left of 3?
   Answer: only 2.
   Takeaway: 1
## Left out
- ...
```

`mr-cast article` fails on a missing part, a section without an id, or a question without its answer or takeaway, warns about phrases about the medium such as "the next scene" or "on screen" outside code, and prints the takeaways. `mr-cast article --reader` prints it without the answers, for the reader test. With a `plan.json`, each topic you kept is the section of that id. Each scene names the section it adapts in `section`, or through its `topic`. `validate` fails on an unknown section and warns about a section no scene adapts, unless the storyboard's `textOnly` lists it with a reason, and about scenes out of the article's order. `render --out` writes the article beside the MP4.

## Explanations

A walkthrough of an explanation has no diff. `mr-cast init` starts it, `mr-cast snippet` adds the code it shows, and the other commands work as they do on a branch. Run them from the directory the explanation is about, usually the repository root.

A snippet renders as a code scene with a neutral SOURCE badge and its line range, in the single-column view. Focus steps, the callout and the `flow` step diagram work as they do on a hunk. Without a focus the whole snippet is one step, and `validate` requires a focus on snippets longer than 12 lines.

`validate` skips the diff rules for an explanation: hunk coverage, `skipped`, test files and the tests scene. The intent scene's `risk` is optional. It still checks the schema, focus limits and `flow` steps, and that the video opens with an intent scene and shows a diagram before the code. It warns about every `change` mark, since an explanation has no diff, unless the storyboard or scene sets `"explainsChange": true` because it explains a change.

## Simple style

The simple style is for a viewer who is new to the code, reads English as a second language, or both. The walkthrough explains the changed code line by line in plain words, and shows the unchanged code the change depends on before the change itself. Pass `--audience new` (or `--simple`) to each command. `validate` and `outline` then name the style, and `validate` also checks that:

- Every code scene uses `steps`, and each step highlights at most 3 lines. A step over 6 lines is an error.
- Every changed line of a hunk the video shows falls inside some step. The warning lists the lines left out, not counting blank lines and snippets.
- Sentences stay short. It warns about a sentence over 18 words, and about a scene whose sentences average more than 12.

The skill uses this style when you say the video is for someone new to the code, or when your request asks for it. `examples/demo-simple/` is the demo change told this way.

## Pre-read

A pre-read is for the reviewer who will read the code after the video. Say "pre-read", "before I review", "no code on screen" or "without code", or pick "A reviewer who will read the code next" as the audience, and pass `--audience preread` to each command. The video builds the model with diagrams only and ends on the order in which to read the code, so the review that follows takes less effort. It is not the short overview: it covers the whole change, and only the presentation differs. It works for an explanation too, where the closing reading order is optional. Pass `--audience preread` every time: a storyboard with a reading scene or a `from` warns `this storyboard is a pre-read; pass --audience preread` without it.

- No code on screen. `validate` fails on a `code` scene, a code cell in a `compare` and a `review` scene, and warns about a label that writes an expression, such as `{ status: 'pending' }`, `=>`, `===`, `&&` or `claimDue(row, now)`. Labels use the real identifiers and file names, such as `checkLimit` and `limiter.ts`, and the facts a code line would show go into the labels and narration with their real values. The warning reads diagram labels only: a reading item's check may name an operator, such as "`>=` on (created_at, id)".
- Each diagram names the hunks it explains in `"from": ["h1", "h3"]`, at most 3. The scene shows them as a quiet "In the code: limiter.ts, server.ts" line. `validate` warns when a cited hunk's file name or one of its code-style identifiers (`checkLimit`, `MAX_REQUESTS`) appears in none of the scene's labels. The narration does not count.
- The closing `reading` scene lists the hunks in reading order, each with what to check there, such as "the key resets on a new minute; check the off-by-one". The file and lines come from `hunks.json`, and `"lines": "40-58"` points an item at the lines that matter inside its hunk, such as part of a new file. Wiring and config are marked `"routine": true` and collapse to one "skim" line. The scene shows the first 6 under "Read first" and counts the rest, such as "+2 more to read, +3 routine, in reading.md". `validate` warns about every substantial hunk that is in neither the reading order nor `skipped`. A topic the plan page makes brief or skips changes only the video: its hunks stay in the reading order.
- `validate` writes `reading.md` beside the storyboard: a ``- [ ] 1. `src/limiter.ts:12-30`: check`` checklist with each topic once, to paste into the merge request. `outline` prints the same order as `path:line` lines, which Claude Code makes clickable, and the player shows it in a Reading order panel with "Copy as checklist". Each item's "Explained in" seeks the video to the scene that explains it. A routine hunk of a file the order already lists rides on that item, as "also 1-6", rather than on a skim line.
- In review mode each finding sits on the reading item of the hunk that holds its line, in its severity's colour. There is no separate review scene. `review.md` is still written.
- On the plan page, no topic offers "Just the code". Brief is the topic's picture and its key fact. Deep adds a second diagram that traces one real case with the actual limits, keys and order.

## Review mode

By default the video explains the change and gives no verdict. In review mode Claude also flags what looks clearly wrong as it walks through the branch: an obvious bug, a missing `await` or error path, a wrong condition, a secret in a log, a risky path no test covers, or a confusing name. It is not a deep audit. Each flag is something a reviewer would read and say "wait, that's wrong".

Turn it on with the "Review" question, or ask for it with words such as "review it", "with your review", "find issues" or "flag anything that looks wrong". It needs a branch. An explanation has no diff to review.

Claude checks each flag against the code before it goes in. It reads the code around the line, finds the input that breaks it, and runs it when that is cheap. It drops anything it is not sure of. A review that finds nothing is a valid result, and the video then says so.

Each flag has a severity:

| Severity | Means |
| --- | --- |
| `bug` | Wrong today, with an input that breaks it. |
| `risk` | Breaks under some input or later, or leaks something. |
| `nit` | Small but worth a fix, such as a confusing name. |

The flags stay apart from the explanation, so the explanation can be trusted even where Claude is wrong:

- The flag appears where the walkthrough reaches its line. A pen circle in the severity's colour (red, orange or blue) rings the line, with the severity and a short handwritten note. The voice says it then, as an opinion: "I think this delete is a bug."
- A last scene, headed "Claude's review" and "My opinion, checked against the code", recaps every flag worst first, with its file and line. A review with no flags has no recap scene.
- `validate` writes `review.md` into the run's directory, with each flag as a `file:line` bullet and its evidence. `render --out` writes a copy beside the MP4, named after it. Claude's last reply lists the flags too.

The storyboard holds the flags in `findings`. Each has an `id`, a `severity`, a `file` and `line` from the diff, a one-line `claim` shown on screen, and one line of `evidence` written to `review.md`. A code step shows one with `"flag": "<id>"`. `"findings": []` records a review that found nothing.

```json
{ "id": "token-reused", "severity": "bug", "file": "src/reset.js", "line": 21,
  "claim": "Deletes by user id, so a used token still works",
  "evidence": "delete(row.userId) removes nothing, so the same token works twice" }
```

`validate` checks that each flag's file and line are in the diff, that its severity is `bug`, `risk` or `nit`, and that it has evidence. It checks that each `flag` names a finding and sits on the step whose lines hold its line. It requires the recap scene when there are flags, and rejects it when there are none. It warns about a flag that no code step shows, and about a flagged step whose words do not sound like an opinion. Review mode takes no flag on the command line, because the storyboard's `findings` record it.

`examples/review/` is a password reset change with a planted bug, risk and nit, reviewed this way, and `scripts/review-demo.sh <dir>` creates its git repository.

## Voice

`play` and `render` read the narration aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small text-to-speech model that runs offline on the CPU. The first run downloads the model (about 90 MB) into `~/.cache/mr-cast/models`, and each voice (about 0.5 MB) the first time it is used. Speaking a scene takes a few seconds.

Each spoken text, a scene's narration or a step's `say`, is one clip in the run's `audio/`, named by a hash of the voice, the speed and the text. A rerun speaks only the texts that changed. `voiceover.json` records when each sentence of a clip starts and ends, so the subtitles follow the voice through the pauses.

The voice settings are flags that apply only to the command they are given to (see [Runs](#runs)):

- `--voice <name>` picks the voice. The default is `af_heart`. Others include `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `bf_emma` and `bm_george`.
- `--pace <slower|normal|faster>` sets the speaking speed and the pauses. `slower` is speed 0.85 with pauses 1.5 times as long, and `faster` is speed 1.15 with pauses 0.85 times as long. `play` and `render` print `mr-cast: pace: slower` when the pace is not normal. Each speed keeps its own clips, so switching back does not voice them again.
- `--speed <x>` sets the speaking speed alone, from 0.5 to 2, and overrides the one `--pace` sets.
- `--no-voice` skips the voice-over. Scenes are silent and timed for reading at 130 words a minute, scaled by the pace.

If the model cannot load, for example offline on the first run, `play` and `render` warn and continue without voice, and `mr-cast voice` exits 1.

Browsers block autoplay with sound, so a voiced walkthrough waits for you to press play. `play` opens the page only once the voice is ready, so you never see the video without its voice unless you passed `--no-voice` or the voice failed.

The narration is written to be heard once, like one person explaining the change to another. The skill tells Claude to name what code does in plain words and to keep code names on screen. `validate` warns when spoken text reads a code name, a file path or a bare status code aloud, opens a scene with a bare "It" or "This", runs past 25 words in a sentence, or uses a term such as "idempotent" without explaining it. Each warning quotes the phrase and suggests what to say. The voice reads a few written forms as words, so "e.g." becomes "for example", "5s" becomes "5 seconds", "200 ms" becomes "200 milliseconds", an arrow becomes "to" and "v0.14.0" becomes "version 0 point 14 point 0". The subtitles show the same words.

## Storyboard

`src/types.ts` defines the schema. A storyboard has a title and a list of scenes, and each scene has `narration`.

To choose a scene for an idea, Claude reads the picker in the skill's `references/adapt.md`. Its index takes the idea as the article states it, such as "each pass bubbles the largest remaining value to the end", and names the scene that explains it with the least load, why, and when the runner-up wins. One file per scene says when it lowers load, when it adds load, and the mistakes that add it back, with an example that `validate` passes in the tests.

| Scene | Shows |
| --- | --- |
| `intent` | Summary, risk badge, bullets and diff stats. |
| `graph` | Nodes and edges laid out left to right or top to bottom, with groups drawn as labelled boxes. Nodes can be services, people, teams or anything with a [Lucide icon](https://lucide.dev/icons), or flowchart shapes. With `steps`, the voice walks the graph node by node and edge by edge. |
| `code` | One hunk or snippet, in split or morph view. Focused lines stay bright, and a callout explains them. With `steps`, each highlight has its own spoken words. |
| `flow` | A step-by-step trace with the payload at each step. With a `say` on each step, the current step follows the voice. |
| `sequence` | Participants with lifelines, and call, return and async messages in order. With `steps`, messages draw in as the voice reaches them. A sequence taller than the frame scrolls under its pinned participants, and each step moves the camera to its messages. `validate` warns past 24 messages. |
| `er` | Tables and crow's-foot relations. With `steps`, each table, field or relation lights as the voice names it. |
| `state` | A state machine with an entry dot, final states and labelled transitions. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph, pie, ...) as a static themed SVG, for diagrams the other scenes don't cover. |
| `tests` | Each test case with its status and the behavior it proves, then a "Not tested" panel of important behaviors no test covers. With no cases it says the change has no tests. |
| `table` | Rows and columns of text, such as settings, API parameters or error codes. A changed cell shows its old value struck through beside the new one. |
| `chart` | A bar or line chart of one or more series. With two series, such as before and after, each label gets a change badge like −42%, coloured by `better`. `annotation` calls out one point. |
| `timeline` | Events on a time axis, and `spans` under it for waits and windows. A playhead reveals them left to right, or moves to each step's events. The event cards sit in one row in time order. Cards of events close in time move apart, and a bent leader joins each to its dot, so no card covers another and no two leaders cross. |
| `files` | The changed files as a tree with line counts and a diffstat bar, tests marked, and a note beside each file the narration names. |
| `compare` | Two sides, such as before and after or two designs, row by row at the same height, so like sits beside like. A row that differs gets an arrow between the sides, a row that is the same dims behind an `=`, and a `verdict` marks the better side green and the worse red. A cell is text or a short code snippet. With `steps`, rows show as the voice reaches them. |
| `terminal` | A shell session in a window: each command types out, then its output prints, and a failed exit tints the entry red. Long lines wrap and a long session scrolls, so text never shrinks below a readable size. With `steps`, each step types its entries and the camera follows. |
| `layers` | Stacked bands, top to bottom in their real order, each with a label, a caption and the components inside it. A `path` sends a request token down through its stops and, with `return`, back up with a reply; `skip` answers early at one stop, turns the token back there and fades the stops it never reached. |
| `array` | A row of cells with their indexes, named `pointers` above them and shaded `ranges` under them. Each step can `set` cell values, `move` a pointer or range, and `show` or `hide` one, at its start: a changed value slides out and the new one in, briefly lit, and a pointer slides to its cell. |
| `memory` | Call frames with their variables on the left and objects with their fields on the right. A value `{ "ref": "c1" }` draws an arrow to that object, so aliasing shows as two arrows into one object. Each step can `set` a variable or field, which re-routes its arrow, and `show` or `hide` a frame or object. |
| `review` | In [review mode](#review-mode), every flag worst first, with its severity, file and line, and claim, under "Claude's review". |

Each spoken text is a segment: a lead, the voice, and a tail. The narration waits until the scene has drawn in, which takes 1 second, or the scene type's build time plus 0.3 seconds when longer. Most diagrams take 1.5 seconds, so their voice starts at 1.8. Each step's items light up 0.5 seconds before its voice and stay lit 1.2 seconds after it. Without a voice clip, a segment reads at 130 words per minute and holds 1.5 seconds after, 3 seconds at least. The pace scales the reading speed and every pause.

`examples/demo/` has a complete storyboard, and `scripts/demo.sh <dir>` creates the git repository it describes. `examples/demo-simple/` tells the same change in the simple style. `examples/gallery/` shows the `files`, `state`, `table`, `chart`, `timeline`, `mermaid`, `tests`, `compare`, `terminal`, `layers`, `array` and `memory` scenes and a flowchart. `examples/people/` explains how a support ticket gets resolved, with no code at all. `examples/preread/` is a pre-read of a rate limit change, with a `plan.json` whose topics group its reading order.

### Steps

A code scene can walk its hunk in `steps` instead of `focusLinesAfter` and `flow`. Each step names its `lines` (or `oldLines` for removed code) and what to `say` while they are highlighted, and lasts as long as that takes, so the highlight follows the voice. The scene's `narration` becomes the intro, spoken while the diff morphs in. Removed lines stay on screen until the last step about them, then collapse. A `label` on every step draws the step diagram beside the code. Write steps top to bottom, at most 8 per scene, or 6 with labels.

Diagrams take `steps` too, so the video can move the viewer's attention as it explains. Each step names what to light in `focus`, one ref or a list, and what to `say`. The whole diagram draws first. Then, half a second before each step's words, its focus lights up, earlier steps' items stay softly visible, and the rest dims. To walk a path, focus a node, then the edge leaving it, then the next node. A sequence, a timeline, a compare and a terminal also reveal their messages, events, rows or entries as the steps reach them.

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
| `layers` | A layer id, an item id or `"layer.item"`, or a path stop index. A step that focuses a stop moves the token there; it only moves on along the path, so focus the first stop again to bring it back up. |
| `tests` | A case index, a case's name, or a gap `"gap:0"`. |
| `array` | A cell index, an `"a-b"` range of cells, a pointer `"ptr:lo"`, or a range `"range:window"`. A step that changes something and has no `focus` focuses what it changes. |
| `memory` | A frame `"frame:main"`, a variable `"main.cart"`, an object id, or a field `"c1.items"`. A step that changes something and has no `focus` focuses what it changes. |
| `intent` | A bullet index. |
| `compare` | A row index, an `"a-b"` range of them, a side `"side:After"` (by title or `"side:0"`), or one cell `"2@After"` (row, then side). A step shows every row up to the last one it focuses. |
| `terminal` | An entry index, an `"a-b"` range of them, or one output line `"2:3"` (entry, then line, from 0). A step types every entry up to the last one it focuses, and scrolls back to an earlier one. |

A `flow` scene gives each of its own steps a `say` instead, and a step becomes current just before its words. Without steps, a diagram is fully drawn before the narration starts. `validate` checks every ref and suggests the closest name when one matches nothing.

### Pen marks

A step can draw on what it points at, like a reviewer circling a line on a printout. Give the step a `mark` and, optionally, a `note`:

```json
{ "focus": "redis", "mark": "arrow", "note": "no fallback", "say": "If Redis goes down, every order fails." }
```

| `mark` | Draws |
| --- | --- |
| `circle` | A loop around it. |
| `underline` | A line under it. |
| `box` | A rectangle around it. |
| `arrow` | An arrow pointing at it from free space nearby, with the note at its tail. |
| `strike` | One line through it. |
| `cross` | An X over it. |

A code step with a review `flag` draws a circle in the flag's colour with its claim as the note, unless it names its own `mark` or `note`. See [Review mode](#review-mode).

The mark goes on the step's first `focus` ref, or the whole range for a ref such as `"3-5"`. A code step marks its `lines`, or with a `token` only that text on them: `{ "lines": 8, "mark": "circle", "token": "max: 20", "say": "..." }`. The `note` is a few handwritten words, up to 40 characters, placed beside the mark where it covers least.

The pen starts once the step has settled, after its camera has moved and its items have appeared and lit up, and finishes just before the step's words begin. The mark fades when the next step starts, and a mark on the last step stays until the scene ends. Marks never pile up across steps.

`validate` rejects an unknown `mark`, a `note` over 40 characters or without a `mark`, a `token` outside a code step, and a `token` that does not occur exactly once on its lines. It warns when a scene marks more than 2 steps, since marks on most steps stop telling the viewer where to look.

### Text on screen

A scene never cuts its text. Every label, caption, bullet, note, cell and title wraps to the lines its place allows, then shrinks down to a minimum readable size. Text that still does not fit makes `validate` fail, naming the scene, the item, the text and a fix:

```
scenes[2] ("Who calls whom").messages[4].label: "POST /orders/{orderId}/line-items/{lineItemId}/adjustments" does not fit its message label, even at 15px; shorten the label, or split the message in two
```

`validate` runs the player's own layout code, so it and the video always agree. File paths, hunk headers and lines of code are the source's own text, so they shrink further with a warning instead. Text is drawn in Inter and code in JetBrains Mono, both bundled ([Inter license](src/assets/inter-OFL.txt), [JetBrains Mono license](src/assets/jetbrains-mono-OFL.txt)), and widths come from tables measured from those font files, so a video lays out the same on macOS and Linux. Pen notes use the bundled Caveat font ([license](src/assets/caveat-OFL.txt)).

On-screen text takes inline markup for the one word or value a sentence is about:

| Markup | Draws |
| --- | --- |
| `**bold**` | Heavier weight. |
| `` `code` `` | A monospace chip. Everything inside is literal. |
| `==marked==` | A highlighter behind the words. |
| `[words]{tone}` | The words in a tone: `good`, `bad`, `warn`, `accent` or `neutral`. |

Bold and code can go inside a mark or a tone, and nothing else nests. `**` and `==` open only before a word and close only after one, so `a ** b` stays literal, and `[` is markup only when `]{tone}` follows. A backslash makes `*`, `` ` ``, `=`, `[`, `]`, `{` or `}` literal. `validate` fails on unclosed markup or an unknown tone, with its column, and warns when more than a third of a text of three or more words is styled. Narration, `say` and pen notes are spoken, so their markup is dropped before the voice and subtitles, with a warning.

### Diagram nodes

Graph nodes and sequence participants are the same kind of card, so they can be people, teams, places and documents as well as services. Each has an `id` and a `label`, plus:

- `icon`, any [Lucide icon](https://lucide.dev/icons) name such as `user`, `headset`, `building-2` or `database`. `validate` rejects a name Lucide lacks and suggests close ones.
- `caption`, a short line under the label, such as `customer` or `datastore`.
- `change`, `highlight` and `badge` (see [Marks](#marks)).
- `tone`, the colour of the icon and badge (`neutral`, `accent`, `good`, `bad` or `warn`), to tell kinds of things apart.

A graph node also takes a `group`. Nodes in one group are drawn inside a labelled box. A graph edge takes a `label`, a `direction` (`forward` by default, `both`, or `none` for a plain line), a `style` (`flow` animates dashes along the edge, `solid` is still, `dashed` marks a weak or indirect link), and a `change` or `highlight`. A graph lays out left to right, or top to bottom with `"layout": "TB"` for hierarchies and teams. `validate` warns past 12 nodes.

A node's `shape` draws a flowchart:

| `shape` | Draws |
| --- | --- |
| `card` | The default card, with its icon and caption. |
| `decision` | A diamond holding a short question, such as `"Cache hit?"`. Label each edge leaving it with its answer, such as `"yes"` and `"no"`. |
| `terminal` | A pill, where the flow starts or ends. |
| `step` | A plain box for an action, with a caption and no icon. |

A graph with a decision lays out top to bottom unless it sets `layout`, draws still arrows unless an edge sets `style`, and is headed Flowchart. Focus, pen marks, badges, `change` and `highlight` work on every shape. `validate` warns about an icon or caption the shape does not draw, a decision with fewer than two outgoing edges, and an unlabelled edge leaving a decision.

### Marks

Three marks say three different things, and none stands in for another:

- `change` says what the diff did to an item: `added` (green, NEW), `removed` (red, dashed and struck through, REMOVED) or `modified` (blue, CHANGED). A viewer reads every change mark as a fact about the diff, so mark exactly what the diff changes.
- `highlight: true` points at the part a whole scene is about, with a soft white glow and no word. To point at parts one at a time as the voice names them, use `steps`.
- `badge` is your own label, up to 14 characters, such as `"hot path"`, `"v2"` or `"owner"`, drawn as a pill in the item's `tone`.

| Item | `change` | `highlight` | `badge`, `tone` |
| --- | --- | --- | --- |
| graph node, sequence participant | yes, with a badge | yes | yes |
| graph edge | yes | yes | no |
| sequence message | yes, with a badge | yes | yes |
| er table | yes, with a badge | yes | yes |
| er field, er relation, state transition | yes, by colour and a `+`/`−`/`~` marker | yes | yes |
| state | yes, with a badge | yes | yes |
| table row | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| timeline event, span | no | yes | yes |
| files entry | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| layer, layer item | yes, with a badge | yes | yes |
| tests case | its `status` | no | yes |

Everything that names a change uses the same three words: NEW, CHANGED and REMOVED. A code header says RENAMED for a renamed file and SOURCE for a snippet.

`validate` warns when:

- more than 60% of the items in a graph, sequence, er or state scene carry change marks (from 4 items up), since the marks then stop showing what changed;
- an er table or field, a state, or a table row is marked `added` or `removed` but its name is on no changed line of the diff, or a files entry's `change` disagrees with `hunks.json`;
- an explanation has a change mark without `"explainsChange": true`;
- a `badge` is a change word such as `new` or `removed`, which belongs in `change`.

`validate` also warns when a video for a reviewer or someone new to the code skips a hunk of 15 or more changed lines with a reason that says the diagrams or the overview cover it, since only the team's overview leaves code to the diagrams. And it warns when the narration states a count the screen contradicts: "seven tests" in a tests scene that lists nine cases, "two new tests" against its added cases, a step's count against the cases it lights, or "three things to check" in an intent scene with two bullets.

A tests scene that is not about a diff's tests can rename its panels with `titles`, for example `{ "subject": "Checked", "proves": "Shows", "gaps": "Open questions", "none": "Nothing checks this yet" }`.

## Development

For development, run `pnpm dev`. It serves the player with data from `examples/demo`, or from `MR_CAST_DATA_DIR` when set. `pnpm test` runs the unit tests, and `pnpm typecheck` runs the type checks and the text-clipping check. CI runs both on every push and pull request, along with the build, `validate` on every example, `pnpm audit`, a still render on Linux, and an npm install of the packed tarball.

- `bin/` holds the CLI. `lib/diff.mjs` parses unified diffs, `lib/server.mjs` serves the player, `lib/render.mjs` wraps the Remotion renderer, and `lib/voice.mjs` makes the voice-over. `lib/runs.mjs` finds a command's run, `lib/settings.mjs` turns flags into settings and keeps the last choices, `lib/lock.mjs` guards shared cache downloads, and `lib/prune.mjs` lists and deletes artifacts. `lib/explain.mjs` turns source line ranges into snippets.
- `src/` holds the player. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/` holds code the CLI and the player both run. `timing.mjs` computes scene durations from spoken segments, pace and build times. `steps.mjs` lists the steps each scene type speaks, and `targets.mjs` what a `focus` can name. `normalize.mjs` rewrites older field names where a storyboard enters. `voice.mjs` names clips and defines the paces. `pen-marks.mjs` says what a pen mark draws on, and `src/components/PenMarks.tsx` draws them.
- `shared/textfit.mjs` wraps and shrinks text using the widths in `shared/font-metrics.mjs`, which `node scripts/measure-fonts.mjs` generates. `shared/markup.mjs` parses inline markup. Each scene fits its text in layout code under `src/utils/`, against the places listed in `src/fit/slots.ts`. `src/fit/report.ts` runs the same layouts for `validate`. `scripts/check-text.mjs` fails on text clipping or an ellipsis under `src/`.
- `skill/` holds the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).
- `docs/adr/` records the big design decisions and why they were made ([index](docs/adr/README.md)).

## Upgrading from older versions

**From 0.13.** 0.14 never cuts text on screen. Labels that used to end in an ellipsis now wrap and shrink, and `validate` fails on any that still don't fit (see [Text on screen](#text-on-screen)). The `arch` scene is now `graph`, and `arch` still works.

**From 0.11.** 0.12 replaced four entries with one:

| Before | After |
|---|---|
| `/mr-cast-review [base]` | `/mr-cast [base]` |
| `/mr-cast-render [base]` | `/mr-cast mp4 [base]` |
| `/mr-cast-explain` | `/mr-cast` (after Claude explains something) |
| `/mr-cast-explain-render` | `/mr-cast mp4` (after Claude explains something) |
| `/mr-cast-prune`, `/mr-cast-upgrade` | unchanged |

The first `mr-cast` command after the upgrade reinstalls the skills and deletes the old ones, but only files whose content shows mr-cast wrote them. Start a new Claude Code session afterwards. Walkthroughs now live in `.mr-cast/<name>/`. One made by 0.11 stays where it was, reachable with `--dir .mr-cast` or `--dir .mr-cast/explain/<name>`.

**From 0.5.** 0.6 renamed `mr-video` and `explain-in-animation`, and 0.12 replaced both with `mr-cast`. Installing a newer version deletes their files. An explanation made by 0.5 stays in `.mr-cast/explain/`, reachable with `--dir .mr-cast/explain`.

Storyboards from older versions keep working. Steps from 0.10 that named `messages`, `events`, `entity` and so on, and nodes with `kind` and `modified: true` from 0.10 and earlier, are rewritten where the storyboard enters.

## License

MIT. mr-cast renders with [Remotion](https://www.remotion.dev/license), which is free for individuals and companies with up to 3 employees. Larger companies need a Remotion company license to render videos with mr-cast.
