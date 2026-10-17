# flow

A row of stages, each an actor and what it does, with the data as it looks after that stage.

## Lowers load when

- Data changes shape in stages: "the request is parsed, validated, then enriched with the user".
- The viewer needs the payload at each stage. It is drawn beside the stage, so nothing has to be remembered from the last one.

## Adds load when

- Who calls whom, and the replies, matter more than the payload. Use [sequence](sequence.md).
- The stages branch. Use a [graph](graph.md) flowchart.
- One list changes in place. Use [array](array.md).
- There are more than 7 stages. Split the flow in two.

## Load mistakes

- **Words run ahead of the current stage.** The `say` of a stage talks about the next one. Each `say` names only its own actor and payload.
- **Vague actors,** such as "the system". The viewer cannot map it onto anything. Name the function or service.
- **A payload that repeats the action.** "validates" with the payload "validated". Show the data as it now looks, with real values.

## Example

```json
{
  "type": "flow",
  "chapter": "What the limiter keeps",
  "title": "One request, step by step",
  "narration": "Here is what the limiter makes of one request.",
  "steps": [
    { "actor": "rateLimit", "action": "builds the key", "payload": "rl:203.0.113.7:29126401", "icon": "key-round", "say": "The limiter builds a key from the visitor's address and the current minute." },
    { "actor": "Redis", "action": "adds one", "payload": "21", "icon": "database", "say": "Redis adds one to the count under that key and returns twenty one." },
    { "actor": "rateLimit", "action": "refuses", "payload": "429 Retry-After: 60", "icon": "gauge", "tone": "bad", "say": "Twenty one is past the limit, so the limiter refuses and asks the visitor to wait a minute." }
  ]
}
```

## Schema and validate notes

A flow takes no `focus`. Each stage is `{ actor, action, payload?, icon?, say? }`, and either every stage has a `say` or none does. `payload` is a string, so stringify JSON yourself. `{{MR_CAST}}/bin/mr-cast validate` fails on a `say` on only some stages and a payload that is not a string, and warns past 8 stages.

`{{MR_CAST}}/bin/mr-cast schema flow` prints its fields.
