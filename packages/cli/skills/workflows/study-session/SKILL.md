---
name: imstudium-study-session
description: |
  Workflow — a focused study session on one topic from the student's own course material: explain with citations,
  check understanding with active-recall questions, close the gaps, recap. Use when the student says "let's study",
  "explain [topic]", "quiz me", "I don't get [concept]", "go through lecture [N]", or wants to practise for an exam.
allowed-tools:
  - Bash(imstudium *)
  - Bash(rg *)
---

# Workflow: Study session

The student's slides and scripts are the source of truth; your general knowledge fills gaps and is labelled as such.

## 1. Scope it

One topic, one course, ~45 minutes. If the student is vague, `imstudium context --json` and `imstudium klausuren`
show what's current and what's examined next; suggest one topic.

## 2. Find the material

```bash
imstudium search "<topic words>" --course <course> -n 10    # add --archive for earlier semesters
```

Open the cited `extracted/<slug>/content.md` around the hit's page. Image-only pages and formulas: open the
original in `files/` — never reconstruct math from the markdown.

## 3. Explain (short)

- Build from what the lecture defines, in the lecture's notation, with citations like `NLP · 04_Embeddings.pdf · p.12`.
- One intuition, one worked example, one common mistake. Stop and ask before going further.

## 4. Active recall

- Ask 3–5 questions, one at a time, mixing definition, application and "why". Wait for the answer each time.
- Grade honestly: what was right, what was missing, the cited page to re-read.
- Wrong twice on the same idea → explain it differently (example, picture, analogy), then ask again later in the session.

## 5. Recap

```markdown
## [Topic] — [date]
- **Got it:** [concepts answered well]
- **Re-read:** [concepts missed, with page citations]
- **Next review:** [in 1 day, then 3, then 7 — spaced repetition]
```

Offer to append the recap to `## Student notes` in the course's `COURSE.md` — only on a yes.

## Never

- Solve current graded Übungsblätter or Abgaben for the student — hints, similar worked examples, and checking their attempt are fine.
- Paste course material outside the session (UrhG §60a, see `imstudium-datenschutz`).
