# code

The lines of one hunk or snippet, the rest dimmed, walked a range at a time, with an optional step diagram beside them.

## Example

```json
{
  "type": "code",
  "chapter": "The limiter",
  "hunkId": "h2",
  "narration": "So how does the limiter know a visitor is past the limit?",
  "steps": [
    { "lines": 11, "label": "key per visitor per minute", "say": "The limiter builds a key from the visitor's address and the current minute, so a new minute starts a new count." },
    { "lines": "12-13", "label": "count the request in Redis", "say": "Redis adds one to that count, and the first request of a minute sets the count to expire." },
    { "lines": "14-17", "label": "refuse past the limit", "outcome": "too many requests", "say": "Past the limit, the limiter tells the visitor when to retry and refuses the request." },
    { "lines": 18, "label": "let it through", "say": "Otherwise the request goes on to the route." }
  ]
}
```

## Schema and validate notes

Each step names its `lines` (or `oldLines` for removed code) and its `say`; with a `label` on every step, a step diagram is drawn beside the code, with an `outcome` where a step branches. The scene's `narration` is the intro before the first step. Reference the code by `hunkId`; the lines come from hunks.json, coloured by the hunk's `language` (set from the file name in a diff: `"typescript"`, `"python"`, `"go"`, `"rust"`, `"sql"`, `"yaml"`, `"json"`, `"docker"` for a Dockerfile, and more; bash, ruby and a language it does not know print plain). Without steps, `focusLinesAfter` (and `focusLinesBefore` for removed code) take the printed line numbers as numbers or `"start-end"` strings, each string its own range, and `flow` gives one labelled step per range, in the same order. A pen `token` is text that occurs once on the step's lines, such as `"max: 20"`. `{{MR_CAST}}/bin/mr-cast validate` fails on lines outside the hunk, overlapping steps, steps out of top-to-bottom order (the light follows the code down), labels on only some steps, and a `flow` whose length differs from the ranges. It warns past 6 labelled steps, which is what the step diagram holds.

`"typing": true` makes each step type its lines in, a character at a time behind a cursor, over its `say`, instead of lighting lines already on screen. Lines no step names are there from the start, and removed lines are not drawn, so a diff hunk shows its new code being written. A step's `output` prints into a terminal-like pane beside the code, under the output of the steps before it, with markup colours such as `"[✓ 3 passed]{good}"`; it starts at the words of `outputWhen`, else once the step's lines are typed, else as its words start. `outputTitle` names the pane. Validate fails on `typing` without steps, with `view: "split"` or on a step's `oldLines`, on an `outputWhen` the `say` does not contain, and on output beside labelled steps, since the step diagram takes the same room.

```
{ "type": "code", "hunkId": "s1", "typing": true, "outputTitle": "zsh", "narration": "FizzBuzz from scratch.",
  "steps": [
    { "lines": "1-8", "say": "Count to n and print Fizz, Buzz or the number." },
    { "lines": 10, "say": "Call it, run it, and it prints them.", "output": "$ node fizzbuzz.js\n1\n2\nFizz", "outputWhen": "run it" }
  ] }
```

`{{MR_CAST}}/bin/mr-cast schema code` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/code/storyboard.json`; typing and output, on a snippet and on a diff: `{{MR_CAST}}/examples/primitives/code-typing/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/algorithms/quicksort/storyboard.json` (scene 3, the partition in Java); `{{MR_CAST}}/examples/tech/docker-100s/storyboard.json` (scene 2, a Dockerfile with its output).
