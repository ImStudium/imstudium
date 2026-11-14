---
description: Explain a concept from your own lecture material, with page citations
argument-hint: "<concept> [in <course>]"
allowed-tools: Bash(imstudium:*), Bash(rg:*), Read, Grep, Glob
---

Explain from my course material: $ARGUMENTS

1. `imstudium search "<the concept>" -n 10 --json` (add `--course` if I named one; `--archive` if nothing current matches).
2. Read the top hits' `content.md` around the cited pages. Formulas, plots and image-only pages: open the original PDF in `files/` — never reconstruct math from the markdown.
3. Explain in the lecture's own notation: definition → intuition → one worked example → one common mistake. Cite as `Course · file · p.N`. Mark anything that comes from general knowledge rather than my slides.
4. End with one check question for me — and wait for my answer.
