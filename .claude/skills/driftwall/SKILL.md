---
name: driftwall
description: Use when a change adds, moves or removes modules, directories or cross-module dependencies, or when the user discusses architecture. Keeps the code and architecture.mmd in agreement.
---

architecture.mmd is the contract. Hooks load it at session start and run `driftwall lint` before
you can stop. This skill covers only the judgment calls.

1. **Triage.** If the change stays inside one node and adds no import across nodes, just
   implement it. `driftwall where <file>` names a file's node.
2. **Discuss in architecture terms.** Otherwise present the relevant nodes and edges from the
   diagram and agree the plan with the user by naming them. No code-level detail yet.
3. **Propose the contract change, then wait.** State the exact nodes and edges to add or remove
   and get the user's explicit approval before editing architecture.mmd. Use a dotted arrow
   for a dependency you are about to build.
4. **Implement.** Tag every new directory with a `.arch` file (`node: <id>`). Make solid any
   dotted edge your code now realises.
5. **When lint fails on an undeclared edge, do not edit the diagram to silence it.** Return to
   step 2 with the user.
