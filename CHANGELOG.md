# Changelog

## 0.12.0

- **Arch graphs fill the frame.** Groups and runs of ungrouped nodes share a column when their layers do not overlap, so grouped graphs are no longer a wide staircase: a 12-node top-to-bottom graph with five groups draws at 0.61 scale instead of 0.47. When the frame has room across, cards widen so long titles keep the full font.
- **One title size per graph.** Every card in an arch graph shares one title font, so a long title such as "On-call engineer" no longer leaves its card smaller than its neighbours. A one-word title too wide for its card shrinks instead of breaking mid-word.
- **Edge labels stay clear.** Each gap between layers is sized for its labels and for group borders and names, and a label is placed along its edge clear of nodes, group borders, group names, other labels and, where possible, other edges. Top to bottom, a group's name sits at the end of its box away from incoming edges. Edge labels are 19px and group names 18px (were 17 and 16).

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
