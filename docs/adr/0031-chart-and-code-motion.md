# 31. Charts whose values move, and code that types itself

- Status: Accepted
- Date: 2026-10-18

## Context

The YouTube devices research (`docs/research/youtube-devices.md`, P3 and P4) found four devices the scenes could not show: a bar chart race (D21), a chart built up or changed in stages (D22), a pie or donut (D23), and code typed on screen beside its output (D2, D3). A chart's values were fixed for the whole scene, so a race took one scene per frame, and a code scene could only light lines already on screen, so the code and what it printed were never seen together. The user picked "chart + code motion" from the proposals.

## Decision

- **Charts join the shared step model** (`shared/state-steps.mjs`, ADR 0020). A chart's state is each value by its item key, `p:series/label`, plus whether it is sorted and its callout. A step's `set` takes a series by name, to one number per label, or one value `"series@label"`, to a number; `sort` turns ordering by value on or off; `callout` replaces the header callout. A step with no `focus` lights what it sets, a series as `"series:name"`. `show` and `hide` are refused: a value set from 0 grows instead.
- **Values tween; printed values count.** The bars, points and slices move to the new values over the step's settle, exactly, and each printed value is rounded to the places its two ends are written with, so a label counts 24, 25, 26 rather than printing 25.53.
- **Sorting slides labels between slots.** Each label's place is its rank by value (a stack's total, else the last series), ties in the order of `labels`. A label's slot moves from its place in the step before to its place in the step, so bars overtake each other.
- **New shapes.** `horizontal` bars, one row a label, print each value past the bar and draw no axis: each bar is as long as its value against the largest value then on screen, so a race keeps its leader at full width. With one series and no tone, each row has its own colour, so a bar is easy to follow as it moves. `pie` and `donut` draw one series as slices clockwise from the top with a legend of values and shares; a donut prints the total in its hole. `stacked` stacks bar series with each stack's total above it.
- **The vertical bar and line chart keep their code path.** One axis covers every state, so it never moves; with one state the layout, the labels and every pixel are as in 0.27. Thirty existing chart stills compare equal.
- **Typing.** `typing: true` makes each step type its lines in over most of its `say`, at 0.6 to 3 characters a frame, done before the next step starts; an indent appears with its line, as an editor indents. Lines no step names are there from the start. A typing scene writes the new code, so removed lines are not drawn and a step on `oldLines` is refused.
- **Output.** A step's `output` prints into a terminal-like pane beside the code, a line every four frames, under the steps before it, scrolling to keep the newest line in view, styled with the terminal's markup. It starts at the words of `outputWhen` (`cueFrame`, as ink's `when`), else once the step is typed, else as its words start. The pane takes the room a step diagram would, so the two are refused together.
- Existing code scenes render pixel for pixel as in 0.27: 36 code stills compare equal.

## Alternatives considered

- **A separate `race` scene.** It would repeat the chart's layout, legend and value labels; a step that sets values is the same tool for a race, a chart built in stages, and a before and after.
- **An axis that rescales on horizontal charts.** Moving tick labels made the race hard to read in a sketch; printing each value past its bar says the same with nothing moving but the bars.
- **Output as its own `terminal` scene after the code**, as before. The viewer never sees the line and its effect together, which is the point of D3.
- **Typing removed lines out with backspace.** It doubles the timing rules for a case the narration rarely needs; a typing scene shows the code being written, and a morph scene still shows what a diff removes.

## Consequences

- A storyboard can show a bar chart race with a year callout, a donut whose slices change, stacks built up step by step, and code written line by line with its output beside it.
- `validate` checks every step's values: sets that name nothing, wrong lengths, negative bars, value labels that run together in any state, and a pie with nothing to draw.
- Pie labels sit in a legend beside the pie, not on leader lines, so the scene fits up to 8 slices; past that it warns.
- Rows of a sorted horizontal chart cross each other while they move, as in the races the research cites.
- Nothing is superseded.
