# A video of a branch

The six questions and the `brief` are in SKILL.md. This file says what the change map holds and what each scene that suits an answer can carry.

## The change map

`extract` prints it and writes `map.json`; `mr-cast map` prints it again.

- **What the author said:** every commit message, oldest first, and the description passed with `--description`. This is where `why` and the decisions in `approach` come from.
- **The files by kind:** existing code that changed first, then new files, tests, docs, config and routine files such as lockfiles. Changed behaviour of existing code is what a reviewer misses most.
- **Tests and what they cover:** for each changed test file, the changed source files it names and the test names it adds; and the changed source files no changed test names. This is where `proof` comes from.
- **Used elsewhere:** names from changed code and the files outside the diff that use them. It is a text search, so check a match before you rely on it. This is where much of `check` comes from.

## What a scene can hold

- **compare** puts two states side by side. A cell can show real lines of a hunk, old or new: `{ "hunk": "h11", "side": "old", "lines": "4-6" }`, up to 8 lines. With `"mode": "options"` it is a decision beside the way not taken.
- **tests** is a grid of situations against outcomes, with the named tests that check each and the gaps nothing checks.
- **files** with `"parts": "brief"` draws the brief's parts, core first, each with its files and line counts.
- **flow** is a rail of stops. A stop's `code` shows real lines of any hunk or snippet, up to 14, so one request can be followed through several files. A stop's `payload` is drawn as one line of code: a value, not a sentence.
- **code** shows one hunk or snippet, about 28 lines at a time. Steps bring lines into view; lines no step reaches are never seen.
- **reading** with no items draws the brief's `check` list.
- **graph**, **sequence**, **state** and **table** carry change marks, so what is new or changed stands out from what was there.

## What validate reports

- `brief:` shows which questions have an answer and a scene, and where `why` comes from.
- `scenes:` counts the scenes by type and names the longest run of one type.
- A question with no answer or no scene; a cite, a hunk or a line that does not exist; a hunk of source or tests in no part; a core part no scene shows; changed tests with no test named on screen; a before and after that is spoken and never drawn; a diagram that repeats an earlier one; a flow `payload` that is a sentence; lines of a code scene that never come into view.
