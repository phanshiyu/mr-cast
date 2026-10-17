# terminal

A shell window where commands type out and their output appears, a failing exit tinted red.

## Example

```json
{
  "type": "terminal",
  "chapter": "Trying it",
  "title": "Twenty one requests",
  "window": "zsh: ~/shop",
  "narration": "Sending twenty one requests shows the limit at work.",
  "entries": [
    { "command": "for i in $(seq 21); do curl -s -o /dev/null -w '%{http_code}\\n' -X POST localhost:3000/orders; done | uniq -c", "output": "  20 201\n   1 [429]{bad}", "exit": 0 },
    { "command": "curl -si -X POST localhost:3000/orders | head -3", "output": "HTTP/1.1 429 Too Many Requests\nRetry-After: 60\n{\"error\":\"rate_limited\"}", "exit": 0 }
  ],
  "steps": [
    { "focus": 0, "say": "Twenty one orders in a row get twenty created answers and one too many requests." },
    { "focus": "1:1", "say": "The refusal tells the client to retry after sixty seconds." }
  ]
}
```

## Schema and validate notes

A `focus` is an entry index, an `"a-b"` range, or one output line `"entry:line"`. Each entry has a one-line `command`, its `output`, and an `exit`. Without steps the whole session plays during the narration. `{{MR_CAST}}/bin/mr-cast validate` fails on a multi-line command and an entry with neither command nor output.

`{{MR_CAST}}/bin/mr-cast schema terminal` prints its fields.
