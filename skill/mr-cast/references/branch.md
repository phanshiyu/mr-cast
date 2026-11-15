# A video of a branch

The six questions and the `brief` are in SKILL.md. This file says what the change map holds and what each scene that suits an answer can carry.

## The change map

`extract` prints it and writes `map.json`; `mr-cast map` prints it again.

- **What the author said:** every commit message, oldest first, and the description passed with `--description`. This is where `why` and the decisions in `approach` come from.

Give each decision its `source`: `"description"` or `"commit <sha>"` when the author wrote it, `"code"` with a `cite` when the choice shows in the code, and `"mine"` for a way not taken that nobody names. A `"mine"` decision is shown to the reviewer as not the author's, so do not invent one to fill the list; a short list is fine. Read every commit body before you settle on `"mine"`. A compare in `"mode": "options"` that draws such a way takes `"alternative": "mine"`, and its label then reads "Another way".
- **The files by kind:** existing code that changed first, then new files, tests, docs, config and routine files such as lockfiles. Changed behaviour of existing code is what a reviewer misses most.
- **Tests and what they cover:** for each changed test file, the changed source files it names and the test names it adds; and the changed source files no changed test names. This is where `proof` comes from.
- **Used elsewhere:** names from changed code and the files outside the diff that use them. It is a text search, so check a match before you rely on it. This is where much of `check` comes from.

## What a scene can hold

- **compare** puts two states side by side. A cell can show real lines of a hunk, old or new: `{ "hunk": "h11", "side": "old", "lines": "4-6" }`, up to 8 lines, each up to about 86 characters (fewer beside a row label or verdict marks; `validate` says how many). With `"mode": "options"` it is a decision beside the way not taken.
- **tests** is a grid of situations against outcomes, with the named tests that check each and the gaps nothing checks.
- **files** with `"parts": "brief"` draws the brief's parts as a map of cards: each part's name and weight, its `does` line, its file and line counts and its largest files, with "+ N more"; parts follow the parts their `after` names, with a link between them, and a part holding a `check` file is marked.
- **flow** is a rail of stops. A stop's `code` shows real lines of any hunk or snippet, lines up to about 120 characters and 20 or more of them, so one request can be followed through several files. A stop's `payload` is drawn as one line of code: a value, not a sentence.
- **code** shows one hunk or snippet, about 28 lines at a time. Steps bring lines into view; lines no step reaches are never seen.
- **reading** with no items draws the brief's `check` list.
- **graph**, **sequence**, **state** and **table** carry change marks, so what is new or changed stands out from what was there.

## What validate reports

- `brief:` shows which questions have an answer and a scene, and where `why` comes from.
- `scenes:` counts the scenes by type and names the longest run of one type.
- A question with no answer or no scene; a core or support part with no `does`, or an `after` naming no part; a cite, a hunk or a line that does not exist; a hunk of source or tests in no part; a core part no scene shows; changed tests with no test named on screen; a before and after that is spoken and never drawn; a diagram that repeats an earlier one; a flow `payload` that is a sentence; lines of a code scene that never come into view.
