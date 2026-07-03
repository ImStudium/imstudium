# Studium workspace format

Version **1** — produced by `digicampus init` and `digicampus sync`.

## Directory layout

```
Studium/
├── studium.json
├── STUDIUM.md
├── klausuren.md
├── calendar.ics
└── {semester}/
    └── {course-slug}/
        ├── COURSE.md
        ├── files/
        ├── wiki/
        └── news/
```

Default semester folder: `current/`

## studium.json

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-07-03T12:00:00.000Z",
  "instanceUrl": "https://digicampus.uni-augsburg.de",
  "user": { "id": "...", "name": "..." },
  "semesters": ["current"],
  "courses": [
    {
      "id": "abc123",
      "title": "Analysis II",
      "slug": "Analysis-II",
      "courseType": "Vorlesung",
      "credits": 9,
      "fileCount": 42,
      "examDates": [
        {
          "courseId": "abc123",
          "courseTitle": "Analysis II",
          "date": "2026-08-15T10:00:00+02:00",
          "title": "Klausur",
          "confirmed": true,
          "source": "event",
          "daysRemaining": 43
        }
      ],
      "schedule": [],
      "lastSynced": "2026-07-03T12:00:00.000Z"
    }
  ],
  "nextDeadlines": []
}
```

## klausuren.md

Two sections:

- **Confirmed** — from course events matching Klausur/Prüfung keywords
- **Unconfirmed** — from `achievement` / `miscellaneous` text fields

Students should verify unconfirmed entries.

## Regeneration vs student notes

`STUDIUM.md`, `klausuren.md`, and `COURSE.md` preserve content under:

```markdown
## Student notes

(your edits here are kept on sync)
```

## Agent usage

- Prefer `studium.json` for structured queries
- Use `STUDIUM.md` / `COURSE.md` for human-readable context
- Use `files/` paths from `studium_find_materials` MCP tool

## Sync state (separate from workspace)

`~/.local/share/digicampus/sync-state.json` tracks per-file `chdate` + ETag for incremental downloads.
