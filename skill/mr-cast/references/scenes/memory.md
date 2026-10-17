# memory

Call frames with their variables on the left, objects on the right, and an arrow for every reference.

## Example

```json
{
  "type": "memory",
  "chapter": "Why counts live in Redis",
  "title": "Without Redis: two counts",
  "narration": "Without a shared store, each server process would keep its own map of counts.",
  "frames": [
    { "name": "server_a", "vars": { "counts": { "ref": "m1" } } },
    { "name": "server_b", "vars": { "counts": { "ref": "m2" } } }
  ],
  "objects": [
    { "id": "m1", "type": "Map", "fields": { "203.0.113.7": 12 } },
    { "id": "m2", "type": "Map", "fields": { "203.0.113.7": 11 } }
  ],
  "steps": [
    { "focus": ["server_a.counts", "m1"], "say": "The first server has counted twelve requests from the visitor." },
    { "focus": ["server_b.counts", "m2"], "say": "The second server has counted eleven from the same visitor." },
    { "set": { "m2.203.0.113.7": 12 }, "say": "The visitor's next request lands on the second server, which counts it as its twelfth." }
  ]
}
```

## Schema and validate notes

A `focus` is `"frame:main"`, a variable `"main.cart"`, an object id, or a field `"c1.items"`. `set` changes a value, and `{ "ref": "c1" }` draws an arrow. Object ids take no `.` or `:`. `{{MR_CAST}}/bin/mr-cast validate` fails on a ref to an unknown or hidden object and two frames with one name.

`{{MR_CAST}}/bin/mr-cast schema memory` prints its fields.
