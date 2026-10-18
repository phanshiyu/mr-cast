# ink

A pen that writes and draws on any stepped scene, as on a whiteboard. A step's `draw` lists what to draw; each item is written on as the voice reaches its cue words and stays until a later step's `erase`.

## Example

```json
{
  "type": "array",
  "chapter": "Two pointers",
  "title": "Which two add up to 11?",
  "narration": "The list is sorted. We want two numbers that add up to eleven.",
  "values": [1, 3, 4, 6, 8, 11],
  "pointers": [{ "name": "lo", "at": 0 }, { "name": "hi", "at": 5 }],
  "steps": [
    {
      "focus": ["ptr:lo", "ptr:hi"],
      "say": "One plus eleven is twelve, which is too big.",
      "draw": [
        { "write": "want 11", "at": [0.04, 0.06], "id": "goal" },
        { "arrow": [0, 5], "note": "1 + 11 = 12", "when": "one plus eleven", "id": "sum" }
      ]
    },
    { "move": { "hi": 4 }, "say": "So we cross out the biggest.", "draw": [{ "cross": 5, "when": "cross out" }] },
    {
      "move": { "lo": 1 },
      "erase": ["sum"],
      "say": "Three plus eight gives exactly the sum we want.",
      "draw": [
        { "circle": 1, "id": "three", "when": "three plus eight" },
        { "circle": 4 },
        { "arrow": ["goal", "three"], "when": "exactly" }
      ]
    }
  ]
}
```

## Schema and validate notes

An item names one verb, and the verb's value says what it draws on: a ref the step's `focus` takes, a list of refs, or the `id` of an item already on the board. `circle`, `box`, `underline`, `strike` and `cross` draw on it, `tick` draws a check mark to its right, and `brace` draws a curly brace along the span its refs cover, below a wide span and right of a tall one unless `side` says. `arrow` is `[from, to]`, each a ref, an item's `id` or an `[x, y]` point. `write` is handwritten text with `near`, a ref or id to write beside, or `at`, the text's top left as fractions of the stage, such as `[0.04, 0.06]`; `"\n"` breaks lines. On a code step a ref is a line number, an `"a-b"` range, or any other string, which names that text on the step's lines.

Options on any item: `note`, a short label beside a mark or brace or along an arrow; `when`, words of the step's `say` at which the item starts (without it, items draw one after another from the step's start); `tone`, the pen's colour, yellow unless set; `side` (`above`, `below`, `left`, `right`) for a brace, a `write` with `near`, or a note; and `id`, so a later arrow can point at the item or `erase` can take it off. `"erase": true` on a step takes everything drawn so far off the board as the step starts, before its own `draw`, and `"erase": ["id"]` takes those items. Text goes where it covers least of what the scene shows from its step on, ink already up included; without a clear spot beside it, at the end of its row, or else off in free space with a leader arrow back.

A step's `mark` and `note` still work: one mark on its first focus ref, drawn just before its words and gone at the next step. Ink is not lit, so the highlight check reads only `focus` and what a step changes.

`{{MR_CAST}}/bin/mr-cast validate` fails on an item with no verb or with two, an unknown field, a ref that names nothing, an id that is not on the board at that step (an `arrow` or `near` from an item drawn later, an `erase` of an id never drawn or already erased), an id that is also a ref, a `when` the step's `say` does not contain, a `write` with neither or both of `near` and `at`, a point outside 0 to 1, and a note or a line of `write` over 40 characters. It warns when text written `at` a point lands on something a graph, table, array, memory, svg or state scene draws while the text is up. `{{MR_CAST}}/bin/mr-cast still <scene> --step <k>` shows the board as step k ends.

A whole demo: `{{MR_CAST}}/examples/primitives/ink/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/algorithms/dijkstra/storyboard.json` (scenes 2 and 3, each relaxation's sum along its road) and `{{MR_CAST}}/examples/algorithms/binary-search/storyboard.json` (scene 2, each look circled and each ruled-out half braced).
