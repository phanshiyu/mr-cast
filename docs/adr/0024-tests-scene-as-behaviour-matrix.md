# 24. The tests scene is a behaviour matrix

- Status: Accepted
- Date: 2026-10-18
- Supersedes: in 0019, the warning past 10 test cases (see Consequences)

## Context

Up to 0.26 the tests scene listed each test beside a sentence of what it proves, with the gaps in a panel below.
It said which tests exist, but not which behaviour each one pins down, which promises nothing checks, or how the
tests line up against the situations the code meets. Three designs were drawn as svg scenes on the webhook delivery
tests in `examples/primitives/tests` (branch `wt/tests-design`, `prototypes/tests-design/`): a coverage map (the
code's decision graph, each branch coloured by whether a test takes it), a behaviour matrix, and spec cards (one test
at a time as given, when, then). The matrix was also drawn at 15 tests and 5 gaps to see whether it still fits. The
user picked the matrix.

## Decision

A tests scene is a matrix. Rows are `situations`, each a `when` in plain words; columns are `outcomes`, what the
code promises. A situation's `expect` gives a promised value per outcome, such as `{ "Calls": "3" }`. `tests` name
the cells they assert in `checks`, as `"situation.Outcome"`.

- A cell a test checks is green with a tick, its value, and the word NEW or CHANGED from the tests that check it.
  A promised cell no test checks is amber and dashed, "unchecked". An outcome a situation does not promise is a
  faint dash. A situation with `gap` and no `expect` is one red dashed bar holding the gap. A removed test checks
  nothing; its `was` shows struck through in the cells it named, and a cell only a removed test named reads
  REMOVED.
- A step's `focus` is a situation id (its row), a cell, an outcome (its column) or a test's name (every cell it
  checks). A step that focuses tests shows their names and status in the header callout (ADR 0020), unless it sets
  its own `callout`.
- Test names stay on screen without a step. A column of names, each row listing the tests that check it, is drawn
  when every value still fits on one line beside it; otherwise each row's header says how many tests check it,
  unless no row has more than one. Both were drawn on the webhook scene and on the 15-test stress case: the counts
  alone left the overview unable to say which test checks what, and the column fits the stress case.
- The subject and the counts ("7 tests · 4 new · 2 changed · 1 removed · 2 unchecked · 2 gaps") sit on a line under
  the matrix, so the header keeps its room for the callout.
- `validate` fails on a check that names a missing situation or outcome, a duplicate situation id or outcome, and an
  `expect` key that is no outcome. It warns on a live test's check of a cell with no promised value, and on `gap`
  beside `expect`, which is not drawn. Every cell, row header, gap and name is fitted in the player's own layout,
  and a matrix that only fits scaled under the readable size is reported. The highlight check reads tests scenes:
  words naming a situation, an outcome, a test or a cell's value that the step leaves dark are warned.
- Tests link their code with `hunkId`, which counts a test hunk as shown, as before.

### Older storyboards

A tests scene with `cases` and `gaps` is read as a matrix where a storyboard enters, before `validate`
(`upgradeScenes` in `shared/normalize.mjs`, `upgradeTests` in `shared/tests.mjs`): each case is a situation named by
the test, with one outcome, "Proves" (or its `titles.proves`), holding what it proves, checked by that test; a
removed case's proof becomes its `was`; each gap is a situation of its own, drawn as a gap reading "Not tested" (or
`titles.gaps`). Steps that named a case by index or name, or a gap as `"gap:0"`, name its row. The mapping keeps
every name, proof, status, hunk link, gap and step, so one renderer serves both shapes. It drops a case's `badge` and
`tone` and the `subject` and `none` titles, which the matrix has no place for, and the "No tests in this change"
card: a scene with no tests reads "no tests" under the matrix instead.

## Alternatives considered

- **Keep the old renderer behind the old shape.** Two layouts, two validators, two highlight models and two sets of
  refs for one scene type, to keep a badge and a card. The conversion loses less than that costs.
- **The coverage map as the scene.** It shows the paths tests take, but needs the code's decision graph drawn by
  hand, which a graph scene with `tint` already does. It stays a worked example,
  `examples/primitives/tests-map/`, and the tests reference points at it.
- **Spec cards.** One test at a time reads well, but never shows the tests together, so a gap or an unchecked
  promise has nothing to stand against.

## Consequences

- A tests scene now says what each test pins down with real values, and shows the promises nothing checks.
- ADR 0019's capacity warning past 10 test cases is gone: the fit check measures the matrix as drawn and reports
  text that runs out of room or a matrix scaled under the readable size.
- Writing a matrix takes more thought than a list: the model must name the outcomes and the values. A storyboard
  can still use one outcome, as the older shape reads.
