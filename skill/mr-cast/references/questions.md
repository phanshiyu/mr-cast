# Ask what the video is for

Ask with one `AskUserQuestion` call before you start the run. Ask only what the request leaves open:

- The user already answered a question with words such as "a simple video" or "explain like I'm new to this" (audience), or "slowly" (pace). A request for a short video, or one for the team, answers the audience with the short overview, unless it also says pre-read. "Pre-read", "before I review", "no code on screen" or "without code" answer it with `preread`. Words such as "focus on the migration" do not answer a question here. They shape your suggested topics in step 4.
- The user asked for your opinion of the branch, with words such as "review it", "with your review", "find issues" or "flag anything that looks wrong". That turns review on (question 4).
- The user said "just make it", "use the defaults" or "no questions". Skip the call and use the last choices from `status`, else the recommended options. Review stays off unless the words above turned it on.

Say in one line which choice you used for each question you skipped. "Render" means an MP4. It does not skip the questions.

Every question is multiple choice. Put the recommended option first and end its label with "(Recommended)". When `status` shows a last choice for the question, put that option first instead and end its label with "(Last time)", unless it is the recommended option. The user can then accept every default by pressing enter.

1. Only when both sources are live: header "Video of", question "What should the video show?"
   - "Changes on <branch> (<n> files) (Recommended)". Description: the commits and files from `status`.
   - "Your explanation of <topic>". Description: the explanation in one line.
2. Header "Audience", question "Who is this video for?" `status` names these `familiar`, `new`, `overview` and `preread`.
   - `familiar`: "A reviewer of this change (Recommended)" for the branch, or "A teammate who knows this code (Recommended)" for an explanation. Description: "Diagrams, then the code behind each point."
   - `new`: "Someone new to this code". Description: "Walks the code one line at a time in plain words, after the code around it. Good for a second-language reader. Longer."
   - `overview`: "A short overview for the team". Description: "Diagrams and behavior, with very little code. Usually under 3 minutes."
   - `preread`: "A reviewer who will read the code next". Description: "Diagrams only. Ends with a reading order to follow in your editor." Offer it for the branch and for an explanation alike, so a last choice of `preread` always has its option.
3. Header "Pace", question "How should it sound?" `status` names these `normal`, `slower`, `faster` and `silent`.
   - "Normal pace (Recommended)". Description: "About 130 words a minute, with pauses between steps."
   - "Slower". Description: "A slower voice and longer pauses. Good for new readers or a second language."
   - "Faster". Description: "A quicker voice and shorter pauses."
   - "No voice, subtitles only". Description: "A silent video, timed for reading."

   When you already know the audience is someone new to this code, recommend "Slower" and list it first, unless a last choice comes first.
4. Only when the branch is live: header "Review", question "Should I also flag what looks wrong?"
   - "No, just explain (Recommended)". Description: "The video explains the change and gives no verdict."
   - "Yes, flag what looks off". Description: "I mark lines that look wrong as the walkthrough reaches them, as my opinion, recap them at the end and write them to review.md."

   Review applies to the branch only. If the user picks their explanation in question 1, ignore this answer.

Then turn the answers into `<flags>` as SKILL.md step 2 says.
