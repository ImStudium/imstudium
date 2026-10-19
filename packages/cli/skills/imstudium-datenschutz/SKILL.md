---
name: imstudium-datenschutz
description: |
  DSGVO and copyright rules for ImStudium data — Stud.IP session, course materials, messages, grades, other students.
  Use whenever ImStudium data could leave the student's machine: sharing, uploading, committing, summarising for others,
  or wiring ImStudium into other tools.
---

# ImStudium — Datenschutz & Urheberrecht

The workspace (`~/Studium`) and everything `imstudium` prints belong to one student.

## Personal data (DSGVO)

- **Session:** the Stud.IP session lives in the OS keychain (or ImSicheren). Never print, copy, log or export it.
  Never ask for the university password; sign-in happens in the student's own browser window.
- **Messages, grades, Matrikelnummer, consultation bookings:** read only on request, never store outside the
  session, never commit, never paste into other tools or chats.
- **Other people:** lecturers' names and office hours are public course information. Students in member lists,
  forum or blubber posts are personal data — use counts or quote only what the student needs, never export lists.

## Course material (UrhG §60a)

- Slides, scripts and sheets are licensed for the enrolled student's teaching use. Keep them on the student's
  machine. Don't publish, upload to public places, or share with people outside the course.
- Summaries and explanations for the student are fine. Reproducing whole documents for others is not.

## Never

- Commit anything from `~/Studium`, `~/.config/imstudium` or `~/.local/share/imstudium` to git.
- Put real course content, messages or names into test fixtures, issues or bug reports — use synthetic data.
- Run `imstudium api --write` without the student's explicit request for that exact change.

## Safe to share

Counts and dates (`snapshots/studium.json`: courses, exams, next date, new files) — that's what other tools like
a personal dashboard may read.
