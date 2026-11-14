---
description: Active-recall quiz from your own slides — one question at a time, graded with citations
argument-hint: "<course or topic> [n questions]"
allowed-tools: Bash(imstudium:*), Bash(rg:*), Read, Grep, Glob
---

Quiz me on: $ARGUMENTS

Use the `imstudium-study-session` skill, step 4 (active recall) as the main event:

- Pull the material with `imstudium search` and read the cited pages first; build every question from them.
- Mix definition, application and "why" questions; default 5. Ask **one at a time** and wait for my answer.
- Grade each answer honestly with the page to re-read. If I miss the same idea twice, re-explain it differently and come back to it.
- Finish with the recap block from the skill (got it · re-read · next review in 1/3/7 days). Offer to save it under `## Student notes` in that course's `COURSE.md`; write only on a yes.
