# Studium workspace format

Version **2** — produced by `digicampus init`, `digicampus sync`, and `digicampus index`.

## Directory layout

```
Studium/
├── llms.txt              # agent entry point — navigation + search guidance
├── studium.json          # machine-readable course map
├── STUDIUM.md
├── klausuren.md
├── calendar.ics
├── search/
│   └── index.json        # workspace search stats (corpora live per course)
└── {semesterSlug}/       # e.g. SS2026
    └── {course-slug}/
        ├── COURSE.md
        ├── search/
        │   ├── materials.json   # file list + extract slugs + cite refs
        │   ├── corpus.jsonl     # page index for grep / semantic search
        │   └── index.json
        ├── files/               # synced originals
        ├── extracted/
        │   └── {file-slug}/
        │       ├── content.md     # text per page/slide
        │       ├── pages/*.png    # rendered pages — read before explaining slides
        │       └── manifest.json
        ├── wiki/
        └── news/
```

Default sync scope: **current semester** (`digicampus sync`). Other semesters: `digicampus sync --semester "WS 2025/26"`.

## studium.json (schema v2)

Key fields:

- `activeSemester` — `{ id, title, slug, isCurrent, weekNumber?, progressPercent? }`
- `otherSemesters` — nearby terms not synced by default
- `courses[].path` — authoritative folder path, e.g. `SS2026/Analysis-II`
- `courses[].search` — optional `{ corpusPath, chunkCount, indexedAt }`

Always resolve paths from `course.path` — never hardcode folder names.

## Finding content (agents)

The workspace ships a **page index**, not a search engine. Use your harness grep or semantic search:

```bash
rg -i "keyword" ~/Studium/SS2026/*/search/corpus.jsonl
```

Each JSONL line includes `ref` (cite as `SS2026/Course#file.pdf:5`), `text`, `pageImage`, `extractSlug`.

See `llms.txt` at the workspace root.

## klausuren.md

Human-readable exam list with confirmed vs unconfirmed dates. Unconfirmed entries come from course achievement text — verify in Stud.IP.

## COURSE.md

Per-course brief: type, ECTS, exams, description. Preserves a `## Student notes` section across rebuilds.
