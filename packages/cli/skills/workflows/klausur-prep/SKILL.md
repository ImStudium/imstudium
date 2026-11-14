---
name: imstudium-klausur-prep
description: |
  Workflow — a Klausur prep plan for one course: exam date and days left, what the exam covers, the material that
  matters most, and a day-by-day plan ending in a mock exam. Use when the student says "help me study for",
  "Klausur prep", "exam plan for [course]", "how should I prepare", or an exam is within the next weeks.
allowed-tools:
  - Bash(imstudium *)
  - Bash(rg *)
---

# Workflow: Klausur prep

CLI first. Inside an MCP-only harness use the `imstudium` tool with the same arguments (`{"args": ["klausuren"]}`).

## 1. Pin the exam

```bash
imstudium klausuren --json           # date, location, confirmed / unconfirmed, days remaining
imstudium tasks <course> --open      # graded Abgaben that still count
```

- `confirmed: false` dates come from slide or course text — tell the student to verify the date in STUDIS.
- No date at all? Say so, plan against the end of the lecture period (`imstudium holidays`), and ask.

## 2. Find out what the exam covers

```bash
imstudium search "klausur prüfung exam relevant" --course <course> -n 15
imstudium news <course> --since 120d        # "Klausurtermin", "Hilfsmittel", "nicht klausurrelevant"
imstudium courseware <course>                # unit outline = topic list
```

Collect: allowed aids (Hilfsmittel), format (written / oral, minutes), excluded topics, mock exams or Altklausuren.

## 3. Rank the material

`imstudium files tree <course>` and the search hits give the lecture sequence. Rank topics by
(a) explicitly announced as relevant, (b) appears in Übungen / mock exams, (c) lecture time spent.
Read the top `content.md` files at the cited pages; open the original PDF for formulas and figures (inline math is garbled, and `$$…$$` formulas are on-device model output to check).

## 4. Build the plan

- Days remaining ÷ topics, heaviest topics first, one review day every 3–4 days (spaced repetition).
- Every day ends with active recall: 3–5 questions the student answers *without* notes.
- The last 2 days: a timed mock exam under real conditions (same aids, same time), then error review.
- Graded work stays the student's own: hints and worked examples of *similar* problems, never solutions to current Übungsblätter.

## Deliverable

```markdown
## [Course] — Klausur prep
- **Exam:** [date, time, room] — [N] days · [confirmed | verify in STUDIS]
- **Format & aids:** [written 90 min · A4 sheet · calculator]
- **Covers:** [topics, with what's excluded]
- **Priority material:** [3–5 files with page citations]
- **Plan:** [day → topic → recall questions]
- **Today, 60 min:** [one focused block with a clear done state]
```

Offer to save the plan as a `## Student notes` section in the course's `COURSE.md` (survives every sync) — only on a yes.
