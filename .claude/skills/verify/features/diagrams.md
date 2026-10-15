# Diagram nodes and focus

A storyboard draws arch nodes and sequence participants as one kind of card, with any Lucide icon, a caption, a change mark, a key highlight and a tone, so a diagram can show people and teams as well as services. Arch scenes add edge direction, style and change, a top-to-bottom layout and labelled groups. Every diagram's `steps` take `focus` refs, and what a step focuses lights half a second before its words while the rest dims. Storyboards written for 0.10 and earlier, with `kind`, `modified` and the older step keys, render as before.

## Sub-features

- `node-card` draws `icon`, `caption`, `change` (NEW, REMOVED struck and dashed, CHANGED), `highlight` (KEY) and `tone` on arch nodes and sequence participants, and `icon` and `tone` on flow actors.
- `arch-edges` draws `direction` (`forward`, `both`, `none`), `style` (`flow`, `solid`, `dashed`) and `change` (green, dashed red, accent) on arch edges, with a change legend when an edge changes.
- `arch-layout` lays out `"layout": "TB"` top to bottom and draws nodes sharing a `group` inside one labelled box, in bands that never overlap.
- `focus-steps` lights each step's refs in arch (node, `"a->b"`, `"a-b"`, `"group:Name"`), sequence, er (`"entity.field"`, relations), state (`"a->b"`, labels), table (`"col:H"`, `"H@row"`), chart (`"series:s"`, `"s@label"`), timeline (`"span:label"`), files, tests (`"gap:N"`) and intent scenes, keeping an edge's endpoints readable.
- `focus-validate` rejects unknown icons, older icon aliases, unknown node ids, groups and refs, each with the closest names, and warns about groups spelled two ways, self-edges and a step that repeats the one before.
- `legacy-storyboards` renders 0.10 storyboards (`kind`, `modified`, `messages`, `events`, `entity`, `state`, `transition`, `label`, `row`, `path`) the same as 0.10 did.

## How to get to it (user POV)

- Write node fields and `steps` with `focus` in `storyboard.json`, by hand or through the installed skills, then run `mr-cast validate`, `still`, `render` or `play`.
- Read `examples/people/` for a storyboard with no code, and `examples/gallery/` and `examples/demo/` for cell, series, value, transition and field focus.

## Driving it with verify.sh

Preconditions: the baseline in `README.md`. The people example is an explanation with an empty `hunks.json`, so it runs from any dir with `--dir`.

- **People example, path walk.** Run `mkdir -p $RUN/work/people && cp $REPO/examples/people/*.json $RUN/work/people/`, then `$V mrc $RUN people-validate -- validate --dir $RUN/work/people`. It prints `✓ storyboard ok · 5 scenes`. Run `$V mrc $RUN people-render -- render --no-voice --dir $RUN/work/people --out $EV/people.mp4`, then `node $REPO/.claude/skills/verify/scripts/sync-check.mjs $RUN/work/people $EV/people.mp4 $EV/people-sync --no-voice`. Open `$EV/people-sync/02-arch-step-K-pre.png` for K 1 to 5: the customer, then the edge from customer to agent, then the agent, then the guides with their edge, then the Engineering group and the two-way edge, each lit before its sentence, with the rest dimmed. `02-arch-voice-1.png` shows the whole graph drawn and undimmed, three group boxes top to bottom, a dashed edge, a two-way edge and a plain line.
- **Focus in other scenes.** Copy `examples/gallery` and `examples/demo` (both have their `hunks.json`) into `$RUN/work/`, render each with `--no-voice` and run sync-check as above. Open the gallery's `04-table-step-1-pre.png` (one cell lit), `05-chart-step-1-pre.png` (the `after` series lit), `05-chart-step-3-pre.png` (one bar lit with the annotation), `03-state-step-3-pre.png` (a transition lit by its label), and the demo's `05-er-step-1-pre.png` (the `status` field lit).
- **Validation hints.** Write a storyboard with an unknown icon (`"suport"`), an alias (`"home"`), an edge to a missing node and a mistyped group ref, and run `validate --dir`. It exits 1 with lines such as `"home" is an older Lucide name; use "house"` and `did you mean "group:Team"`.
- **Legacy storyboards.** Run `git -C $REPO show v0.10.0:examples/demo/storyboard.json > $DEMO/.mr-cast/storyboard.json` after `extract`, then `still --out $EV/legacy`. It validates with no new warnings. The arch and sequence stills match 0.10's (icons and the `service`, `datastore`, `queue`, `client` captions from `kind`, CHANGED badges from `modified`), within a pixel of text placement.

## Gotchas

- A still is a scene's settled end, which is its last step. To see each step, render and use sync-check's step frames.
- Validation checks icon names against Lucide's own list, which `lucide-react/dynamicIconImports.mjs` provides. An alias such as `home` is rejected because the player resolves icons by their own names only.
- A participant without `icon` has no icon tile, and one without `caption` has no caption line; 0.10 showed a box icon and "participant" there.
- Timeline steps dim the events and spans they do not focus, which 0.10 did not.
- In an explanation an older `modified: true` becomes a KEY highlight, in a diff walkthrough a CHANGED mark.
