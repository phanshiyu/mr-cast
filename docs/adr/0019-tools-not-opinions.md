# 19. Tools, not opinions

- Status: Accepted; the 10-test-case warning superseded by 0024; the intent scene superseded by 0026
- Date: 2026-10-17
- Supersedes: 0003, 0010, 0014, 0016, 0017; parts of 0005, 0008, 0009, 0015 and 0018 (see Consequences)

## Context

By 0.24 the skill told the model how to teach: what to cover, in what order, which scene fits which idea, how long each
part runs, how to phrase the voice, and to write and reader-test an article before the video. `validate` enforced much
of it as warnings. In the 0.24 eval, viewers of the article-first videos answered about as many questions as viewers of
the old ones (87% against 90% on explanations, 82% against 89% on the branches; CHANGELOG 0.24.0). The user watched the
results and judged them poor:

> okay i think the results are very poor. lets keep things simple. we just let each model do what they want/however they
> want to express things. we focus on providing the tools to allow them to express. apart from the writing style /bro i
> think lets drop all the opinions in storyboard writing

The one writing rule that stays is the /bro style: "Stop using jargon and speak coherently. State it more simply and
concisely, like one human talking to another."

## Decision

mr-cast provides tools and leaves the teaching to the model. A tool is something the model cannot do or see without
mr-cast: the commands, the scene types and their fields, `schema`, the examples, `still`, `steps`, `outline`, `play`,
`render`, the voice, and checks that report a fact. An opinion is advice on how to teach, what to cover, in what order,
how long, which scene to pick, or how to phrase. Opinions go.

- **The article stage is removed:** `mr-cast article`, `bin/lib/article.mjs`, the storyboard's `section` and `textOnly`,
  the hook's article part, the article copy beside a rendered MP4, and the reader test.
- **The skill is one short SKILL.md** that says what mr-cast makes, maps the user's words to the source, the output and
  the modes, lists the commands in order, gives the /bro line and what the voice reads as words, and says what to tell
  the user at the end. It keeps the trigger words and the validate hook. References left: `plan.md` (how to write
  `plan.json` and run the page) and one file per scene, each a one-line description, an example and the mechanics
  `schema` cannot say. Gone: the questions, the topic rules, the article, the reader test, the scene picker, the voice
  rules, the audience files, the branch, explanation, quick and review guides, and the highlight audit.
- **Audiences.** `--audience preread` stays, since a pre-read is a feature the user asks for by name: no code on screen,
  and the reading order with `reading.md`. `familiar`, `new` and `overview` only changed advice, so they are gone. The
  flag still accepts them, and `--simple`, from skills an open session loaded before the upgrade, and ignores them.
  The last audience is no longer remembered; the last pace is. Each command that takes the settings flags records in
  meta.json the audience it ran with, the plain video when no flag names one, so the hook checks a run as its latest
  command did. Before 0.25, a command with no flag kept the audience already recorded, so a run that was once a
  pre-read stayed one for the hook while `validate` passed the same storyboard as a plain video.
- **Errors** are what would not render or names something that does not exist. Opinion errors go: a focus range over 15
  lines, 12 or more changed lines with no focus, a tests scene with no cases and no gaps, findings with no review scene,
  a finding over 50 lines, and `risk` required on a branch's intent.
- **Warnings** report only what the model cannot see without rendering, or two parts of the storyboard that disagree.

### Warnings kept, and the fact each reports

- Text that does not fit its slot at the smallest readable size (the player's own layout code), and when that check or
  the Mermaid parser cannot run.
- Layout capacity, where the renderer gets cramped: more than 12 graph nodes, 6 sequence participants, 6 er entities,
  10 states, 10 test cases, 6 table columns or 10 rows, 12 chart labels, 4 series or 24 bars, 8 timeline events,
  18 files, 7 layers or 5 items in a band, 16 array cells, 6 compare rows or a 6-line compare code cell, and more than
  6 labelled code steps for the step diagram. The reading scene shows 6 items to read and counts the rest.
- The highlight linter: a step's words name something it does not light, and a swap lands before its words
  (`bin/lib/highlight.mjs`).
- A step that lights the same as the one before, so nothing moves; an item no step names in a revealed list, which then
  appears unnamed with a neighbour; a layers token that never moves, passes a step's stop, or never brings its reply up,
  and a `reply` without `return`.
- Something drawn differently from what was written: an icon or caption a node shape does not draw, `x` and `y` that
  layout ignores, an edge from a node to itself, group names that differ only in case, `highlight` beside `steps`,
  `from` outside a pre-read, a reading scene outside a pre-read, and `skipped` in an explanation.
- Spoken text: markup in narration or `say` is read as plain words, and a pen note's markup is dropped.
- Mismatches between parts: a spoken count against the cases, bullets or lit items; a change mark on a name no changed
  line has, a file's `change` against the diff, change marks in an explanation without `explainsChange`; focus lines
  outside the hunk; a hunk both shown and skipped; plan picks against the scenes and against plan.json; a finding no
  step or reading item flags; "item N" past the reading order; two citing scenes under one chapter; a pre-read run
  without `--audience preread`, and a pre-read with no reading scene, so no `reading.md`.

### Warnings dropped

Diagrams before code, an intent scene first, tests after the code, a missing tests scene, too few diagrams for the code;
coverage of hunks and tests, and skip reasons such as "covered by the diagrams"; every voice rule (code read aloud, bare
status codes, jargon, sentences over 25 words, a bare pronoun to open a scene); simple style (sentence length, line
coverage, steps over focus); narration over 35 words on a graph or sequence; a focus range over 8 lines, more than 3
ranges, more than 8 steps in a code scene or a diagram, a step label over 60 characters; more than 8 flow stages, 24
messages, 10 er fields, 4 test gaps, 4 timeline spans, array pointers and ranges, memory frames, objects and rows,
terminal entries, output lines and an unstepped session, more than 5 spotlighted rows, more than 2 pen-marked steps,
a lone layer; a decision with one edge or an unlabelled branch; a compare with labels on some rows; a badge that reads
as a change word and a diagram mostly marked as changed; most of a label styled; quick mode's 3 scenes and 60 seconds;
the pre-read's code-shaped labels, a `from` with more than 3 hunks or no label naming its hunk, a long reading item
without `lines`, a check over 80 characters, the reading scene not last, and "item N" outside the scene's `from`; a
deep pre-read topic without a second diagram; 4 to 8 plan topics; the review's opinion wording, more than 8 findings,
evidence over 240 characters, and the review scene not last; and every article warning.

## Consequences

- The model decides the shape, the order and the length of every video. A video can open on a diagram, skip the tests
  or show no code; `validate` passes it when it renders and its parts agree.
- The installed SKILL.md is about 125 lines and 2,300 tokens, down from 140 and 3,400, plus 20 scene files.
- Without the guidance, nothing pushes a weak model toward a teaching order. That is the point of this decision, and the
  eval templates in `quality/` can measure it.
- ADR 3 (diagrams first) and ADR 14 (article first) are superseded, and with them ADRs 10 and 16 (the picker) and 17
  (the article's shape). ADR 5 keeps quick mode as a separate run, without the scene and length warnings. ADR 8 keeps
  the pre-read's no-code rule and its reading order, without the advice on labels, `from` and items. ADR 9 keeps the
  linter; its audit subagent is removed. ADR 15 keeps the schema out of the skill and checks in the CLI; its references
  per step and per mode are removed. ADR 18 keeps the hook for `storyboard.json`; its `article.md` part is removed, and the audience it reads is the one
  the run's latest command ran with, not the last one given.

## Alternatives considered

- **Keep the warnings as advice the model may ignore.** Each warning still steers the model and costs a fix round, and
  the user asked to drop the opinions, not to soften them.
- **Keep the scene picker as optional reading.** It is advice on which scene to pick; the scene files' descriptions and
  examples say what each scene draws.
