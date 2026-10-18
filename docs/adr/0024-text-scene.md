# 24. A text scene whose lead field says how it is drawn, with intent as its alias

- Status: Accepted
- Date: 2026-10-18
- Supersedes: the intent scene of earlier storyboards, and the intent parts of 0005 and 0019 (see Consequences)

## Context

Words on screen had one scene, `intent`: a branch's summary, a risk badge, up to 6 bullets and the diff's size. The
blueprints behind ADR 0020 wanted more kinds of words as the picture: an opening question (Bitcoin), one big number
that grows (YouTube's 500 hours a minute, 720,000 a day), a term and its meaning (OAuth's access token), a rule or a
quote (Dijkstra in one line), a title card between parts, two things side by side, and a list that builds. Each was
drawn with an intent card or a diagram it did not fit.

Three shapes were prototyped on `wt/text` and compared in stills (`docs/prototypes/text-scene/` on that branch):

- **A.** One scene type per moment (`question`, `number`, `quote`, ...).
- **B.** A `blocks` scene: a stack of typed blocks, sized together.
- **C.** One `text` scene with one lead, whose field name (`headline`, `question`, `number`, `term`, `quote`) says how it
  is drawn, a kicker and note around it, and items or two sides under it.

The user picked C.

## Decision

- **The `text` scene.** Exactly one lead: `headline`, `question` (a large question mark beside it), `number` (its leading
  figure in display type, counting up), `term` (a rule, then its meaning in `note`) or `quote` (a large quote mark in the
  room it leaves at its left, its source in `note`). Optional `kicker`, `note`, up to 6 `items` or two `sides` (each its
  own lead, note, label, tone and up to 4 items), `risk`, `diffstat` and `hidden`.
- **Steps** follow ADR 0020's state model: `set` rewrites the lead, `note` or `kicker` by those names, `show` and `hide`
  take an item index, `"note"`, `"kicker"`, the lead's field name, `"left"` or `"right"`, and a step with no `focus`
  lights what it changes. A rewritten part crossfades; a number set to a number with the same symbols around it counts
  from the old figure to the new.
- **Fit.** Items shrink first, from 36px (32px past four) to 24px, then the lead and note a step at a time, as the player
  draws them. `validate` runs that layout for every state the steps produce and reports text that does not fit at the
  field that holds it, which is the step's `set` for text a step wrote. Nothing in the scene scales under the readable
  size, so it never needs the "unreadable" warning.
- **Intent is an alias.** `validate` and the normalizer map an `intent` scene to a text scene: `summary` as `headline`,
  `bullets` as `items`, `risk`, the storyboard's title and subtitle as `kicker`, and `diffstat`. `validate` checks the
  intent's own fields first, then the text scene, and reports what it finds by the intent's names (`bullets[2]`,
  `summary`, `title`). A headline above items is set as the intent card's summary was, so an old storyboard draws as
  before; the one visible change is the subtitle in the title line, drawn in the neutral tone instead of the fainter
  grey. `IntentCard`, `intentLayout` and `intent.md` are removed, and `mr-cast schema` lists `text`, not `intent`.

## Consequences

- One scene draws every kind of text moment, and a new lead is one entry in a table of type sizes, not a scene type.
- The examples open on text scenes; YouTube opens on its number and Bitcoin on its question.
- Storyboards written for 0.26 and earlier validate and render as before; stills of the demo's opening, the intent demo
  and OAuth's last scene match main except for the subtitle's tone.
- ADR 0005's quick video "may open without an intent scene" and ADR 0019's dropped warnings about the intent scene now
  read as the text scene; nothing in them changes otherwise.
- `show` and `hide` take one part each, so a hidden `"0-3"` range is shown item by item.

## Alternatives considered

- **A, one scene type per moment.** Five scene types with the same frame, refs and steps, and a sixth for the next
  moment. Rejected for the repetition in the schema and the renderers.
- **B, a stack of blocks.** Freer, but the stack's sizing makes every combination of blocks a layout to check, and a
  storyboard must say what each block is twice: its kind and its fields.
- **Keep `intent` as its own scene beside `text`.** Two renderers of the same summary and list; the alias keeps old
  storyboards working without them.
