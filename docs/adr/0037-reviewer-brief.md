# 37. A brief for the reviewer: six questions, facts from the tool, and answers that are checked

- Status: Accepted; amended 2026-11-15 (a decision carries its source, see section 2; how much of a core part is on screen, see section 3; "untested" is not a claim, and tests are named in full and counted from the map, see section 1)
- Date: 2026-11-15
- Amends: 0019 (tools, not opinions), 0008 (the reading scene outside a pre-read), 0013 (what the eval asks)

## Context

Since 0.25 (ADR 0019) the skill gives the model tools and no advice. The owner then found that the videos do not guide
a viewer to understand a merge request. Three baseline videos were made with the 0.28 skill by Sonnet writers: two
fixtures (`webhook-retries`, `invoice-status`) and one real branch of 27 files and 2,152 added lines. A blind viewer of
each answered eight understanding questions from the stills and the narration alone.

- All three viewers rated ease 4 of 5 and readiness to approve or reject 2 of 5.
- In all three, "how do we know it works" was "not shown", the reason for the change was inferred, the "before" was a
  guess, and no alternative or decision was named.
- On the real branch a critic with the code found the video showed 4 of 64 hunks, called the rest "mostly tests and
  docs" when eight existing files changed behaviour, and never said that `reply` and `explain` now refuse a body. The
  commit messages, a decision log and named tests held the why, the decisions and the proof; the video used none.
- One writer saw two real problems and left them out, because findings are for review mode only. The riskiest scene of
  another video, a migration, was cut off mid-SQL in its still.
- `extract` hands the writer a flat list of hunks in path order, docs first. It prints no commit message.

Two things failed before. Up to 0.24 the skill dictated the shape of every video (order, scene types, lengths) and
`validate` enforced it; the owner judged the results poor. From 0.25 it said nothing, and the videos became tours of
the diff. Neither asked the writer to find out what a reviewer of this change needs, and no eval measured it.

## Decision

A video of a branch answers six questions a reviewer has. mr-cast supplies the facts a diff does not show, the
storyboard carries the answers in a `brief`, and `validate` reports which answers are missing or point at nothing.
The order, the scene types and the length stay the writer's. This is the line between a fact and an opinion that ADR
0019 drew, moved by one step: what a reviewer needs answered is part of what mr-cast makes, how to show it is not.

### The six questions

| id | The viewer can answer |
| --- | --- |
| `why` | Why does this change exist, and who says so? |
| `case` | On one concrete case, what happened before and what happens now? |
| `approach` | What is the idea, and what did the author decide on the way? |
| `parts` | Which parts are there, which matter most, and which are routine? |
| `proof` | How do we know it works: what is tested, and what is not? |
| `check` | What could break, and what should I open first? |

### 1. `extract` prints a change map and writes it to `map.json`

All of it is fact, read from git and the working tree. Nothing in it needs a network.

- **Said by the author:** each commit's subject and body, oldest first, with its short sha. With `--description <file>`
  (a file holding the merge request's title and description), that text too. mr-cast does not call `gh` or `glab`; the
  skill tells the writer to save the description to a file when a PR or MR number is known.
- **Files by kind:** `source`, `tests`, `docs`, `config`, `routine` (lockfiles, generated, snapshots, pure renames), each
  file with `new`, `modified`, `removed` or `renamed`, its `+` and `−`, and its hunk ids. Within a kind, largest first.
  Modified source files are listed apart from new ones, since changed behaviour of existing code is what a reviewer
  misses.
- **Tests and what they cover:** for each changed test file, the changed source files it imports or names, and the test
  names it adds (the `test(`/`it(`/`def test_`/`func Test` lines among its added lines). Changed source files that no
  changed test names are listed as "no changed test names these".
- **Used elsewhere:** for each name declared on a changed or removed line of a modified source file (function, class,
  method, exported constant; by a per-language pattern, as `detectLanguage` knows the language), the files outside the
  diff that use it, by `git grep -w`, with a count and up to three paths. Marked as a text search, not a call graph.
- **`map.json`** holds the same facts as data: `commits` (`sha`, `subject`, `body`), `description` (`file`, `text`, or
  null), `files` grouped by kind, each file with `file`, `oldFile`, `kind`, `status`, `additions`, `deletions` and
  `hunkIds`, then `skipped`, `changedLines`, `tests` (each with `file`, `covers` and `adds`, the test names it adds),
  `untested` and `usedElsewhere`. `mr-cast map` prints it again.
- **Amended 2026-11-15: "no changed test names these" is not "untested".** A video said "nothing tests this file",
  taken from that list. The list is a text match on file names and imports, and a test can reach a file without naming
  it. The heading now reads "no changed test file names these; a test may still reach them, so read the tests before
  saying a file is untested", the same words are in `references/branch.md`, and `validate` warns the other way:
  `brief.proof.untested` or a tests scene's gap that names a file the map lists as covered says which test file covers
  it. The `untested` key of `map.json` keeps its name, and means only "no changed test file names it".
- **Amended 2026-11-15: tests are named in full and counted from the map.** A video said "5 tests · 1 gap" of a branch
  that adds about 23 named tests: the tests scene rejected long test names ("shorten the test names"), so the writer
  shortened and dropped them, and nothing on screen said how many tests there are. A test's `name` is now drawn as
  written, wrapped onto a second line and shrunk to the readable minimum before any warning; when it still cannot fit
  the writer gives a short `label`, and `name` stays the title. `validate` checks `name` against the test names the map
  lists as added and warns "no test this branch adds has this name". When the diff adds named tests, the scene's footer
  reads "5 of 23 tests this branch adds" without the writer typing it (the number is counted from the same added lines
  as `tests[].adds` in `map.json`), and `validate` warns when a count of tests the scene states disagrees with the map.
- **Amended 2026-11-15: groups are not tests, and a test "names or imports" a file.** A branch that adds 9 tests in 4
  `describe` groups was counted as 13, and the footer read "4 of 13 tests this branch adds". Only tests are counted now
  (`it(`, `test(` and their `.each`/`.only`/`.skip`/`.todo` forms, `def test_`, `func Test`, `#[test]` fns, `@Test`
  methods, Ruby `it '...'`/`test '...'`); `describe`, `context`, `suite`, `RSpec.describe` and `class Test...` go to
  `tests[].groups` in `map.json`, printed apart. A video also said a test "covers" a file the test only mocked, so every
  message and heading now says the test names or imports the file and may mock it; the `covers` key keeps its name.
- **The hunk index** as today, but source first, then tests, then docs, config and routine. Over 600 changed lines,
  the index prints each hunk's header and first two changed lines only, and `mr-cast hunk <id>...` prints hunks in full.

### 2. The storyboard's `brief`

A branch storyboard has a `brief`. Each answer is short, one or two sentences, and says where it comes from.

```jsonc
"brief": {
  "why":      { "text": "Reviewers had to hunt for the lines an answer leaned on.", "source": "commit 7376000" },
  "case":     { "before": "`src/lib.js:4-5` in an answer was plain text.",
                "after": "It is a numbered chip; hovering the answer tints lines 4-5.", "cite": ["h24", "test/refs.test.ts:10"] },
  "approach": { "text": "The CLI resolves each place when the answer is posted and stores it with a quote.",
                "decisions": [ { "text": "One bad place refuses the whole answer, like --map", "source": "commit 7376000" } ] },
  "parts":    [ { "name": "Finding and checking places", "weight": "core", "hunks": ["h24", "h12"] },
                { "name": "Chips on the page", "weight": "core", "hunks": ["h56", "h40"] },
                { "name": "Docs and the key sheet", "weight": "routine", "hunks": ["h1", "h2", "h3"] } ],
  "proof":    { "tested": ["Bad places are refused, all listed at once (test/cli.test.ts)"],
                "untested": ["A ref into a renamed file"], "cite": ["h31"] },
  "check":    [ { "file": "src/cli.ts", "line": "1845-1856", "what": "reply now refuses a body it used to accept",
                  "why": "every agent that writes path:line in backticks is affected" } ],
  "ask":      ["Why is an extensionless file such as Makefile:3 not a place?"]
}
```

- `source` is `"description"`, `"commit <sha>"`, `"code"`, `"test"`, `"inferred"` or `"unknown"`. `"unknown"` is an
  answer: the video then says the reason is not stated, and `ask` carries the question for the author. For `case`,
  `approach`, `parts` and `proof` the whole answer can be the string `"unknown"`, and `why` takes `source: "unknown"`
  with no `text`. `check` has no `"unknown"`: an empty list is a missing answer.
- **Amended 2026-11-15: a decision carries its source.** A measurement of videos made with the first skill found the
  reviewer's questions answered far better, but the count of claims the code contradicts did not fall (4 before, 5
  after). The new one: a video said the author "had two ways" and showed an alternative that appears in no diff or
  commit; the writer had invented it to fill `approach.decisions`. So each decision is `{ text, source, cite? }`, with
  `source` as `"description"`, `"commit <sha>"`, `"code"` (the choice shows in the code, so it has a `cite`) or
  `"mine"` (the writer's own observation: a way not taken that nobody names). A plain string is still read, as
  `"mine"`. `validate` warns about a `"code"` decision with no cite, a commit that is not the branch's, and a list
  that is all `"mine"` while the commits or description exist. `guide.md` and the guide panel label each one "The
  author says", "The code shows" or "Another way, not the author's", and a compare in `options` mode may say
  `"alternative": "mine"` so that its label reads "Another way", not "Not taken". A scene that shows such a way as
  the author's is warned about. The line gains the count by source: `approach ✓ 3 decisions (2 stated, 1 mine)`.
- `weight` is `core`, `support` or `routine`.
- `cite` entries are hunk ids, snippet ids, `path:line` or `path:a-b`, or a short sha.
- A scene says which questions it answers: `"answers": ["why", "case"]`.
- `parts` names the hunks, and the files come from them. A `files` scene with `"parts": "brief"` groups its files by
  these parts, core first.
- `check` items are what the old review mode kept behind a flag: the writer always lists what a reviewer should look
  at first. `findings` stays for a review the user asked for, with its severities.
- The `reading` scene is no longer for a pre-read only. In any branch video it draws `brief.check`, or its own items.

### 3. `validate` reports facts about the brief

Warnings, not errors, so every storyboard written before this still passes. `validate`, `outline` and the hook print one
line: `brief: why ✓ (commit 7376000) · case ✓ · approach ✓ 2 decisions (2 stated) · parts 3, core 2 · proof ✓ 1 tested, 1 untested · check 2 · ask 1`.
An answer that is `"unknown"` reads `proof unknown`, and a missing one `proof ✗`. The hook prints the brief line and the
scene mix line (ADR 0038) on success, as added context for Claude.

- A branch storyboard with no `brief`, or a question with no answer and no `"unknown"`.
- A question no scene `answers`.
- A `cite`, a `source` sha, a part's hunk or a `check` line that does not exist.
- A hunk of a source or test file that is in no part and not in `skipped`.
- A `core` part none of whose hunks any scene shows or cites.
- A modified source file from the map that no part holds.
- `proof.tested` empty while the map lists changed tests.
- `why.source` of `"inferred"` or `"unknown"` while the map has a commit body or a description.
- A `code` scene whose hunk has more lines than the frame draws and no step brings the rest into view: the lines
  never seen are named.

- **Amended 2026-11-15: how much of a core part is on screen.** A second measurement found a video that called the
  core part "shown" because one flow stop touched it, while most of its 386 changed lines never appeared. After the
  brief line, `validate` and `outline` (and the hook's success output) print one line, `core on screen: Finding and
  checking refs 14 of 386 changed lines · Chips and walkthrough 10 of 980`: for each `core` part, the changed lines
  (added plus removed) of its hunks that some scene draws. A code scene counts the lines its frames put on screen, a
  flow step's `code` its range, and a compare hunk cell the lines it reads; a tests scene names a hunk and draws none
  of its lines. It is a fact with no threshold and no warning, since a writer may choose to show little of a core part.

`validate` writes `guide.md` beside the video: the six answers, the parts with their files, the check-first list as
`path:line  what`, and the questions for the author. `render --out` copies it beside the MP4, as it does `review.md`.

### 4. What a scene can hold

Four scenes gained the means to show the answers. They are fields of the scenes, and `references/branch.md` tells the
writer what each is for.

- **compare** takes a cell `{ "hunk": "h11", "side": "old", "lines": "4-6" }`, real lines read from `hunks.json`. With
  `"mode": "options"` it shows a decision beside the way not taken: a side `chosen`, or a row `chosen` of 0 or 1.
- **flow** takes `code` on a step, `{ hunk or snippet, lines, light }`, in place of `payload`, so a request is followed
  through real code.
- **files** takes `parts`, a list of `{ name, weight }` with each file naming its `part`, or `"brief"` to read them
  from the brief.
- **reading** items take a `why`, and a `reading` scene with no items draws the brief's `check` list.

### 5. The skill

For a branch the skill says: read the map, answer the six questions in the `brief` before writing scenes, say
"unknown" where the map and the code do not say, make scenes that answer them in whatever order and form fit, then
look at the stills before showing the video. It gives one line per question on what a good answer holds. It dictates
no order, scene type, count or length. Explanations and quick videos are unchanged. What each scene that suits an answer
can hold is in `references/branch.md`. The installed SKILL.md may be 3,600 tokens (about 4 characters each), up from 3,000, to hold the six
questions; Claude Code keeps a skill's first 5,000 tokens after compaction.

### 6. The player

A scene's chapter in the sidebar carries the question it answers as a small label (Why, One case, The idea, The parts,
Proof, Check first), and the reading panel shows the check-first list in any branch video.

A branch video with a `brief` also has a guide panel in the page, where the reading panel sits and with its style (a
pre-read keeps its reading panel as it is). It lists the six questions with the brief's short answer to each, marks
the ones the video has reached, and seeks to the first scene that answers one when it is clicked. Under that it lists
"Open first" (each `check` item, seeking to the scene that shows that place when there is one) and "Ask the author". An
answer that is "unknown" reads "Not stated". The `G` key shows or hides it. It is part of the page, not of the
composition, so the rendered MP4 never has it; it stacks under the video on a small screen, as the reading panel
does, and never narrows the video. `shared/guide.mjs` shapes its data.

### 7. The eval

`quality/` gains the understanding questions used for the baseline (`quality/understanding.md`), a critic prompt that
grades the answers against the code and lists what the video led the viewer to believe that the code contradicts, and
`quality/prepare-repo.sh` to run a writer on any repository and branch. The numbers are the viewer's readiness, the
count of questions answered "not shown", and the critic's count of contradicted claims.

## Consequences

- A weak writer is pushed toward the reviewer's questions by a missing-answer line, not by a rule about scenes.
- The brief costs the writer one more thing to write. It is short, and it replaces the guesswork the baseline
  writers reported: audience, what to cover, whether to mention problems.
- A writer can fill the brief and still make a poor video. The eval, not `validate`, catches that.
- "Used elsewhere" is a text search and will list false matches. It is labelled as such.

## Alternatives considered

- **Put the six questions in the skill only.** The baseline writers had the commit messages one command away and did
  not read them. Without the map and the brief line, nothing shows a writer what it left out.
- **Bring back the 0.24 order and scene rules.** They dictated form, cost fix rounds, and the owner judged the results
  poor.
- **Call `gh` or `glab` from `extract` for the description.** It needs a network and credentials, and fails in ways
  the tool cannot explain. The writer already has those tools and can save the text to a file.
- **Errors, not warnings.** Every storyboard and example from before would stop rendering.
