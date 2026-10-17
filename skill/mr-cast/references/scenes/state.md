# state

The statuses a thing can be in and the moves between them, with the start marked and the end states double-bordered.

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
