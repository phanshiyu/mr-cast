# Changelog

## 0.15.0

- **Settings flags apply to one command.** `--audience`, `--simple`, `--pace`, `--speed`, `--voice` and `--no-voice` no longer stick to a run. Since 0.12 they were saved in the run's `meta.json` (and the pace and voice in `voiceover.json` since 0.9), so an `outline --pace faster` to compare lengths left every later render faster. Now each flag applies to the command it is given to, and a command without it uses the default: audience familiar, normal pace, voice `af_heart`, voiced. Pass the same flags to each command; the skill now does. Older `meta.json` files keep their `settings` and `style` keys, which are ignored. The audience and pace you chose last are still offered first in the questions, marked "(Last time)". `--voice` with `--no-voice` is now an error, and `voice` takes `--no-voice` and then voices nothing, so the same flags can go to every command.
- **Pen marks draw on what is there.** A marked step first brings its items to rest, moving the camera, drawing its messages or events in and lighting them, and only then draws its mark, which completes before the step's words. In a long sequence the circle used to start while the camera was still scrolling and the step's messages were still appearing, so it circled empty space for a moment. Every scene now settles a step in half a second (the sequence and code cameras ease instead of springing, a step's messages draw in together, timeline events land within it), and a marked step's lead is 0.4 seconds longer for the pen.
- **Flowcharts draw larger.** A top-to-bottom graph gives each row only the height its own shapes need instead of a diamond's, its diamonds can be lower, and its shapes widen when that lowers them. The gallery's flowchart draws at 0.84 of full size instead of 0.65, its text 19 to 23 pixels instead of 15 to 18. Left-to-right graphs and grouped top-to-bottom graphs lay out as before.
- **The same text on every system.** Text is drawn in Inter and code in JetBrains Mono, bundled with mr-cast under the SIL Open Font License, instead of the system font, which was SF Pro on macOS and something else on Linux. The text fit is measured from these files, so a video lays out the same on macOS and Linux. Stills and renders wait for the fonts before the first frame, and the player before it first paints. Inter is a little wider than SF Pro, so some text wraps or shrinks where it did not. The player bundles 64 kB more font files.

## 0.14.0

- **No text is cut.** Every label, caption, bullet, note, cell, title and callout wraps to the lines its place allows, then shrinks to the smallest size it still reads at. 0.13 cut about twenty kinds of text with an ellipsis or a line clamp, dropped a card's caption under a two-line title, and dropped an intent card's seventh bullet. Text that does not fit at its smallest size is drawn at that size, and `validate` fails, naming the scene, the item, the exact text and a fix, such as `scenes[2].messages[4].label: "..." does not fit its message label, even at 15px; shorten the label, or split the message in two`. A file's name or path, a hunk header and a line of code shrink with a warning instead, since the author cannot shorten them; code shrinks down to 10px rather than lose a character, and in the split view `validate` says to use the morph view.
- `validate` and the player share one text fit, `shared/textfit.mjs`, and `validate` runs the player's own layout code (bundled with esbuild) to decide what fits, so the two always agree. Widths come from `shared/font-metrics.mjs`, measured per character, weight and size, with kerning, in the browser that renders stills and videos: a drawn line comes within a pixel of its measured width. Its character-count guesses about long cells, captions, annotations, events and file notes are gone.
- **Inline markup.** On-screen text takes `**bold**`, `` `code` `` chips, `==marked==` highlights and `[words]{tone}` in `good`, `bad`, `warn`, `accent` or `neutral`, for the one word or value a sentence is about. `validate` fails on unclosed markup or an unknown tone, with its column, and warns when most of a text is styled. Markup in narration, `say` and pen notes is dropped before the voice and the subtitles, with a warning. The demo and the gallery style a few words.
- **Long sequences scroll.** A sequence keeps its rows readable, at least 46px apart, and grows a row for a label or note that wraps to three lines. One taller than the frame scrolls under its pinned participants: each step eases the camera to its messages, and without steps the camera pans from first to last while the narration speaks. A still shows where the last step leaves it. `validate` warns past 24 messages, up from 12.
- **Flowcharts.** The `arch` scene is now `graph` (`arch` still works). A graph node takes a `shape`: `card` (the default), `decision` (a diamond holding a question, with its outgoing edges' labels as the answers), `terminal` (a pill for a start or an end) or `step` (a plain box). Edges meet a diamond at its points. A graph with a decision lays out top to bottom, draws still arrows and is headed Flowchart. Focus, pen marks, badges, `change` and `highlight` work on every shape, and `validate` warns about a decision with fewer than two branches or an unlabelled branch. The gallery walks a flowchart of its timeout job.
- The intent card takes at most 6 bullets; `validate` now fails past 6 instead of warning and dropping the rest.
- A still of a graph scene is named `scene-NN-graph.png`.
- The skill teaches flowcharts and when to prefer a state, sequence or flow scene, long sequences, the fit errors and markup.

## 0.13.0

- **Pen marks.** A step can draw by hand on what it points at: `"mark"` is `circle`, `underline`, `box`, `arrow`, `strike` or `cross`, with an optional handwritten `"note"` of up to 40 characters. The mark goes on the step's first `focus` ref, or on a code step's lines, or on a `"token"` such as `"max: 20"` that occurs once on them. It draws itself in the half second before the step's words and fades when the next step starts. The note sits where it covers the least, never on the target.
- Every scene with focus steps takes marks: arch nodes, edges and groups, sequence participants and messages, er tables, fields and relations, states and transitions, table rows, columns and cells, chart labels, series and values, timeline events and spans, files, test cases and gaps, intent bullets, and code lines and tokens. Each scene places them from its own layout, so stills and renders match.
- `validate` checks `mark`, `note` and `token`, and warns when a scene marks more than 2 steps. `outline` counts the marks.
- The skill teaches when to mark: the one thing a sentence is about on a busy screen, a risky value, a missing piece, and rarely.
- The demo, gallery and people examples each draw a mark. The demo's arch scene now walks its graph in steps, and its wiring scene walks two steps.
- The player bundles the Caveat typeface for notes: 51 kB of font, about 7 kB more JavaScript gzipped.

## 0.12.0

- **One entry instead of four.** `/mr-cast` replaces the `mr-cast-review` and `mr-cast-explain` skills and the `/mr-cast-render` and `/mr-cast-explain-render` commands. It takes the source from your words and arguments ("this branch", a base branch, "animate that"), else from what exists: the branch's changes, an explanation Claude just gave, or both, when its first question asks which. With neither, it says what it makes and stops. The `/` menu is now `/mr-cast`, `/mr-cast-prune` and `/mr-cast-upgrade`.

  | Before | After |
  |---|---|
  | `/mr-cast-review [base]` | `/mr-cast [base]` |
  | `/mr-cast-render [base]` | `/mr-cast mp4 [base]` |
  | `/mr-cast-explain` | `/mr-cast` (after Claude explains something) |
  | `/mr-cast-explain-render` | `/mr-cast mp4` (after Claude explains something) |
  | `/mr-cast-prune`, `/mr-cast-upgrade` | unchanged |

  Reinstalling the skills (any `mr-cast` command after `npm install -g`, or `mr-cast install-skill`) deletes the old skills and commands. Start a new Claude Code session afterwards.
- **MP4 is a word, not a command.** "mp4", "video file", "render", "save" or "share" in the request, or `/mr-cast mp4`, makes an MP4. Otherwise the player starts. "Just make it", "use the defaults" and "no questions" skip the questions. "Render" no longer does.
- **Last choices first.** The audience and pace you chose last are offered first next time, marked "(Last time)". They are kept in `~/.config/mr-cast/last-choices.json`.
- **One set of commands for both sources.** `mr-cast extract` and the new `mr-cast init --title` (was `explain init`) each start a run in `.mr-cast/<name>/` and make it the current run. `snippet`, `validate`, `outline`, `voice`, `play`, `render` and `still` work on the current run, whatever its source, or on `--name <slug>`. `extract` without `--name` names the run after the branch. `mr-cast explain <command>` still works, and `--dir` reaches walkthroughs that 0.11 left in `.mr-cast/` or `.mr-cast/explain/<name>/`.
- **A run keeps its settings.** `--audience familiar|new|overview` (`new` is the simple style, and `--simple` still works), `--pace`, `--speed`, `--voice` and `--no-voice` are given once to `extract` or `init`. A flag on a later command changes them from then on. A rerun of `extract` now keeps the simple style instead of dropping it.
- `mr-cast status` prints the branch's commits and files ahead of its base, the uncommitted files, and your last choices. The skill decides the source from it.
- `mr-cast help` shows the commands you run yourself first and the skill's pipeline after. `help --all` adds `voice`, `still` and the rarer options.
- The skill reads its shared steps from `SKILL.md`, and the steps for one source from `references/branch.md` or `references/explanation.md`, so a run reads less text than before.
- **Arch graphs fill the frame.** Groups and runs of ungrouped nodes share a column when their layers do not overlap, so grouped graphs are no longer a wide staircase: a 12-node top-to-bottom graph with five groups draws at 0.61 scale instead of 0.47. When the frame has room across, cards widen so long titles keep the full font.
- **One title size per graph.** Every card in an arch graph shares one title font, so a long title such as "On-call engineer" no longer leaves its card smaller than its neighbours. A one-word title too wide for its card shrinks instead of breaking mid-word.
- **Edge labels stay clear.** Each gap between layers is sized for its labels and for group borders and names, and a label is placed along its edge clear of nodes, group borders, group names, other labels and, where possible, other edges. Top to bottom, a group's name sits at the end of its box away from incoming edges. Edge labels are 19px and group names 18px (were 17 and 16).
- **Change marks mean the diff.** `change` (and an older `modified`) now only says what the diff does to an item. For attention there is `highlight`, a soft white glow with no word that never reads as a change, on sequence messages, er tables, fields and relations, states and transitions, timeline events and spans, and arch edges as well as nodes. Sequence messages take `change` like every other item, so a message can be NEW or REMOVED, not only changed. An explanation's older `modified: true` on a message becomes a highlight, as on a node. A highlighted node no longer gets a KEY badge; write `"badge": "key"` where the word matters.
- **Badges of your own.** `badge` (up to 14 characters) and `tone` label nodes, messages, er tables, fields and relations, states and transitions, table rows, timeline events and spans, files entries and test cases with a word of your own, such as `"hot path"` or `"owner"`, next to its change badge.
- **One set of words for a change.** Badges, legends, code headers and the tests scene all say NEW, CHANGED and REMOVED. Code headers said ADDED, MODIFIED and DELETED, and legends said added and modified.
- **`validate` checks the marks.** In a diff walkthrough it warns when more than 60% of a diagram's items are marked as changed, when an er table or field, a state or a table row marked `added` or `removed` names nothing on the diff's changed lines, and when a files entry's `change` disagrees with the diff. In an explanation it warns about any change mark unless the storyboard or scene sets `"explainsChange": true`. It warns when a badge is a change word.
- An arch edge between two changed nodes is drawn plain unless it has its own `change`. It used to turn blue, which read as changed.
- A tests scene can rename its panels with `titles` (`subject`, `proves`, `gaps`, `none`).
- The demo and gallery examples mark only what their diffs change.

## 0.11.1

- Fixed: the player played at two thirds of real time (20 frames a second instead of 30), so the voice ran ahead and was pulled back every two seconds, which sounded slow and stuttering. The page rebuilt the Player's `inputProps` on every frame, and each rebuild restarted Remotion's frame clock.
- `play` and `render` print `mr-cast: pace: slower (saved; pass --pace normal to change)` when they use a pace that is not normal.

## 0.11.0

- **Diagrams of anything, not only services.** Arch nodes and sequence participants share one card: any [Lucide icon](https://lucide.dev/icons) by name (`user`, `headset`, `building-2`, `database`, ...), a free `caption`, a `change` (added, removed, modified) drawn as in the er and state scenes, a `highlight` for a key part, and a `tone`. A storyboard can now show customers, teams and the relationships between them as well as a system. Flow actors take an icon and a tone too.
- **Arch edges, layouts and groups.** An edge takes a `direction` (`forward`, `both`, `none`), a `style` (`flow`, `solid`, `dashed`) and a `change`. `"layout": "TB"` lays a graph out top to bottom. Nodes with the same `group` are drawn inside one labelled box.
- **Move the viewer's attention.** Every diagram's `steps` take `focus`: one ref or several, such as a node, an edge `"a->b"`, a group, an ER field `"orders.status"`, a table cell `"Value@2"`, a chart series or value `"after@p99"`, a timeline span, a test gap or an intent bullet. What a step focuses lights half a second before its words while the rest dims. Arch, intent and tests scenes take steps for the first time.
- `validate` checks icon names, node, group and edge references and every focus ref, and suggests the closest name when one is wrong. `outline` shows an arch scene's groups and layout.
- **Older storyboards still work.** `kind` and `modified: true` on nodes, and the older step keys (`messages`, `events`, `entity`, `state`, `transition`, `label`, `row`, `path`), are rewritten to the new fields when a storyboard is loaded. In an explanation, an older participant's `modified` now shows KEY instead of CHANGED, as arch nodes already did. A sequence participant without `kind` no longer shows a generic box icon and "participant" caption.
- Timeline steps now dim the events and spans they do not focus, like every other diagram.
- `examples/people/` explains how a support ticket gets resolved, with no code. The skills teach the new fields and when to step the focus.
- Fixed: a timeline span too short for its label no longer has the label covered by the next span.
- The player bundles every Lucide icon so any name resolves in stills and renders without waiting: about 640 kB more JavaScript (170 kB gzipped), served locally.

## 0.10.0

- **Diagrams draw before the voice.** Every scene type has a build time in one table in `shared/timing.mjs`, at most 1.8 seconds, and its narration starts 0.3 seconds after the build. Sequence messages, timeline events, chart bars, state and ER changes, tests and table rows no longer arrive spread over the scene, so the voice never names something that is not on screen yet. Long builds stagger faster instead of waiting longer.
- **Steps on diagrams.** `sequence` (`messages`), `timeline` (`events`), `flow` (a `say` on each step), `state` (`state` or `transition`), `er` (`entity`) and `chart` (`label`) take `steps` with their own spoken words, like code, table and files steps. Sequences and timelines reveal each step's items 0.5 seconds before its words; state, ER and chart scenes draw everything first and light each step's item while the rest dims. `validate` checks every reference, and `outline` counts the spoken steps.
- The skills teach when to walk a diagram in steps, and simple mode walks every sequence, flow and timeline that way. The gallery and both demos use diagram steps.

## 0.9.0

- **Choices before the video.** The skills ask who the video is for (a reviewer, someone new to the code, or a quick overview for the team), which areas to go deeper on, and the pace. All three are multiple choice with the recommended answer first, and any your request already answers are skipped. A quick overview is a new mode with diagrams and little code. Before a render, approving the outline takes one click. The player skips that step.
- **Calmer pacing.** A scene builds for a second before the voice starts, and new code is drawn by then. Each step lights 0.5 seconds before its voice names it and holds 1.2 seconds after. Silent scenes read at 130 words a minute instead of 160. Subtitles follow each sentence of the voice instead of drifting through the pauses.
- **Pace and speed.** `--pace slower|normal|faster` on `voice`, `play`, `render`, `validate` and `outline` sets the voice's speed and the length of every pause. `--speed <0.5-2>` sets the speed alone. Both are saved in `voiceover.json`. A new speed voices the narration again.
- **Steps on table and files scenes.** Each row or file can carry its own spoken words and lights just before them. Without steps, the spotlight now follows the narration instead of running ahead of it.
- **Chapter markers in MP4s.** Rendered videos carry one chapter per chapter title.
- **Player speed control.** The browser player plays at 0.75x, 1x, 1.25x or 1.5x.
- `validate` warns when the narration over an `arch` or `sequence` diagram runs past 35 words.
- Fixed: the browser player now reloads when storyboard.json changes.

## 0.8.0

- **Simple mode.** Ask for a walkthrough "line by line", "like I'm new to this", "ELI5" or "for a non-native speaker", or pass `--simple` to `extract`, `explain init` or `/mr-cast-render`. Code is explained one line or small group at a time in short, plain sentences. `validate` checks step size, line coverage and sentence length.
- **Code steps.** A code scene can carry `steps`, each a line range with its own spoken words. The highlight moves when its words start, and the subtitle shows the same words.
- **Context beyond the diff.** `mr-cast snippet <file>:<a>-<b>` adds unchanged source, such as callers, types or config, to a diff walkthrough. Snippets survive a rerun of `extract`.
- **New scenes.** `table` (rows with added, removed and changed values), `chart` (bar and line, with before and after badges), `timeline` (events and spans on a time axis), and `files` (the change as a file tree with line counts and notes).
- **Upgrading.** `mr-cast upgrade` installs the latest version and refreshes the skills. Commands print a one-line notice when a newer version is on npm, from a check that runs in the background at most once a day. After `npm i -g`, the next command refreshes the installed skills. Ask Claude to "upgrade mr-cast" through the new `mr-cast-upgrade` skill.

## 0.7.0

- `mr-cast prune` lists walkthroughs, rendered videos, stills, voice clips and cached downloads with their sizes, and deletes the ids you pass. The `mr-cast-prune` skill asks which to delete.

## 0.6.1

- `install-skill` records what it installs and removes skills that later versions renamed. `mr-cast uninstall-skill` removes them all.

## 0.6.0

- Skills renamed to `mr-cast-review` and `mr-cast-explain`, with `/mr-cast-render` and `/mr-cast-explain-render`. Several renders can run at once. Rendered videos are named after the walkthrough title. `mr-cast --version`. The skills show an outline and ask before rendering.
