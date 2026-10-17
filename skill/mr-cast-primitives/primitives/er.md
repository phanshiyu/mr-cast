# er

Tables or models with their keys and in-play fields, and lines between them with their cardinality.

## Lowers load when

- The idea is the shape of stored data: "each order has many items, and each item points at one product".
- Keys and lines show how records relate in one picture, so "which table points at which" needs no sentence.
- With [compare](compare.md) after it, a reshaping of data: the model shows the new shape, and one row before and after makes it concrete.

## Adds load when

- It is one table's columns as facts. Use [table](table.md).
- The story is running the migration. Use [terminal](terminal.md).
- More than 6 tables, or more than 10 fields in one.

## Load mistakes

- **Every column of a wide table.** The fields that matter drown. Show the keys and the fields in play.
- **Words about a relation while only a table is lit.** Light the foreign key field and the relation together.
- **Tables that are not part of the idea.** Show the tables that matter and their direct neighbours.

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

A `focus` is an entity id, a field `"orders.status"`, a relation `"users->orders"`, or a relation index. Cardinality is `one-to-one`, `one-to-many` or `many-to-many`, and for one-to-many `from` is the one side. `{{MR_CAST}}/bin/mr-cast validate` fails on a relation to an unknown entity or cardinality, and warns past 6 entities or 10 fields.
