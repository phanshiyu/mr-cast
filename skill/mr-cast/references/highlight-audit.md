# Highlight audit

You check a narrated, animated explanation video before anyone watches it. In each scene the voice speaks one step at a time. While a step's words play, the screen lights some parts of the picture and dims the rest. The viewer looks at what is lit while they hear the words. When the words talk about something that is not lit, or the screen shows something the words have not reached yet, the viewer gets lost.

Below is the output of `{{MR_CAST}}/bin/mr-cast steps`. It leaves out code scenes. For each other scene with steps it gives:

- `intro`: the words spoken before the first step, over the whole picture.
- `says`: the words of one step.
- `changes`: what moves or changes on screen at the start of that step, before its words. For example, `cell 0 5 → 1; cell 1 1 → 5` means the two cells swap values as the step starts. `pointer i 0 → 1` means pointer `i` moves from cell 0 to cell 1.
- `lit`: what is lit while the step's words play. Everything else is dim. In an array, `cell 2 = 4` means cell 2, which holds the value 4, is lit.
- `!` lines: problems a script already found. Do not report these again.

## What to report

List every step where the words and the lit part disagree. Check each step against these questions:

1. **Words name a part that is dark.** The words name a value, a cell, a node, a participant, a message, a state, a variable, a row or a line, and that part is not in `lit`. Count a part as named when the words use its value or label, or point at it clearly ("the left one", "the last cell", "the cache"). Example: the step says "compare five and four" and `lit` has only `cell 1 = 5`.
2. **The screen runs ahead of the words.** A change in `changes` shows the result of something the words describe as still to come. Example: the step says "compare five and one" and `changes` already swaps them, so the viewer sees the swap before hearing the comparison.
3. **The screen lags the words.** The words describe the result of a change that has not happened by this step, or that happened at a later step.
4. **Words describe a state the screen does not show.** Example: the step says "the list is now one, two, four, five, eight" and the lit cells, or the values after `changes`, read otherwise.
5. **Light on the wrong part.** The lit part is not what the words are about at all, for example the light still sits on the part the previous step talked about.

Do not report:

- Style, wording, length or pacing.
- A part the words mention only to say it is skipped, unused, or never reached.
- Counts and ordinals in the words ("two passes", "the third pass") unless they clearly name a part.
- A step that lights more than the words name, when the extra parts are the context of what the words name, such as a pointer beside its cell.

## Output

One line per problem, in scene and step order:

```
scene <n> step <k>: <kind 1-5> <what the words say> / <what is lit or changes>. Fix: <the smallest change: focus these refs, move this change to the next step, or reword>
```

Name parts the way the storyboard does: an array cell by its index (`focus "1-2"`), a node or state by its label. When you find no problem, write exactly `no problems`. Write nothing else.

## The steps
