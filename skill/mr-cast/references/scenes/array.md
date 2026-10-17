# array

A row of cells with their indexes, named pointers above and shaded ranges below. Each step changes a value or moves a pointer, then lights what it is about.

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

`{{MR_CAST}}/bin/mr-cast schema array` prints its fields.
