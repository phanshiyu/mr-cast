# Use mr-cast from Claude Code

This guide shows how to ask Claude Code for each kind of video. For the commands the skill runs, see the [command reference](cli.md).

## Install and set up

mr-cast needs Node 22.12 or newer on macOS or Linux. CI tests Node 22, 24 and 26. Pick Node 24 LTS if you have a choice. The `mr-cast` launcher finds Node through PATH, nvm or Homebrew.

```bash
npm install -g @shiyuphan/mr-cast
mr-cast install-skill
mr-cast --version
```

npm 11.19 and later skip the install scripts of dependencies and list them as warnings. mr-cast needs none of them.

`mr-cast install-skill` installs the `mr-cast`, `mr-cast-prune` and `mr-cast-upgrade` skills into `~/.claude`, or into `$CLAUDE_CONFIG_DIR` when that is set. The skills point at the installed package, so run `mr-cast install-skill` again after you move the package. Each install records what it wrote in `.mr-cast-install.json` in that directory, and deletes anything an earlier install wrote that this version no longer installs. `mr-cast uninstall-skill` removes every skill mr-cast installed, and the record. Both commands print each file they remove, and neither touches a file whose content mr-cast did not write.

To run mr-cast from a clone instead, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Pick the source

Type `/mr-cast`, or ask Claude in your own words. The skill picks what the video is about from what you say:

- A base branch, `--working`, "this branch", "PR", "MR" or "diff" means the branch's changes.
- "That", "what you said" or "this explanation" means the explanation Claude just gave.
- A bare "make a video of this" uses whichever source exists. When both exist, Claude asks which one you mean.

A branch video starts from `mr-cast extract`, which diffs the branch against its base. An explanation starts from `mr-cast init`, and its code scenes show snippets of real source files instead of diff hunks. Run Claude Code from the repository the video is about.

## Make a quick diagram video

Say "quick", "just a diagram" or "explain this flow in a diagram". You can also select code in your editor and type a bare `/mr-cast`. Claude makes a video of 1 to 3 scenes and opens it in the browser.

The quick video ends on three phrases to say to Claude next. "Go deeper" makes a full walkthrough of the same code that keeps these scenes. "The whole branch" makes a full walkthrough of the branch's changes. "Save it" renders the video as an MP4.

The editor selection reaches Claude only when Claude Code is connected to the IDE, through `/ide` or the IDE's integrated terminal.

## Make a full walkthrough

Ask for a video of the branch or of the explanation. Claude writes the storyboard, runs `mr-cast validate` until it passes, and opens the player in your browser. The player reloads when Claude edits the storyboard, so you can ask for changes and watch them land.

The page opens once the voice is ready. Browsers block autoplay with sound, so press play to start.

## Get an MP4

Say "mp4", "video file", "render", "save" or "share", or type `/mr-cast mp4`. To diff against another base, type `/mr-cast mp4 main`.

The MP4 is 1920x1080 at 30 fps, with the voice, burned-in subtitles and a chapter marker for each chapter. mr-cast names it after the walkthrough's title, such as `.mr-cast/feature-rate-limit/rate-limiting-for-the-orders-api.mp4`. The first render downloads Chrome Headless Shell, about 580 MB, into `~/.cache/mr-cast/remotion`.

## Make a pre-read for a reviewer

A pre-read is for a reviewer who reads the code after the video. Say "pre-read", "before I review", "no code on screen" or "without code".

The video shows no code. It explains the change with diagrams that use the real identifiers and file names, and lists in a `reading` scene the order in which to read the hunks, each with what to check there. `mr-cast validate` writes the same order to `reading.md` beside the storyboard, as a checklist you can paste into the merge request. The player shows it in a **Reading order** panel with **Copy as checklist**.

See [the pre-read fields](storyboard.md#pre-read) in the storyboard reference.

## Ask for a review

By default the video explains the change and gives no verdict. To have Claude also flag what looks wrong, say "review it", "with your review", "find issues" or "flag anything that looks wrong". Review mode needs a branch, because an explanation has no diff to review.

Each flag has a severity: `bug` (wrong today, with an input that breaks it), `risk` (breaks under some input or later, or leaks something), or `nit` (small but worth a fix). A pen circle in the severity's colour rings the line where the walkthrough reaches it. A `review` scene, when Claude adds one, lists every flag, worst first. `validate` writes the flags to `review.md` in the run's directory, and `render --out` writes a copy beside the MP4. In a pre-read, each flag sits on its item in the reading order instead.

`examples/review/` is a password reset change with a planted bug, risk and nit. `scripts/review-demo.sh <dir>` creates its git repository.

## Pick topics on the plan page

For a large change, ask Claude to let you pick the topics first. Claude cuts the change into topics in `plan.json` and runs `mr-cast plan`, which opens the plan page. For each topic you pick a depth (Skip, Brief or Deep) and a way to show it. Every pick saves at once. The keys work too: up and down move between topics, 1, 2 and 3 pick Skip, Brief and Deep, and left and right change the view.

The page sends each pick to a server on 127.0.0.1 only. Every write needs the random token in the URL that mr-cast opened, so another web page cannot change your plan. Opened without the token, the page is read-only.

The player then has a **Plan** tab with the same picks. A pick you change there is marked "Changed, not in the video yet". Say "update the video", and Claude rewrites those topics.

## Free disk space

Ask Claude to "prune mr-cast" or "clean up old mr-cast videos". The `mr-cast-prune` skill shows a menu that the CLI builds, with sizes, and runs the command the CLI gives for each pick. Claude never chooses files or deletes them itself. To do it yourself, see [`mr-cast prune`](cli.md#prune).

## Upgrade

Ask Claude to "upgrade mr-cast", or run `mr-cast upgrade`. Then start a new Claude Code session, because an open session keeps the skills it loaded. See [Upgrade](cli.md#upgrade) in the command reference.
