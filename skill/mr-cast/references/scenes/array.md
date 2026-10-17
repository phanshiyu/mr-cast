# array

A row of cells with their indexes, named pointers above and shaded ranges below. Each step changes a value or moves a pointer, then lights what it is about.

## Lowers load when

- A process steps through data and the data stays put: a sort pass, binary search, a sliding window, two pointers, a queue, a ring buffer, a pagination cursor, an off-by-one.
- A rule picks an item by its place: "the least recently used entry is dropped" becomes "the last cell goes", with cells in recency order.
- The viewer would otherwise track indexes in their head. A pointer named `lo` on the screen holds that number for them.

## Adds load when

- The point is that two names share one object, or a copy versus a reference. Use [memory](memory.md).
- The data changes shape rather than value, such as a request gaining fields. Use [flow](flow.md).
- Items leave by time rather than by place, such as a TTL. Use [timeline](timeline.md).
- The array has more than 16 cells. Show a window of it, and say what is left out.

## Load mistakes

- **Words name cells that are not lit.** "Compare five and three" while only one cell is lit, or while the light is still on the last swap. Light exactly the cells the sentence names. A step that only moves a pointer lights the pointer and its one cell, so when the words name the neighbour too, focus both cells.
- **The swap lands while the words still compare.** A step's change lands as the step starts, before its words. So a step that compares and then swaps shows the values already swapped while the voice is still comparing them. Compare, then swap: give the comparison its own step that focuses both cells, as `{ "focus": "1-2", "say": "Compare five and four." }`, then swap in the next step, as `{ "set": { "1": 4, "2": 5 }, "say": "Five is bigger, so they swap." }`. The swap step lights what it sets, so it needs no `focus`.
- **Several moves in one step.** A whole pass in one step changes cells before the voice reaches them. One comparison or one swap a step. When a pass is too long for that, walk the first pass in full, then show later passes as one step each and say so.
- **Everything shown at once.** Pointers the idea has not reached yet are on screen from the start. List them with `"hidden": true` and `show` them when the words need them.
- **The narration says the algorithm, the steps repeat it.** The narration says what the row is ("the scores, unsorted"). The steps carry the algorithm.

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

`set` gives cells new values (`{ "3": 42 }`), `move` puts a pointer or range in a new place (`{ "lo": 4, "window": "2-5" }`), and `show` and `hide` bring one in or out (`["ptr:mid"]`). A step without `focus` lights what it changes. A `focus` is a cell index, an `"a-b"` range, `"ptr:lo"` or `"range:window"`. `{{MR_CAST}}/bin/mr-cast validate` fails on a pointer outside -1 to the length, a `move` or `show` of something that does not exist, and a step that only hides with no `focus`. It warns past 16 cells, 4 pointers or 3 ranges, on a `set` that leaves a cell as it was, on a value or index the words name that the step leaves dark, and on a swap that no step lit before it. `{{MR_CAST}}/bin/mr-cast steps` prints each step's words beside the cells it lights.

`{{MR_CAST}}/bin/mr-cast schema array` prints its fields.
