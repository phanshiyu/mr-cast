# Evidence on writing Claude Code skills, applied to the mr-cast skills

## Honesty about sourcing

Opened and read (full page text downloaded as Markdown or stripped HTML, then read in full or in the sections named):
- Anthropic, "Skill authoring best practices" (platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices). Read in full.
- Anthropic, "Agent Skills overview" (same docs tree). Read the loading-levels section and table only.
- Claude Code docs, "Skills" (code.claude.com/docs/en/skills). Read: types of skill content, frontmatter table, supporting files, who invokes a skill, skill content lifecycle, `context: fork`, troubleshooting (not triggering, triggers too often, stops following, descriptions cut short).
- Claude Code docs, "Subagents" (preloading skills section only) and "Hooks" guide plus reference (hooks in skills, exit code 2 behaviour for PostToolUse only).
- Anthropic engineering blog, "Equipping agents for the real world with Agent Skills" (Zhang, Lazuka, Murag). Full stripped text.
- Anthropic engineering blog, "Effective context engineering for AI agents". Stripped text; I read the passages on attention budget, right altitude, examples, just-in-time context, compaction and sub-agents, not every paragraph.
- Anthropic, "Prompting best practices" (the old be-clear-and-direct, multishot, XML tags and long-context URLs all redirect to this one page now). Read: general principles, long context prompting, format control, tool-use triggering. Also the "Prompting Claude Opus 4.8" section on literal instruction following and the "Prompting Claude Fable 5" section on instruction following.
- anthropics/skills, `skills/skill-creator/SKILL.md` (GitHub raw). Grepped, then read the passages on descriptions, writing style, iteration and description optimization.
- anthropics/claude-code, `plugins/plugin-dev/skills/skill-development/SKILL.md` (GitHub raw). Grepped for the style, size and duplication rules. A local copy of plugin-dev exists under `~/.claude/plugins/marketplaces/`; under this task's rules I did not read it and used the public copy instead.
- pstack 0.9.84 plugin cache: `principle-encode-lessons-in-structure`, `principle-build-the-lever`, `principle-guard-the-context-window`, `correct`, `poteto-help`, `poteto-mode` (the Principles index), and the playbooks `authoring-a-skill.md`, `eval.md`, `hillclimb.md`. I also measured every pstack SKILL.md's length.
- SkillsBench (Li et al., arXiv 2602.12670, HTML version). Grepped the findings and read Findings 3, 5 and 6 and Table 6.
- IFScale (Jaroslawicz et al., arXiv 2507.11538). Abstract plus the HTML sections on degradation patterns and primacy.
- Chroma, "Context Rot" (Hong, Troynikov, Huber 2025). Partial page text: the setup and the haystack-structure result.
- Our own repo: `skill/` (all files), `bin/lib/install-skill.mjs`, `bin/lib/validate-voice.mjs` (the bare-opener rule), `src/types.ts` doc comments, `quality/README.md`, `decisions.tsv`, `package.json`. I built the installed skill with `quality/variant.sh` into my scratchpad and measured it.

Abstract only (arXiv abstract page, no body text): Liu et al. 2023 "Lost in the Middle"; Levy et al. 2024 "Same Task, More Tokens"; Harada et al. 2025 "When Instructions Multiply" (ManyIFEval; the older "Curse of Instructions" title and the p^n figures came from search snippets only); Huang et al. 2024 "Large Language Models Cannot Self-Correct Reasoning Yet"; Gou et al. 2024 "CRITIC"; Cook et al. 2024 "TICK"; Viswanathan et al. 2025 "Checklists Are Better Than Reward Models"; Min et al. 2022 "Rethinking the Role of Demonstrations"; Shi et al. 2023 "Easily Distracted by Irrelevant Context"; Jang et al. 2022 "Negated Prompts"; Laban et al. 2025 "LLMs Get Lost in Multi-Turn Conversation".

From memory or snippets, flagged where used: the human checklist study (Gonçalves et al. 2022) comes from our own `quality/research/reviewing.md`, not from me. Token counts below are estimates at about 4 characters per token, not tokenizer output. The docs name current models (Fable 5, Opus 4.8 and others); I report what the pages say about them and did not test any model myself.

## Per-source findings

Format: claim; evidence strength; rule for our skills.

### 1. Anthropic: skill authoring best practices (opened)

- Size. "Keep SKILL.md body under 500 lines for optimal performance." Split into files when approaching it. The overview page gives the body budget as "Under 5k tokens" and metadata as about 100 tokens per skill. Evidence: vendor guidance from the model's maker, no published measurements. Rule: budget the installed body at 500 lines and about 5k tokens, whichever binds first. Our lines are long, so tokens bind.
- Conciseness. "The context window is a public good." "Claude is already very smart. Only add context Claude doesn't already have." Ask of each paragraph: "Does this paragraph justify its token cost?" Evidence: guidance plus a worked example (50 versus 150 tokens). Rule: delete sentences that tell Claude what any competent agent already does.
- Degrees of freedom. High freedom (text heuristics) when many approaches are valid; medium (templates or parameterized scripts) when a preferred pattern exists; low (exact scripts, "Do not modify the command") when operations are fragile or a sequence must hold. The "narrow bridge with cliffs" versus "open field" analogy. Evidence: guidance. Rule: exact commands and exact user-facing option labels are low freedom; how to teach a change is high freedom and gets principles plus examples, not if-else rules.
- Progressive disclosure. SKILL.md is "a table of contents"; detail lives in files read only when needed; organize by domain so irrelevant branches never load; "Keep references one level deep from SKILL.md" because Claude may preview nested files with `head -100`; reference files over 100 lines get a table of contents. Evidence: guidance plus a described failure mode (partial reads). Rule: every file the agent must read is linked from SKILL.md with the condition for reading it; no reference links on to another file that holds required content.
- Descriptions. Third person ("Processes Excel files"), what plus when, specific key terms, at most 1,024 characters on the API. Evidence: guidance; the third-person rule is justified by "inconsistent point-of-view can cause discovery problems". Rule: start with what the skill makes, then the phrases users type.
- Workflows, checklists and feedback loops. Complex tasks get numbered steps and, for very complex ones, a copyable checklist. "Run validator, fix errors, repeat. This pattern greatly improves output quality." "Plan-validate-execute": write an intermediate structured file, validate it with a script, then execute. Validation messages should be specific and name the alternatives ("Field 'signature_date' not found. Available fields: ..."). Evidence: guidance with examples; "greatly improves" is not quantified. Rule: every artifact the agent writes (plan.json, storyboard.json, a future article) gets a validator that names the fix.
- Scripts. "Prefer scripts for deterministic operations." Scripts run without loading into context; only their output costs tokens. Say whether to run a script or read it. Evidence: guidance plus the obvious token argument. Rule: anything deterministic (ordering options, exact reason strings, scaffolding scenes from plan picks) becomes CLI output, not prose.
- Evaluation-driven development. "Create evaluations BEFORE writing extensive documentation": run without the skill, document failures, build three scenarios, baseline, write minimal instructions, iterate. Claude A writes, Claude B uses, you observe B. Watch for skipped files and over-read files. Test with every model you ship to. Evidence: guidance. Rule: no skill change ships without a with/without (or old/new) run on the quality harness.
- Also: one term per concept; avoid time-sensitive text; give a default rather than many options.

### 2. Anthropic: Agent Skills engineering blog (opened)

- Claim: progressive disclosure is "the core design principle"; bundled context is "effectively unbounded" because the agent reads only what the task needs. "If certain contexts are mutually exclusive or rarely used together, keeping the paths separate will reduce the token usage." Code is better for deterministic work ("sorting a list via token generation is far more expensive"). Build skills by watching where agents struggle, and ask Claude to capture its successes and mistakes. Evidence: practitioner account from the team that built the feature, no numbers. Rule: split by mutually exclusive branch (our audiences and sources are exactly that).

### 3. Anthropic: context engineering blog (opened, key passages)

- Attention budget and context rot: "Every new token introduced depletes this budget by some amount." The "right altitude" sits between "brittle if-else hardcoded prompts" and vague guidance that "falsely assumes shared context". "Minimal does not necessarily mean short." Against "a laundry list of edge cases": "curate a set of diverse, canonical examples ... examples are the 'pictures' worth a thousand words." Just-in-time loading by lightweight identifiers (file paths). Sub-agents return 1,000 to 2,000 token summaries. Evidence: practitioner guidance citing needle-in-a-haystack studies. Rule: replace rule lists with a few canonical example storyboards the agent can open by path.

### 4. Claude Code skills, subagents and hooks docs (opened)

These are product facts, not opinions, and they bind us harder than any study.
- Lifecycle: an invoked skill's rendered content "stays in context across turns" and is not re-read. After auto-compaction, Claude Code "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each", with 25,000 tokens shared across skills. The troubleshooting page says to "put the most important instructions near the top of SKILL.md". Evidence: documented behaviour. Rule: the first 5,000 tokens of the installed file must hold the workflow skeleton, the validate loop, and where to re-read everything else.
- Conciseness: "every line is a recurring token cost. State what to do rather than narrating how or why." Also "Keep SKILL.md under 500 lines."
- Listing: description plus `when_to_use` is truncated at 1,536 characters; the whole listing has a budget of 1% of the context window, and when it overflows Claude Code drops descriptions of the least-invoked skills first. Every listed skill costs context on every turn. Rule: do not ship internal helper content as separately listed skills.
- `user-invocable: false` hides a skill from the `/` menu but its description stays in context; `disable-model-invocation: true` removes it from Claude's context entirely.
- "Claude stops following a skill": for "a rule that must hold every time", "move the rule into a hook"; skill frontmatter can define hooks that run for the rest of the session once the skill is invoked. A PostToolUse hook that exits 2 shows its stderr to Claude. For judgment guidance, phrase it as standing guidance ("after every edit"). Rule: run `mr-cast validate` from a PostToolUse hook on storyboard writes instead of hoping the agent remembers.
- `context: fork` runs the skill in a subagent that "doesn't see your conversation history". Subagents can preload full skill content with `skills:`. Rule: never fork a step that needs the conversation (the explanation source); a step whose inputs are on disk can be forked.
- Trigger testing: the troubleshooting page points to `claude plugin eval` with a `tool_used: Skill` grader to measure triggering across realistic prompts. I did not open that page.

### 5. Anthropic prompt engineering guidance (opened)

- Clear and direct: "a brilliant but new employee who lacks context on your norms"; numbered steps when order or completeness matters. Evidence: guidance.
- Explain why: "NEVER use ellipses" is less effective than giving the reason (text-to-speech); "Claude is smart enough to generalize from the explanation." Evidence: guidance with one example. Rule: a reason earns its tokens when it lets the agent handle cases the rule did not list.
- Examples: "one of the most reliable ways to steer Claude's output format, tone, and structure"; make them relevant, diverse, wrapped in `<example>` tags; 3 to 5 is best. Evidence: guidance, consistent with the few-shot literature.
- XML tags help separate instructions, context, examples and inputs; the context-engineering blog adds that exact formatting "is likely becoming less important".
- Positive instructions: "Tell Claude what to do instead of what not to do." Match prompt style to desired output style. Evidence: guidance.
- Long context: put long documents at the top and the query at the end; "Queries at the end can improve response quality by up to 30 percent in tests". Evidence: an internal test, number not published in detail.
- Over-prompting: newer models "may now overtrigger"; replace "CRITICAL: You MUST use this tool when..." with "Use this tool when...". The Opus 4.8 page: the model "interprets prompts literally", "does not silently generalize an instruction from one item to another", so state scope explicitly. The Fable 5 page: a brief instruction now steers "rather than enumerating each behavior by name". Evidence: vendor observation per model. Rule: one short general instruction with its scope beats a list of named cases, and no capitalized MUSTs.

### 6. anthropics/skills skill-creator and plugin-dev skill-development (opened)

- skill-creator: body "<500 lines ideal"; descriptions carry all "when to use" information; Claude "has a tendency to 'undertrigger' skills", so make descriptions "a little bit 'pushy'". "If you find yourself writing ALWAYS or NEVER in all caps ... that's a yellow flag"; "explain the **why**". "Keep the prompt lean. Remove things that aren't pulling their weight", judged from transcripts, not only outputs. If every test run wrote the same helper script, bundle it. Generalize from feedback rather than overfit the test cases. Its description optimizer uses 20 queries (8 to 10 should-trigger, the rest near-miss should-not-trigger), a 60/40 train/test split, and 3 runs per query. Evidence: Anthropic's own working practice, no published numbers.
- plugin-dev: body target 1,500 to 2,000 words (and "<5k words" as a ceiling); "Information should live in either SKILL.md or references files, not both"; imperative voice, not second person; descriptions in third person with quoted trigger phrases; for reference files over 10k words, give grep patterns in SKILL.md. Evidence: guidance.

### 7. pstack conventions (opened)

- Principle leaves are separate skills with `user-invocable: false` and descriptions that start "Apply when ..." (24 of them). Each leaf is short: Encode Lessons in Structure is 11 lines. `poteto-mode` holds the index: one line per principle, naming when it applies, and the instruction "Read the leaf skill in full for any principle you apply." The longest pstack SKILL.md is 201 lines.
- Encode Lessons in Structure: when you write the same instruction twice, "Encode the rule as a lint, metadata flag, runtime check, or script instead of more text." "If the fix is structural, only use the structural fix. The instruction is the symptom." `correct` orders the levels: architecture, then types, then "a lint or CI check whose error names the file, type, or function to use instead", then tests, and "docs or agent rules last, only for judgment calls. Nothing fails when an agent skips them." Build the Lever: prefer a rerunnable tool to hand work.
- authoring-a-skill playbook: "When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one." "Delegate to other skills by path. Don't restate."
- eval playbook: blind candidates (no "eval", "test" or "judge" in paths), organic prompts, a judge blind to which variant, verify from transcripts which files were read.
- Evidence: one practitioner's codified experience, coherent and widely used, unmeasured. Rule: put each lesson in validate or the CLI first, and keep prose for judgment.

### 8. Independent findings

- SkillsBench (opened, findings sections). 86 tasks, 11 domains, 7 agent-model setups, 7,308 trajectories. Curated skills raised pass rate by 16.2 points on average (from +4.5 in software engineering to +51.9 in healthcare), and 16 of 84 tasks got worse with skills. Self-generated skills gave no average benefit. By skill complexity: "detailed" +18.8 points (n=1,165), "compact" +17.1 (n=845), "standard" +10.1 (n=773), "comprehensive" -2.9 (n=140). Tasks with 2 to 3 skills gained +18.6, with 4 or more only +5.9. The authors read this as "focused procedural guidance is more effective than exhaustive documentation". Evidence: the only benchmark of agent skills I found, large, but stratified after the fact, so complexity is confounded with task; the comprehensive bucket is small. Rule: a focused skill plus a few on-demand leaves beats one exhaustive document.
- IFScale (abstract and sections). Up to 500 simultaneous keyword-inclusion instructions; best models reach about 68% at 500. Three decay shapes: threshold (reasoning models near-perfect to about 150 instructions), linear (the paper puts claude-sonnet-4 here), exponential. Later instructions are violated more often, with the primacy bias peaking at middle densities. Evidence: one benchmark, an artificial task far from ours. Rule: count our directives; each one dilutes the rest, and the ones placed late are the most at risk.
- ManyIFEval (abstract; p^n figures from snippets only). Performance "consistently degrades as the number of instructions increases"; a logistic model on instruction count alone predicts it within about 10%. Evidence: two benchmarks, ten models. Rule: same as above.
- Lost in the Middle (abstract). Retrieval accuracy is highest when the relevant text is at the beginning or end and "significantly degrades" in the middle, even for long-context models. Evidence: strong and replicated for retrieval; it tested documents, not instructions. Same Task, More Tokens (abstract): reasoning degrades "at much shorter input lengths than their technical maximum". Chroma Context Rot (partial): across 18 models, performance "consistently degrades with increasing input length", with distractors making it worse. Shi et al. (abstract): irrelevant context "dramatically" lowers accuracy. Evidence: consistent across groups, but none tested agent skills. Rule: keep the rules the agent needs at writing time out of the middle of a long file, and keep irrelevant branches (other audiences, other sources) out of context.
- Checklists. TICK (abstract): LLM-made yes/no checklists raised agreement with human judgments (46.4% to 52.2%) and improved generation through self-refinement. RLCF (abstract): checklist feedback, scored by AI judges and verifier programs, was the only method to improve all five instruction-following benchmarks. Human reviewers: our reviewing.md reports Gonçalves et al. 2022 found checklists helped reviewers (from that file, not verified by me). Evidence: moderate; these test checklists as evaluation or training signal, not as the format of an instruction file. Rule: a short yes/no self-check before validate helps for judgment items; checkable items belong in validate.
- External feedback over self-review. Huang et al. (abstract): without external feedback, LLMs "struggle to self-correct ... and at times, their performance even degrades". CRITIC (abstract): tool-based checking "consistently enhances" output and highlights "the crucial importance of external feedback". Evidence: strong and widely replicated for reasoning tasks. Rule: a validator that runs is worth more than a paragraph asking the agent to check its work.
- Examples versus rules. Min et al. (abstract): demonstrations work mostly through label space, input distribution and "the overall format of the sequence"; correct labels matter little. Evidence: strong for classification with older models. Read for us: examples transfer format and shape very reliably, which is both their power and the copying risk. Rule: use examples for the shape of a good storyboard and narration, show several that differ, and keep correctness in validate.
- Negative instructions. Jang et al. (abstract): models of 2022 did worse on negated prompts as they scaled. Evidence: weak for current models; old models, synthetic tasks. Anthropic's current advice says the same thing on other grounds. Rule: state the wanted behaviour and name the alternative; keep "never" for real hazards.

### 9. Our own evidence (decisions.tsv, opened)

- Row 33: a variant that was 10% shorter, with 27% less highlighted code and 25% fewer scenes, scored 34.5/40 against 35.5/40 and was promoted; the row notes "instrument has ceiling". Row 35: that eval "rewarded omission" until coverage questions were added. Rows on focus limits and the diagram-first rule: limits were made validator errors "so the agent must comply", and "trial agent produced code-heavy late-diagram walkthrough; validator now catches it". Evidence: small n, one harness, but our own task. Rule: our harness can detect length changes that cost accuracy only if its questions cover completeness; validator rules are what changed behaviour.

## Where evidence conflicts or is thin

- Explain why, or just say what. Anthropic's prompting guide and skill-creator say explain the reason so the model generalizes. The Claude Code skills page says "State what to do rather than narrating how or why", and pstack says "Tell it to do the thing and skip the reason." These agree once you separate two cases: a reason that changes how the rule applies to unlisted cases earns one clause (the text-to-speech example); a reason that only justifies the rule to a human reader is cost. Our skill has both kinds.
- Pushy or calm descriptions. skill-creator says Claude undertriggers, so be a little pushy. The prompting guide says newer models overtrigger on aggressive language. Both are Anthropic, from different model generations. Resolve by measurement on the model in use: a should-trigger and should-not-trigger query set.
- Third person versus imperative. The best-practices page wants third person descriptions ("Processes ...") but its examples start "Extract ...", and plugin-dev wants "This skill should be used when ...". The body: plugin-dev says imperative, not second person; our skill uses "you" throughout, as do Anthropic's own prompting examples. Low stakes; pick one and be consistent.
- Size limits use different units: 500 lines, under 5k tokens, 1,500 to 2,000 words. With our average line of about 26 words, 500 lines would be about 13,000 words. The token budget and the 5,000-token compaction cut are the ones that bind us.
- Long-context studies (Lost in the Middle, Context Rot, IFScale) measure retrieval or keyword inclusion, not following a procedural skill to write structured JSON. They point the same way but the transfer is an inference.
- SkillsBench's complexity effect is observational and its "comprehensive" bucket is 140 trajectories. It supports "focused beats exhaustive" but not a precise size.
- Examples: strong steering, real risk of copying. No source tells us how many example storyboards to show before the agent starts cloning one.
- Our product decision (decisions.tsv row 37) says "important details over conciseness". That is about the video's content. It is not evidence for a long skill; a short skill can demand complete coverage, and validate already enforces coverage.
- No source tested article-first conversion or a picker index for structured output. Both proposals below are inferences from plan-validate-execute and progressive disclosure, to be tested on our harness.

## Ranked rules for writing our skills

Ranked by evidence strength times how much they apply to a skill whose job is producing JSON that passes `mr-cast validate`.

1. Enforce in validate or the CLI, not in prose. A rule that can be checked is a check whose message names the fix; the skill then says only that validate checks it. Prose is for judgment. (CRITIC and Huang on external feedback; Anthropic feedback loops; pstack Encode Lessons and `correct`; our rows on validator limits.)
2. Keep the installed SKILL.md body near 5k tokens and under 500 lines, measured after install-skill fills the placeholders, and fail a test when it grows past that. (Anthropic overview and best practices; Claude Code docs; SkillsBench; IFScale and ManyIFEval on instruction count.)
3. Put what must survive compaction in the first 5,000 tokens: the step list, the validate loop, and which reference to re-read for each step. (Claude Code lifecycle docs; primacy in IFScale; Lost in the Middle.)
4. Load by branch. One reference per mutually exclusive branch (source, audience, quick mode, review, each scene type), each read only when that branch is taken, all linked directly from SKILL.md with the condition. (Best practices, blog, plugin-dev.)
5. One rule, one place. Never restate across SKILL.md, references, `src/types.ts` doc comments and validate messages. A rule written twice is a candidate for rule 1. (plugin-dev on duplication; pstack Encode Lessons; consistent terminology.)
6. Show canonical examples by path instead of listing edge cases: point to the example storyboards we already ship, several of them, labelled as illustrations. Keep the before/after narration pairs. (Context engineering blog; prompting guide; Min et al.)
7. Match freedom to fragility. Exact commands, flags, file names and user-facing option text are low freedom and should come from CLI output where possible. Teaching and narration are high freedom: a few principles with one reason each, plus examples. (Best practices; "right altitude".)
8. Write each instruction once, positively, with its scope, in normal language: what to do and the alternative, no capitalized MUST or NEVER, "on every scene" when it applies to every scene. (Prompting guide; Opus 4.8 literalism; skill-creator.)
9. Descriptions: the key use case first, the phrases users type, a "not for" clause against neighbours, in one consistent voice; test triggering with a should and should-not query set on the models users run. Do not ship internal helper content as listed skills. (Best practices; Claude Code listing budget; skill-creator optimizer.)
10. Every skill change is an experiment: old skill versus new on the quality harness, blind, with completeness questions, reading transcripts for what the agent opened. (Evaluation-driven development; pstack eval and hillclimb; our row 35.)
11. Use a hook for what must hold every time: a skill-frontmatter PostToolUse hook that runs validate after each write to a storyboard. (Claude Code hooks and troubleshooting.)
12. Give each intermediate artifact (plan.json, storyboard.json, a future article) its own validator before the next step consumes it. (Plan-validate-execute.)
13. Keep a short yes/no self-check, under about seven items, for the judgment calls validate cannot make, placed right before the validate step. (TICK, RLCF, best-practices checklists.)

## Audit of the current skills (main at 491a3d5)

Line numbers refer to `skill/mr-cast/SKILL.md` unless another file is named.

### Length

- The template is 400 lines and 10,455 words. The installed file, after `{{STORYBOARD_TYPES}}` and `{{PLAN_VIEWS}}` are filled, is 1,297 lines, 17,180 words and 99,271 characters, about 25k tokens. That is about 2.6 times the 500-line guidance, about 5 times the 5k-token body budget, and 8 to 11 times plugin-dev's word target. The references add 2,705 words when read.
- The installed file splits into about 22k characters before the schema (steps 1 to 4), 39k of schema (installed lines 233 to 1116, 883 lines), and 38k after it (all the writing rules, modes and steps 6 and 7).
- Lines are long: line 280 is 1,955 characters, line 356 is 1,405, line 267 is 1,039. The line count understates the cost.
- By section (words): Shared rules 3,065 (lines 250 to 290), Pre-read mode 1,007 (345 to 361), Teach the change 774, Pick the mode 733, Ask what the video is for 731, How the voice talks 703, Quick mode 592, Show it 567.
- About 560 sentences, at least 206 starting with an imperative verb. That is IFScale territory, where the paper reports linear decay for a Sonnet model.
- Compaction: the 5,000 tokens Claude Code keeps after compaction (about 20,000 characters) end near line 214, the start of step 5. A long full run that compacts keeps the questions and plan steps and loses the schema, Teach the change, Shared rules, the voice rules, every audience mode, and steps 6 and 7. This is the most important structural fact in the audit.
- The schema sits between the workflow and the writing rules, the middle position that long-context studies say is used worst, and pushes the writing rules to the end of a 25k-token message.

Change: target an installed body of about 250 lines and 5k tokens holding the mode table, the step list, the commands, the validate loop, the scene index and the pointers. Add a test beside `test/install-skill.test.mjs` that fails when the installed SKILL.md passes a character budget, so the budget is structural (rule 1 applied to rule 2).

### What to move into references, examples or the CLI

- Schema (line 218, `{{STORYBOARD_TYPES}}`; `bin/lib/install-skill.mjs` line 99). Move out of the body. Two options: `references/schema.md` with a contents list at the top, or better a CLI command such as `mr-cast schema <scene type>` that prints the type for one scene, so the agent loads only the types it uses and the output cannot drift from `src/types.ts`. Validate already reports schema errors, so the agent needs the type when writing a scene, not up front.
- Scene catalog (lines 263 to 286, most of Shared rules' 3,065 words) and the focus-ref grammar (line 280, every scene type's refs in one sentence). This is the primitive picker. Replace it with an index table in SKILL.md (what the story is, the scene, the leaf file) and one leaf per scene type under `references/scenes/`. Generate the leaves from `src/types.ts` doc comments at install time, as the schema is today, so each leaf has that type's shape, limits and focus refs from the source of truth.
- Audience modes: Simple (318 to 335), Overview (336 to 344), Pre-read (345 to 361). Only one applies per run. Move each to `references/audience-new.md`, `audience-overview.md`, `audience-preread.md`, and read the one matching `--audience`. Keep the four one-line audience bullets at 244 to 247 as the index.
- Quick mode (52 to 93). A separate path that asks nothing and never reaches steps 2 to 7. Move it to `references/quick.md`; SKILL.md keeps the trigger row and one pointer.
- The question scripts (95 to 135, 731 words) are deterministic: which questions to skip, the recommended or "(Last time)" option first (line 105), "Slower" first for a new reader (121). Have `mr-cast status --json` print the ready AskUserQuestion payload with the ordering applied. The skill then says "ask the questions `status` prints".
- Scenes from plan picks (203 to 208) are a mapping: a `brief` topic gets one view scene plus one code scene and its other hunks go in `skipped` with an exact reason string. Strings the agent must type verbatim (206 and `references/branch.md` line 33: "the viewer chose a brief look at this topic"; 205: "the viewer chose to skip this topic"; `branch.md` 53: "covered by the diagrams in this overview", "the tests scene covers them") should be written by a command, for example a `mr-cast scaffold` that writes the topic, plan entries and skipped entries from `plan.json`, leaving the agent to fill narration and focus.
- User-facing messages (87, 390, voice timing at 386): `play` and `render` can print the exact sentence to give the user, as `plan` already prints its URL.
- Examples: `package.json` ships `examples/demo`, `demo-simple`, `people`, `preread` and `review` storyboards (8.5k to 14k characters each), but no skill file mentions them. Point to one per audience from the relevant reference, as illustrations to copy the shape of, not the content.

### Duplicated rules

- Pre-read rules appear at line 208, at 345 to 360, and again in `references/branch.md` line 51 ("Draw what the code does", "names every change a user or caller would notice", brief and skip topics' hunks stay in the reading order) and `references/explanation.md` line 34. Keep them in the pre-read reference only.
- The brief-topic skip exception: line 206 and `branch.md` line 33.
- "just make it", "use the defaults", "no questions": lines 101, 184 and 376.
- Top-down order: lines 209, 244 and 255, plus `branch.md` lines 35 and 43.
- Audience trigger words: lines 24, 99, 114 and 320.
- Limits restated from `src/types.ts` doc comments: table 10 rows and 6 columns (273; types.ts 505 to 507), array 16 values (278; 706), memory 4 frames and 6 objects (279; 756 to 758), timeline 8 events and 4 spans (275; 577 to 579), layers 5 items (267; 600), badge 14 characters (261; 70), pen note 40 characters (286; 121). Since the schema is in the same file, each limit is loaded twice.
- What validate checks is narrated in about 19 clauses ("`validate` warns ...", "`validate` rejects ...", for example 211, 259, 287, 288, 314, 349, 353, 356, 357, 360, and `review.md` line 60). Line 314 restates the voice rules of 296 to 299 as validator behaviour.

Change: one home per rule. Where the rule is enforced, the skill keeps at most a pointer ("validate checks scene limits and fit; fix what it names").

### Contradictory or inconsistent rules

- Line 252 says "When you are unsure whether a detail belongs, include it." Line 316 sets 15 to 50 words per scene, 343 aims overview under 3 minutes, and quick mode caps at 3 scenes and about 60 seconds (54, 79). Scope 252 to the reviewer and new-reader audiences, where coverage is the goal.
- Line 356 says a pre-read must "End on a `reading` scene". `references/explanation.md` line 34 says the reading scene "is optional for an explanation". State the scope at 356, or keep the rule only in the audience reference with both cases.
- Line 297 says open every scene "never with a bare 'It', 'This' or 'That'"; line 326's model narration opens "This is the rate limit function. It runs ...". The validator's rule (`bin/lib/validate-voice.mjs` line 87) allows "This is the" and flags "This runs". The code is more precise than the prose. Replace the prose with "validate flags a scene that opens on a bare pronoun", which also removes the apparent conflict.
- Table row 1 (line 23) makes "save" a full-mode MP4, while line 17 and line 93 make "save it" after a quick video render the quick run. Precedence is right because line 17 comes first, but it depends on reading order. Put the follow-up case in the table as row 0.
- Line 54 says quick mode "needs no reference file", but it needs Shared rules and the voice rules (73). After the split, quick mode will need the scene leaves it uses; say so.

### Rules better enforced by validate

Already enforced, so the prose can shrink to a pointer (I confirmed these by grepping `bin/lib/validate*.mjs`, not by running every case): steps per scene, state count, sequence participants, words per scene, mermaid scenes, badge words (validate-marks), the bare-opener rule (validate-voice), scene order and diagram count (per `branch.md` line 35), focus range limits (decisions.tsv: made errors), fit (287), markup (288), the pre-read `from` labels (353), reading-item lines and numbers (356, 357).

Candidates to add to validate, each checkable: a `terminal` with more than 3 entries has `steps` (277); a `sequence` with more than about 12 messages has steps and past 24 is split (269); edges leaving a `decision` node carry labels (265); no pasted code in narration fields (281); a spoken total matches the numbers on screen (352; validate-counts already does counts); a mermaid scene has been rendered with `still` (272). Check the validator source before deleting each sentence; some may already exist.

Left for judgment, and so for the short self-check: one concrete case runs through the video (233), problem then approach before any diagram (234), old behaviour shown before new (235), each code scene opens with its question (236), the rule and its limit after the example (237), at most one or two named misreadings (238), the close ties back to the intent's concerns (240).

### How the descriptions trigger

- `mr-cast` (line 3, 721 characters, under the 1,536 cap). Strengths: the key use case comes first; it carries the phrases users type ("animate that", "make a video of this", "/mr-cast quick"); it ends with a "not for" clause that keeps it away from plain explanations and code review, which matters because pstack's `how`, `teach` and the built-in code-review skill compete for the same words. Weaknesses: imperative voice ("Make a narrated ...") against the third-person advice, and "your review" in second person. Change "Make" to "Makes" and "your review" to "a review", then run a 20-query trigger set (should-trigger phrasings, and near misses such as "explain this flow", "review this PR", "draw a diagram in the docs") before and after any edit. With the article-first flow, the description needs no change unless users will type new words for it.
- `mr-cast-prune` (318 characters) and `mr-cast-upgrade` (278) are specific and fine. Upgrade runs `npm install -g`, a side effect; it asks first (upgrade line 22) and the main skill says not to upgrade unless asked (line 13), so model invocation can stay on.
- The primitive picker must not become 15 listed skills. Every listed description costs context on every turn in every session, the listing budget is 1% of the window and drops the least-used descriptions first, and `user-invocable: false` does not remove a description from context. pstack's principles are separate skills because they apply across all work; our scene types only matter inside an mr-cast run. Make them reference files under `skill/mr-cast/references/scenes/`, indexed from SKILL.md. If a separate picker skill is wanted anyway, give it one "Apply when writing an mr-cast storyboard scene" description and keep the leaves as its files.

### How references are loaded

- Good today: step 3 (lines 139 to 144) says "Read the reference for the source, and only that one", with review as a conditional extra. That is the recommended pattern: one level deep, conditional, explicit. The references are 40 to 60 lines, so no contents list is needed.
- The references link back into SKILL.md anchors (`branch.md` lines 40 and 51, `explanation.md` 36, `review.md` 48). Fine while those sections stay in SKILL.md. When Teach the change, the voice rules or the audience modes move to references, these become reference-to-reference links, which the best-practices page warns are read partially. Link every required file from SKILL.md with its condition, and let references name each other only for orientation.
- Everything else (audiences, scene types, quick mode, schema) is loaded for every run whether or not it applies.
- Re-reading after compaction is not addressed anywhere. Add one line near the top: after a compaction, read the step's reference again before editing `storyboard.json`.
- No hook. Add to the frontmatter a PostToolUse hook on Write and Edit that runs `mr-cast validate` when the path is a `.mr-cast/*/storyboard.json` and exits 2 with the errors, so the validate loop survives compaction and inattention. The hook needs the current flags; it can read the audience from the run (validate already warns when a storyboard looks like a pre-read without the flag), or the run can store them.

### mr-cast-prune and mr-cast-upgrade

Both follow the rules already: short (62 and 32 lines), low freedom, exact commands, and the dangerous rule ("Never delete anything the user did not pick", prune line 8) is also enforced by the CLI, which rejects unknown or busy ids and then deletes nothing (prune line 60). No change needed beyond keeping them this way.

### The two coming pieces

- Article-first flow. Treat the article as a verifiable intermediate output, like `plan.json`: a file in the run directory with fixed sections that map onto the storyboard (the concrete case, the approach in one sentence, one section per topic with its behaviour and the code that carries it, what to check). Give it a check before conversion, for example a validate warning when a topic has no article section or a storyboard narration cites nothing from its section. If the article is written in the main conversation, convert there; a `context: fork` subagent would not see the conversation. Once the article is on disk, conversion could run in a subagent preloaded with only the scene leaves it needs, which keeps the long article-writing context out of the JSON-writing context. No source tested this flow; run it against the current flow on the harness before adopting it.
- Primitive picker. SKILL.md holds one table of about 15 rows: "the story is parts and links: `graph`, read `references/scenes/graph.md`". Each leaf, in pstack's short style, has an "Apply when" line, the type excerpt, limits and focus refs (generated from `src/types.ts`), one canonical JSON example, and the two or three validate errors agents hit most on that type, with their fixes. No leaf restates what validate checks. The agent reads only the leaves for the scenes it writes, which is the "2 to 3 focused modules" shape SkillsBench found best.

### Top changes, in order

1. Move the schema out of the body into per-type output (`mr-cast schema <type>` or generated leaves). Saves about 9.7k tokens per run.
2. Split audiences, quick mode and the scene catalog into conditionally read references, with the scene index in SKILL.md. Brings the body near the 5k-token budget and puts the writing rules inside the part that survives compaction.
3. Delete prose that restates validate or `src/types.ts`; add the checkable candidates to validate.
4. Add the PostToolUse validate hook in the skill frontmatter, and one line on re-reading after compaction.
5. Move deterministic work into the CLI: question payloads from `status`, a scaffold from plan picks with the exact skip reasons, user-facing messages from `play` and `render`.
6. Point each audience reference at its shipped example storyboard.
7. Fix the four inconsistencies above.
8. Add a size test for the installed SKILL.md and a trigger query set, and run every change old-versus-new on the quality harness with completeness questions.
