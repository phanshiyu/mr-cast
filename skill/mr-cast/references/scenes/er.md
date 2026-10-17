# er

Tables or models with their keys and in-play fields, and lines between them with their cardinality.

## Example

```json
{
  "type": "er",
  "chapter": "Where the limits live",
  "title": "Rate limit data",
  "narration": "Two tables give each plan its own limit.",
  "entities": [
    { "id": "plans", "name": "plans", "fields": [
      { "name": "id", "type": "uuid", "pk": true },
      { "name": "name", "type": "text" }
    ] },
    { "id": "limits", "name": "rate_limits", "fields": [
      { "name": "plan_id", "type": "uuid", "fk": true },
      { "name": "per_minute", "type": "int" }
    ] }
  ],
  "relations": [
    { "from": "plans", "to": "limits", "cardinality": "one-to-one", "label": "has" }
  ],
  "steps": [
    { "focus": "limits", "say": "The rate limits table holds one limit per plan." },
    { "focus": ["limits.plan_id", "plans->limits"], "say": "Each limit row points at one plan." },
    { "focus": "limits.per_minute", "say": "The per minute column is the number of requests that plan allows." }
  ]
}
```

## Schema and validate notes

A `focus` is an entity id, a field `"orders.status"`, a relation `"users->orders"`, or a relation index. Cardinality is `one-to-one`, `one-to-many` or `many-to-many`, and for one-to-many `from` is the one side. `{{MR_CAST}}/bin/mr-cast validate` fails on a relation to an unknown entity or cardinality, and warns past 6 entities.

`{{MR_CAST}}/bin/mr-cast schema er` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/er/storyboard.json`.
