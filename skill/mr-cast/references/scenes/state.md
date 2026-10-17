# state

The statuses a thing can be in and the moves between them, with the start marked and the end states double-bordered.

## Lowers load when

- The idea is a lifecycle: "an order starts pending, becomes paid, and is cancelled after a day unpaid".
- Every status is on screen at once, so each move is one lit arrow, and the viewer sees where a thing can and cannot go.
- After a [sequence](sequence.md) of calls, it shows the statuses those calls move through.

## Adds load when

- The idea is one check and its answers rather than a status. Use a [graph](graph.md) flowchart.
- When it happens matters more than which status it is in. Use [timeline](timeline.md).
- There are more than 10 states. Merge minor ones, or split the machine.

## Load mistakes

- **Words name a move that is not lit.** "Paying moves it to paid" while only the pending state is lit. Light the transition, and the state it lands in.
- **No start.** Without `initial` the viewer cannot tell where to begin reading.
- **Unlabelled arrows.** The viewer must guess what causes each move. Label each with its event or guard, such as `"timeout [24h]"`.

## Example

```json
{
  "type": "state",
  "chapter": "A visitor's minute",
  "title": "Visitor",
  "narration": "Each visitor is in one of three states within a minute.",
  "initial": "under",
  "states": [
    { "id": "under", "label": "Under the limit" },
    { "id": "limited", "label": "Limited", "change": "added" },
    { "id": "reset", "label": "New minute", "final": true }
  ],
  "transitions": [
    { "from": "under", "to": "under", "label": "request [count ≤ 20]" },
    { "from": "under", "to": "limited", "label": "request [count > 20]", "change": "added" },
    { "from": "limited", "to": "reset", "label": "minute ends" },
    { "from": "under", "to": "reset", "label": "minute ends" }
  ],
  "steps": [
    { "focus": "under", "say": "A visitor starts each minute under the limit." },
    { "focus": "request [count ≤ 20]", "say": "Up to twenty requests keep the visitor under the limit." },
    { "focus": ["under->limited", "limited"], "say": "The twenty first request makes the visitor limited." },
    { "focus": "limited->reset", "say": "When the minute ends, the count starts again." }
  ]
}
```

## Schema and validate notes

A `focus` is a state id, a transition `"from->to"`, its exact label, or a transition index. A state id lights the state, not the arrows into it. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown `initial` or transition end, and warns past 10 states.

`{{MR_CAST}}/bin/mr-cast schema state` prints its fields.
