# array

One or more rows of cells with their indexes, named pointers above and shaded ranges below, or a hex grid. Each step changes a value, moves a pointer or tints cells, then lights what it is about.

## Example

```json
{
  "type": "array",
  "chapter": "Finding the limit",
  "title": "Binary search for 23",
  "label": "limits",
  "narration": "The plans' limits are sorted, so the search halves the list each step.",
  "values": [5, 10, 20, 23, 50, 100, 200],
  "pointers": [{ "name": "lo", "at": 0 }, { "name": "hi", "at": 6 }, { "name": "mid", "at": 3, "hidden": true }],
  "steps": [
    { "focus": ["ptr:lo", "ptr:hi"], "say": "The search starts with the whole list, from the first cell to the last." },
    { "show": ["ptr:mid"], "say": "The middle cell holds twenty three." },
    { "focus": 3, "mark": "circle", "note": "found", "say": "Twenty three is the value we want, so the search stops after one look." }
  ]
}
```

## Schema and validate notes

`set` gives cells new values (`{ "3": 42 }`), `move` puts a pointer or range in a new place (`{ "lo": 4, "window": "2-5" }`), and `show` and `hide` bring one in or out (`["ptr:mid"]`). A step without `focus` lights what it changes. A `focus` is a cell index, an `"a-b"` range, `"ptr:lo"` or `"range:window"`. `{{MR_CAST}}/bin/mr-cast validate` fails on a pointer outside -1 to the length, a `move` or `show` of something that does not exist, and a step that only hides with no `focus`. It warns past 16 cells, where each gets too narrow to read, on a `set` that leaves a cell as it was, on a value or index the words name that the step leaves dark, and on a swap that no step lit before it. `{{MR_CAST}}/bin/mr-cast steps` prints each step's words beside the cells it lights.

**Several arrays.** `arrays` in place of `values` draws each `{ name, label?, values, splits?, hidden? }` as its own row, top to bottom, with one cell size and its label at its left. A cell ref names its array, `"left[0]"` or `"left[0-1]"`, and `"array:left"` is the whole array, which `show` and `hide` take. `{{MR_CAST}}/bin/mr-cast validate` warns on an array, pointer or range that starts `hidden` and no step shows. A pointer or range takes `"array": "left"`, and the first array otherwise. `splits` cuts an array before the given cells with a wider gap, as halves of a divide level. `cells: "hex"` draws hexagons, each row set half a cell right of the one above, for a hex grid; it draws no pointers, ranges or indexes. `indexes: false` hides the index labels.

**Tint and callout.** `tint` maps cell refs to a colour that stays from that step on: a tone (`good`, `bad`, `warn`, `accent`, `neutral`) fills the cell, `"dim"` fades it, `"clear"` takes it off. A scene-level `tint` is the first state. `callout` is a boxed line at the right of the header, such as `"mid = L + ⌊(R − L) / 2⌋"`; a step's `callout` replaces it from that step on, and `""` removes it. It takes markup, and the voice does not read it. A step without `focus` lights what it sets, moves, shows and tints a tone; what it dims recedes, unless dimming is all it does.

A whole demo: `{{MR_CAST}}/examples/primitives/array/storyboard.json`.

`{{MR_CAST}}/bin/mr-cast schema array` prints its fields.
