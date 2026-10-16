# Evidence on teaching a concept, applied to a narrated code-diff explainer video

## Honesty about sourcing

Opened and read (full text or full page fetched):
- Bacchelli & Bird 2013, ICSE, "Expectations, Outcomes, and Challenges of Modern Code Review" (full PDF text).
- Fyfe & Nathan 2018, "Making Concreteness Fading More Concrete" (full text; this is NOT the 2014 Fyfe, McNeil, Son, Goldstone review, which I could only see in search snippets).
- Willingham 2004, American Educator, "The Privileged Status of Story" (full page, via fetch summary).
- Wikipedia "Expertise reversal effect" (secondary; used for the reference list and summary only).

Seen only in search snippets or secondary summaries (not opened): Mayer chapters and the effect-size tables, Dunlosky et al. 2013 (fetch of the PDF failed; utility ratings below come from my memory plus snippets and are marked), Kalyuga et al. 2003, Sweller and Cooper 1985, Renkl and Atkinson 2003, Atkinson et al. 2003, Schwartz & Bransford 1998, Sinha & Kapur 2021, Luiten et al. 1980, Ginns et al. 2013, Gentner et al. 2003, refutation-text meta-analyses, Brooks 1983, Letovsky 1986, Pennington 1987. Merrill, Ausubel, Storey, Feynman, and Brown/Wiliam were not verified at all in this session; claims about them are from background knowledge and flagged. Effect sizes quoted are as reported in snippets and should be checked before being cited externally. Note that two snippet sources gave conflicting Mayer medians for segmenting, pre-training and modality (handbook chapter: 0.79, 0.75, 0.76; a secondary 12-principles review: 0.70, 0.46, 0.72).

## Per-source findings

Format: claim; evidence strength; rule for a 2-10 minute narrated diff video.

1. Mayer multimedia principles (Cambridge Handbook of Multimedia Learning; Multimedia Learning 3rd ed. 2020; snippets only).
 - Pre-training: learners do better when they first learn names and characteristics of key components. Evidence: many experiments, median d about 0.5-0.75 (13 of 16 supportive per handbook snippet). Rule: before the walk-through, name the 3-5 key terms/types/functions in plain words ("the Cache, the Invalidator, the Reader").
 - Segmenting: learner-paced, bite-size segments beat one continuous stream. 10 of 10 experiments, median d about 0.7-0.8. Rule: one idea per scene, short scenes (15-45 s), explicit scene titles, pauses/chapter markers.
 - Signaling: cues that highlight organization and key items help. Multiple experiments, d about 0.46. Rule: highlight exactly the lines being narrated, show a persistent "where are we" outline, narrate verbal signposts ("first, the problem; second, the fix").
 - Coherence: cut interesting but irrelevant material. Multiple experiments, d about 0.7. Rule: drop unrelated files, formatting-only hunks, and tangents; mention them in one line at most.
 - Modality: graphics plus narration beat graphics plus on-screen text. 53 of 61 tests, d about 0.7. Rule: narrate; do not also put the same sentences on screen (redundancy principle, d about 0.87 per snippet). Keep on-screen text to labels and the code itself.
 - Personalization: conversational style ("you", "we") helps. Meta-analysis (Ginns, Martin, Marsh 2013): retention d=0.30, transfer d=0.54, but small and non-significant in studies longer than 35 min; one Czech replication found nothing. Rule: speak conversationally, address the reviewer directly, no stiff passive prose.
 - Caveat: most of this base is short lab lessons with novices, often scientific mechanisms, not code or experts.

2. Cognitive load theory and worked examples (Sweller; Renkl; snippets only).
 - Claim: novices learn more from studying worked solutions than from solving the problem themselves, because problem search consumes working memory (worked-example effect, Sweller & Cooper 1985). Evidence: dozens of experiments, a robust effect, mostly well-structured domains (algebra, programming, geometry).
 - Renkl & Atkinson: fading (removing solution steps gradually, backward fading) and self-explanation prompts improve near transfer; far transfer needed principle-identification prompts (Atkinson et al. 2003, per snippet). Multiple experiments.
 - Rule: show the change as a worked example: state the goal, walk each step with the reason ("why this line"), not just "what". Present one idea at a time. Where the reviewer must decide something, pause and ask them the question before giving the answer (a prompt, section 7).

3. Ausubel advance organizers (Luiten, Ames, Ackerson 1980 meta-analysis; snippet only, effect size not seen).
 - Claim: a short upfront framework that links new material to existing knowledge improves learning and retention. Evidence: meta-analysis with generally positive but small effects; earlier vote-counting reviews were skeptical, so mixed. Rule: open with a 20-second map: "this diff touches three modules; the story is A calls B, which now consults C." Use the architecture neighbourhood the reviewer already knows. Keep it short and concrete; abstract organizers are weakest.

4. Merrill First Principles of Instruction (not opened; background knowledge).
 - Claim: learning is promoted when instruction is problem-centered, activates prior knowledge, demonstrates, has learners apply, and integrates into real work. Evidence: a synthesis of instructional design theories, some supporting studies; it is a framework, not a tested causal theory. Rule: structure as problem, prior knowledge, demonstration, then give the reviewer an application step (what to check, a concrete failing input) and an integration note (where it fits in the system). Use as a checklist, not as proof.

5. Concreteness fading (Fyfe, McNeil, Son, Goldstone 2014, Educ Psych Rev; I read Fyfe & Nathan 2018, which describes it).
 - Claim: start with a concrete instance, move to an idealized/iconic one, then to the abstract form, with explicit links between the stages, to promote transfer. Evidence: several experiments (math, science; Goldstone & Son 2005, McNeil & Fyfe 2012 and others) but Fyfe & Nathan state it is "underspecified" with few design principles and needs more real-world evidence. So: several RCT-like lab studies plus theory. Also from that text: perceptually rich materials alone can hinder learning (seductive-details link).
 - Rule: show a single concrete input and its trace through the old code and new code, then generalize to the rule or invariant ("so for any key X, ..."), then show the abstract code shape. Do not stay at literal values, and do not open with the abstraction. Strip decorative detail from the concrete example.

6. Examples before rules, contrasting cases (Schwartz & Bransford 1998; snippets only).
 - Claim: analyzing contrasting cases before a lecture leads to better differentiated understanding and better prediction on transfer than summarizing the text first. Evidence: a few classroom experiments, replicated in later work by Schwartz and colleagues (the 2011 "practicing versus inventing" paper appeared in the results), but with students and designed cases. Gentner et al. 2003 (JEP, snippet): comparing two cases beats studying them separately, with novices in negotiation (several experiments).
 - Rule: show before/after behaviour as a contrast pair (same input, two outputs) before explaining the code. When the change handles several cases, compare two cases side by side and name what differs. The lecture ("telling") then lands on prepared ground. Note the boundary: this works when learners have enough base knowledge to see the features; pure novices may need pre-training.

7. Predict-observe-explain, retrieval, elaborative interrogation (Dunlosky et al. 2013, PSPI; fetch failed, details from memory and snippets).
 - Claim: practice testing and distributed practice received high utility; elaborative interrogation and self-explanation moderate utility (my recollection, snippet did not confirm: verify in Table 2); summarization, highlighting, rereading low. Evidence: a review of many studies per technique, mostly with students and fact-like material. Predict-observe-explain is a science-education technique with weaker evidence I did not verify.
 - Rule: insert one explicit prediction pause in the video ("Before I show the fix: what do you expect happens when the cache is empty?"), then reveal. Ask "why" questions in narration ("why must this run before the lock?"). End with 2-3 recall questions the reviewer can answer, rather than restating the summary. Video is passive, so these prompts must be few and cheap.

8. Expertise reversal (Kalyuga, Ayres, Chandler, Sweller 2003; Educ Psychologist 38:23-31; confirmed via snippet and Wikipedia summary).
 - Claim: guidance that helps novices can be redundant or harmful for experts. Evidence: many experiments across worked examples, split attention, segmentation; effect often measured with subjective load, which is contested. Spanjers 2011 found segmentation helped low-knowledge but not high-knowledge learners. Adaptive fading beat fixed fading (Salden et al. 2008, via Wikipedia).
 - Rule: the reviewer is a developer who may own the files or may never have seen them. Bacchelli & Bird found file owners skip the description and go straight to code; non-owners need "what changed and why." So: make the video skippable by chapter, put a one-sentence "if you know X, jump to scene 3" at the start, keep the glossary scene short and optional, and do not explain language basics. Default to assuming a competent developer unfamiliar with this module.

9. Analogies and structure mapping (Gentner; snippets only).
 - Claim: analogies help when the mapping between relational structure is explicit; comparing analogous cases drives schema abstraction (Gentner et al. 2003). Evidence: strong experimental base in psychology, with the caveat that surface-similar analogies mislead. Rule: use an analogy only if it maps the structure exactly (e.g. "like a lock on a shared file"), say where it breaks, and prefer a codebase-internal analogy ("same shape as the retry in Foo") over an everyday metaphor.

10. Misconception-targeted refutation text (snippets only; Guzzetti et al. 1993 meta-analysis cited by later work; a 2021 meta-analysis of 44 comparisons reported g=0.41; a broader meta-analysis of 71 articles found a consistent advantage).
 - Claim: text that states the common wrong belief, flags it wrong, and then gives the correct explanation corrects misconceptions better than neutral text. Evidence: meta-analyses, mostly science-concept text. Rule: where the diff fixes a plausible-but-wrong assumption in the old code or a reviewer's likely wrong reading ("you might think this is a race in the cache; it is not, because the lock is held"), state the tempting wrong model, say why it fails, then the right one. Use sparingly for the 1-2 real traps.

11. Productive failure (Kapur; Sinha & Kapur 2021 Review of Educational Research meta-analysis of 53 studies/166 comparisons; only press summaries seen).
 - Claim: attempting a hard problem before instruction beats instruction first, for conceptual understanding and transfer, when learners have enough prior knowledge. Evidence: meta-analysis, mostly secondary-school math/science with human classrooms; press said "two to three times" which I could not verify. Conflicts with worked-example effect for novices (section on conflicts). Rule: for a video you cannot let the viewer struggle for long; use a light version: pose the problem and a 5-10 second pause ("how would you make this idempotent?") before showing the solution. Do not rely on it as the main method.

12. Program comprehension for code reading (Brooks 1983; Letovsky 1986; Pennington 1987; Storey; snippets only).
 - Brooks: comprehension is top-down hypothesis generation and verification, with "beacons" (recognizable code fragments) confirming hypotheses. Pennington: experts form program-level (control flow) models before function-level (domain) models, in experiments with short programs. Letovsky: programmers are opportunistic and ask why/how/what questions of the code (this description is from a secondary source; verify). Storey: not verified. Evidence: observational and small lab studies with older code, mostly theory-building. Rule: state the hypothesis first ("this diff replaces polling with a subscription"), then show the code that confirms it, pointing at beacons (the new function name, the removed loop). Cover control flow (what calls what, in what order) before domain semantics, but connect both. Answer the reviewer's likely why/what/how questions explicitly.
 - Bacchelli & Bird 2013 (opened, mixed-methods at Microsoft: surveys of 165 managers and 873 programmers, 17 interviews, 570 classified comments): understanding the change and its context is "the key aspect" of review and tools support it poorly; 91% said unfamiliar files take longer; 82% said familiar reviewers give deeper feedback; a good description states "what was changed and why"; reviewers often ask the author in person for high-level details. Rule: the video should deliver the missing context and rationale, not paraphrase the diff line by line; it should answer "what changed and why" first.

13. Feynman / explain-to-a-novice (not verified; folk technique plus related research on self-explanation and the protege effect). Evidence: weak as stated, theory and anecdote; related self-explanation has moderate support. Rule: write the script, then check that each scene can be said in one plain sentence; if not, the agent does not yet understand it. Avoid jargon the reviewer would not use.

14. Narrative (Willingham 2004, opened).
 - Claim: stories are "psychologically privileged": easier to understand and remember than expository text. Evidence cited: Graesser et al. 1994 (narrativity had the largest effect on reading time; about 50% more recall from stories), Britton et al. 1983, Bartlett 1932; reviewer synthesis, correlational plus lab experiments, mostly with prose rather than technical content. Four Cs: causality, conflict, complications, character.
 - Rule: frame the diff as a short causal story: a goal, an obstacle (the bug or limit), a complication (the first obvious fix fails, a constraint), and the resolution. Link every step with "because" and "so", not "and then". The "character" is the system or a request, acted on with concrete data. Do not pad with drama. The Brown/Wiliam "storytelling" item was not found or verified; I treat it as covered by Willingham.

## Where evidence conflicts or is thin

- Novices vs experts: worked examples and heavy guidance (CLT, Mayer) help novices; expertise reversal (Kalyuga) says the same guidance burdens experts. Productive failure and contrasting-cases-first (Schwartz, Kapur) put exploration before telling, which clashes with "demonstrate first" for true novices. Resolution used here: reviewers are mid-to-expert in the language and often novice in this module, so give context compactly, make it skippable, and use only brief predict-pauses.
- Mayer's effect sizes vary by source (see above); they come from short lab lessons, not 10-minute videos about code. Personalization effects shrink in longer sessions.
- Advance organizer evidence is mixed. Merrill's principles are a framework, not a tested package.
- Analogy can mislead when surface similarity dominates.
- No source tested a narrated explainer of a diff. Everything here is transfer from adjacent domains; Bacchelli & Bird is the only directly relevant one and it is descriptive, not experimental.

## Teaching arc (storyboard order)

1. Hook and problem (10-20 s): one concrete failing case or user-visible symptom, stated in a sentence, before any code. (Narrative, Merrill, concreteness fading step 1, Bacchelli: why.)
2. Map and promise (15-25 s): a one-picture overview of what the change touches, a one-sentence statement of the fix, and "skip to scene N if you know this module." (Advance organizer, signaling, expertise reversal.)
3. Key terms (optional, 15-30 s): name the 3-5 concepts the rest uses. (Pre-training.)
4. Old behavior traced on the concrete case (30-60 s): show where it goes wrong, state the tempting wrong reading if there is one. (Concreteness fading, refutation.)
5. Prediction pause (5-10 s): ask the viewer what the fix should do. (Productive failure light, POE, retrieval.)
6. The fix as a worked example, one scene per idea (3-6 scenes, 20-45 s each): hypothesis sentence, highlighted code, the reason ("because"), result on the same concrete case. Contrast old and new on the same input. (Worked example, segmenting, signaling, Brooks, contrasting cases.)
7. Generalize (20-30 s): the rule or invariant the concrete case instantiates, plus where it stops applying. (Fading to abstract, analogy if exact.)
8. Review guide (20-40 s): what to check, risky spots, what was deliberately not changed, tests that prove it. (Merrill application, Bacchelli.)
9. Recap with 2-3 questions (10-20 s): short recall prompts, one-sentence summary of the story. (Retrieval practice, narrative closure.)

Total about 3-6 minutes for a typical MR; extend by adding scenes in step 6, not by lengthening them.

## Top rules ranked (evidence x applicability)

1. Open with the problem as a concrete failing case, then the fix, then the code. (Narrative, concreteness fading, Merrill, Bacchelli.)
2. Explain what changed and why; do not narrate the diff line by line. Reviewers lack context, not syntax. (Bacchelli & Bird.)
3. Segment into short, titled scenes with one idea each. (Segmenting, d about 0.7+.)
4. Use voice for explanation and keep on-screen text to labels and code; no duplicated sentences. (Modality, redundancy.)
5. Signal: highlight only the lines being discussed and keep a visible outline. (Signaling, coherence.)
6. Cut anything not needed to understand or verify the change (renames, formatting, unrelated hunks) to one line. (Coherence.)
7. Walk one concrete input through old and new code, then abstract the rule. (Concreteness fading, worked examples.)
8. Show contrasting before/after on the same input, and state the one tempting misreading and why it is wrong. (Contrasting cases, refutation text.)
9. Give "because" for each step; state the hypothesis before the code. (Self-explanation/worked examples, Brooks, causality.)
10. Pre-name the few key terms and give a map first; make both skippable. (Pre-training, advance organizer, expertise reversal.)
11. One or two prediction or recall pauses, no more. (Retrieval, elaborative interrogation, light productive failure.)
12. Conversational second-person voice, plain words. (Personalization, Feynman.)

## Anti-patterns

- Starting with the file list or the diff itself.
- Reading code aloud while it is also on screen as text.
- Explaining every hunk in file order instead of in causal order.
- Decorative or amusing detail, long analogies, stock footage, metaphors that map only on the surface.
- Abstract principle first with no concrete case; or staying at literal values and never stating the rule.
- Teaching language basics or repeating things the reviewer knows, with no way to skip.
- Segments over about a minute, or a single unbroken stream.
- Many quiz prompts (a passive medium cannot support them) or a prediction pause with no reveal.
- Asserting confidence the agent lacks: if the agent does not understand a hunk, say so rather than inventing a rationale.
- Ending with a restatement that adds nothing, rather than what to check.
