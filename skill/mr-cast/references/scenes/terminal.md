# terminal

A shell window where commands type out and their output appears, a failing exit tinted red.

## Lowers load when

- The idea is a run and its output: "the test fails with a timeout, and passes after the fix", "the migration refuses twelve old rows".
- The viewer sees the evidence itself, not a claim about it. Only use output you ran or read.

## Adds load when

- You know the behaviour but did not run it. Use [compare](compare.md), and never invent output.
- The point is what each test proves. Use [tests](tests.md).

## Load mistakes

- **A whole log pasted in.** The line that matters is lost. Trim each output to the lines the words name.
- **Words about one line while the whole entry is lit.** Light the line, as `"0:2"`.
- **More than 3 commands at once.** Walk them one or two a step.

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

A `focus` is an entry index, an `"a-b"` range, or one output line `"entry:line"`. Each entry has a one-line `command`, its `output`, and an `exit`. `{{MR_CAST}}/bin/mr-cast validate` fails on a multi-line command and an entry with neither command nor output, and warns on output over 30 lines and more than 3 entries with no steps.

`{{MR_CAST}}/bin/mr-cast schema terminal` prints its fields.
