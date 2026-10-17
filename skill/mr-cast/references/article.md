# Write the article

Write `article.md` in the run's directory: a teaching article that a reader can learn the subject from with nothing else. "Explain quicksort" gives an article from which someone understands quicksort. For the branch, it is a written walkthrough of the change that a reviewer could review from. A later step turns it into the video, so write it as you would for a page: it says nothing of how it will be shown.

## Before you write

Decide, without writing it down in the article:

- **The reader.** What they know, what they do not, and the wrong idea they most likely hold. The audience sets it: a reviewer of this change knows the codebase and not the change; someone new knows neither; the team wants what changes for users and the risk; for an explanation, a teammate who knows the code, unless the user said otherwise.
- **The takeaways.** 2 to 4, each a full sentence that a reader who got the article could say back. Every paragraph serves one of them.
- **One running example** with real values: a real input, request or case that you will trace from start to end. For the branch, it is the case that shows the problem, such as "a visitor sends a twenty-first request inside one minute, and today it still goes through".

## The shape

`mr-cast article` checks this shape:

```markdown
# How quicksort sorts a list

## Takeaways

1. Quicksort picks one value, the pivot, and moves every smaller value to its left and every larger one to its right.
2. After that partition the pivot is in its final place, so only the two sides are left to sort.

## A partition puts the pivot in its final place {#partition}

Take the list [7, 2, 9, 4, 3] ...

## Each side is then sorted the same way {#recurse}

...

## Questions

1. After the first partition of [7, 2, 9, 4, 3] with 3 as the pivot, which values are left of 3?
   Answer: only 2.
   Takeaway: 1

## Left out

- How to choose the pivot, because the idea works for any pivot; it changes the speed, not the steps.
```

- Each teaching section is `## <its claim> {#id}`. The heading states the claim as a sentence, not a label: "A partition puts the pivot in its final place", not "Partition". The id is a short slug that stays when you reword the heading.
- When the run has a `plan.json`, each topic not at `skip` is one section whose id is the topic's id, in the plan's order. A `deep` topic gets its full explanation; a `brief` topic gets its claim, the key fact and its reason in a paragraph; a `skip` topic goes under Left out. You may add a section before the topics, such as the problem, and one after, such as the tests.
- **Questions**: 1 to 3 per takeaway, each with its `Answer:` and the `Takeaway:` it tests. Ask what a reader who got the takeaway can answer and one who did not cannot: the running example's state at a given point, why a step is needed, and at least one question on a new input ("what happens to [5, 1, 4]?"). Avoid questions anyone could answer without the article.
- **Left out**: what you excluded on purpose, and why. "- Nothing." when nothing was.

## How to write it

1. **The example before the rule.** Introduce the running example, trace it through each idea with its real values, then state the general rule, then say where the rule stops applying: "Any client past twenty in a minute is refused, but the count is per server, so two servers allow forty."
2. **Ideas in order, each with its reason.** Each section depends only on what came before. Connect steps with "because" and "so". Define each term the first time it is needed, in a few words.
3. **Problem first.** Open with what goes wrong, or what is missing, on the running example, then the one idea of the answer in a sentence, then the parts. For a change, show the old behaviour before the new on the same case, using only output you ran or read.
4. **Ask before you answer.** Pose at least one question to the reader before the text answers it, such as "So how does the limiter know a new minute has started?"
5. **Correct the likely wrong reading.** Name the one misconception the reader probably holds, say plainly why it fails on the running example, then give the right model. Once or twice an article, not more.
6. **Say what you leave out,** in the text where it would have come ("the logging changes are routine"), and in Left out.
7. **As short as the takeaways allow.** Cut history, anecdotes and side facts. For a reviewer or someone new to the code, completeness of the change matters more than brevity: when unsure whether a detail of the change belongs, include it. For the team's overview and for an explanation, cut it.

For the branch, follow a reviewer's questions in order, and let the sections answer them: why the change exists and the approach, then how each part works and whether it is correct and complete, main behaviour first, related hunks together, never file by file; then what else it could break (callers, data, a public API, two requests at once), and a caller that should have changed but did not; then which tests prove each behaviour and what no test covers. End on what is proven and what the reader should still check. In a pre-read, describe what the code does, not what the intent says it should do: where they differ, the article says so. For someone new, describe the code as it is today before the change, and name the terms first.

For an explanation, the article is your explanation, written out with its example traced. It is not a new investigation: open files again only to get facts right, such as exact values and names.

## Check it

```bash
{{MR_CAST}}/bin/mr-cast article <flags>
```

It fails on a missing part, a section without an id, a question without its answer or takeaway, and words about the medium, and warns about a heading that is a label and a section the plan expects. Fix what it names and run it again. It ends by printing the takeaways.
