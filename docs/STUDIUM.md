# Studium workspace format

`imstudium sync`, `semester start`, `init` and `onboard` all build this layout through one pipeline (`packages/cli/src/pipeline.ts`). `imstudium extract` and `imstudium index` refresh the extraction and search parts. The default location is `~/Studium` (`IMSTUDIUM_WORKSPACE`, `-o <dir>`, or `imstudium config set workspace <dir>`).

Every example below is synthetic.

## Layout

```
Studium/
├── llms.txt                  # entry point for agents
├── studium.json              # course map, schema v2 (below)
├── STUDIUM.md                # semester overview + "Today and next" links
├── NEW.md                    # files that arrived in the last 14 days, per course
├── abgaben.md                # courseware tasks: open (soonest first), then submitted
├── stundenplan.md            # weekly plan, single dates, cancellations
├── klausuren.md              # exam dates: confirmed, then unconfirmed
├── calendar.ics              # your Stud.IP calendar (/users/{id}/events.ics)
├── mcp.json                  # project MCP config (only after `imstudium setup mcp`)
├── search/index.json         # workspace search stats; corpora live per course
├── WS2026-27/                # current semester, named after the semester slug
│   └── Statistik-I/          # course slug from the title
│       ├── COURSE.md
│       ├── files/
│       ├── extracted/
│       ├── search/
│       ├── news/
│       ├── forum/
│       ├── courseware/
│       └── wiki/
├── archive/
│   └── SS2026/               # earlier semesters
│       ├── semester.json
│       ├── klausuren.md
│       ├── STUDIUM.md        # snapshot taken at rollover
│       └── Datenbanksysteme/ # same per-course layout
├── .imstudium/
│   ├── changes.jsonl
│   └── tasks.json
└── snapshots/
    └── studium.json
```

Semester slugs look like `SS2026` and `WS2026-27`. A course folder is `slugify(title)`, with diacritics folded and anything else turned into `-`. **Always resolve a course folder from `course.path` in `studium.json`, never by building it yourself.**

`COURSE.md`, `STUDIUM.md`, `klausuren.md` and `stundenplan.md` keep a `## Student notes` section across rebuilds. Files in `news/`, `forum/`, `courseware/` and `wiki/` are rewritten only when their content changed.

## Per-course folder

| Path | Contents | Written by |
|---|---|---|
| `COURSE.md` | Brief: type, ECTS, files synced, description, Leistungsnachweis, exams, navigation, `## Student notes` | every sync |
| `files/` | Originals. With the default `--layout tree` this mirrors the course's Stud.IP folder tree (`files/Übungen/Blatt01.pdf`); `--layout flat` puts everything directly in `files/` | `sync` |
| `extracted/<slug>/content.md` | Extracted markdown, one `## Page N` (or `## Slide N`) section per page. `<slug>` is the folder-qualified file path, e.g. `Ubungen-Blatt01-pdf` | `sync --extract`, `extract` |
| `extracted/<slug>/manifest.json` | Source path, size and mtime, engine, page count, error | same |
| `extracted/<slug>/pages/` | Only for photos (copied as they are, no OCR) | same |
| `search/corpus.jsonl` | Page index, one JSON line per page: `ref`, `citation`, `coursePath`, `courseTitle`, `sourceFile`, `extractSlug`, `page`, `pageLabel`, `kind`, `text` | `sync --extract`, `index` |
| `search/materials.json` | Every file with kind, page count, extraction state and `extractSlug` | same |
| `search/index.json` | Course corpus stats | same |
| `news/<YYYY-MM-DD>-<title>.md` | One announcement with frontmatter (`id`, `title`, `date`, `author`, `course`, `updated`, `expires`). Expired announcements stay as a local archive | `sync` (`news`), `news --save` |
| `news/README.md` | Index, newest first | same |
| `forum/<topic>/<thread>.md` | One discussion with every posting. Anonymous postings stay anonymous | `sync` (`forum`), `forum --save` |
| `forum/README.md` | Index grouped by category and topic | same |
| `courseware/<unit>/<NN>-<page>.md` | One courseware page in outline order | `sync` (`courseware`), `courseware --save` |
| `courseware/<unit>/files/` | Files from courseware blocks | same |
| `courseware/README.md` | Units, outline and tasks with deadlines | same |
| `wiki/<page>.md` · `wiki/README.md` | The course wiki as linked markdown, with a page tree in the README | `sync` (`wiki`), `wiki --save` |

A course without courseware, forum or wiki gets no such folder. `sync --include` limits which parts run; the default is `calendar,wiki,news,forum,courseware,tasks`, and files always sync. Personal messages are **never** written into the workspace.

## Root files

| File | Contents |
|---|---|
| `llms.txt` | Navigation for agents: `imstudium context --json` first, then the root files, `imstudium search`, the course list, the per-course layout, `archive/` and the rules |
| `STUDIUM.md` | Semester focus and week, courses, the next 10 exams, links to `stundenplan.md`, `abgaben.md`, `NEW.md` and `klausuren.md` |
| `NEW.md` | New 🆕 and updated ✏️ files from the last 14 days, per course, newest entry per file. Comes from `.imstudium/changes.jsonl` |
| `abgaben.md` | Open, overdue and upcoming courseware tasks with deadline, days left and progress, then submitted ones. Comes from `.imstudium/tasks.json` |
| `stundenplan.md` | Weekly table (day, time, course, kind, room, rhythm), the Vorlesungszeit, single dates and cancellations. `imstudium stundenplan --save` writes it too |
| `klausuren.md` | Confirmed exam dates (Stud.IP date type), then unconfirmed ones parsed from course text. Check those in Stud.IP |
| `calendar.ics` | Your Stud.IP calendar. `today`, `week` and `stundenplan` read it with `--offline` |

## studium.json (schema v2)

```jsonc
{
  "schemaVersion": "2",
  "generatedAt": "2026-10-19T06:12:00.000Z",
  "instanceUrl": "https://digicampus.uni-augsburg.de",
  "user": { "id": "…", "name": "…" },
  "activeSemester": {                      // check this first
    "id": "…", "title": "WS 2026/27", "slug": "WS2026-27", "isCurrent": true,
    "start": "…", "end": "…",
    "weekNumber": 3, "daysElapsed": 18, "daysTotal": 182, "progressPercent": 10
  },
  "otherSemesters": [                      // nearby terms not in this snapshot
    { "id": "…", "title": "SS 2026", "slug": "SS2026", "isCurrent": false, "synced": false }
  ],
  "workspaceFolder": "WS2026-27",          // where the course folders live
  "courses": [
    {
      "id": "…", "title": "Statistik I", "slug": "Statistik-I",
      "path": "WS2026-27/Statistik-I",     // authoritative folder
      "courseNumber": "…", "courseType": "…", "subtitle": "…",
      "description": "…", "achievement": "…", "credits": 6,
      "semester": "WS 2026/27", "semesterId": "…",
      "schedule": [                        // regular cycles and single dates
        { "type": "regular", "title": "…", "weekday": 1, "startTime": "10:00", "endTime": "11:30",
          "intervalWeeks": 1, "until": "…", "location": "…", "category": "Vorlesung" },
        { "type": "single", "title": "…", "start": "…", "end": "…", "category": "Klausur" }
      ],
      "examDates": [
        { "courseId": "…", "courseTitle": "Statistik I", "date": "…", "title": "Klausur",
          "location": "…", "confirmed": true, "source": "event", "daysRemaining": 112 }
      ],
      "fileCount": 14, "folderCount": 3, "lastSynced": "…",
      "search": { "corpusPath": "WS2026-27/Statistik-I/search/corpus.jsonl", "chunkCount": 212, "indexedAt": "…" }
    }
  ],
  "nextDeadlines": [ /* the next 10 dated exams across courses, same shape as examDates */ ],
  "search": { "chunkCount": 980, "courseCount": 5, "indexedAt": "…" },

  "semesters": ["WS 2026/27"], "semesterId": "…", "semesterSlug": "WS2026-27"   // deprecated, kept for old readers
}
```

- `examDates[].source` is `event` (a Stud.IP date of an exam type, `confirmed: true`) or `achievement`/`miscellaneous` (course text, `confirmed: false`).
- `course.search` is present once the course is indexed (`sync --extract` or `index`).
- `schedule[]` entries also carry `courseId`, `courseTitle` and `kind`. Older readers can rely on `title`, `start`, `end` and `location`.

## archive/

`imstudium semester start` moves every semester folder at the root that isn't the current semester to `archive/<slug>/`. It writes `semester.json` (the old `studium.json` with paths rewritten to `archive/…`), copies `STUDIUM.md` and `klausuren.md`, and rewrites `ref`, `path` and `corpusPath` in that semester's search files. Nothing is deleted. If `archive/<slug>/` already exists, the folder stays where it is and the command warns.

`imstudium sync --all-semesters` syncs every enrolled semester. The current one goes to the root and the rest to `archive/<slug>/`, each with `semester.json` and `klausuren.md`. A course that runs across semesters lives in exactly one folder: the current semester if it runs now, otherwise its start semester.

`imstudium search --archive` includes the archive. `imstudium semester` lists it.

## .imstudium/

| File | Contents |
|---|---|
| `changes.jsonl` | Append-only log, one line per new or updated file per sync: `{"at", "kind": "file", "change": "new"\|"updated", "courseId", "courseTitle", "name", "path"}` (`path` is workspace-relative). It feeds `NEW.md`, `imstudium changes` and `context` |
| `tasks.json` | `{"updatedAt", "tasks": [...]}`, courseware tasks sorted by deadline (`title`, `courseTitle`, `unitTitle`, `deadline`, `daysLeft`, `status`: `open`\|`overdue`\|`upcoming`\|`submitted`, `progress`, `url`, …). It feeds `abgaben.md` and `context` |

## snapshots/

`snapshots/studium.json` holds counts and dates only, with no course titles, names, ids or file names. It's meant for personal dashboards such as Echo. `imstudium module` and the MCP tool `studium_modules` read the same numbers.

```json
{
  "schemaVersion": 1,
  "pack": "studium",
  "asOf": "…",
  "metrics": {
    "semester": "WS 2026/27", "courses": 5, "exams": 4,
    "nextDate": "…", "nextDays": 112, "newFiles7d": 9,
    "openTasks": 2, "nextTaskDays": 4, "lastSync": "…"
  },
  "modules": ["studium.courses", "studium.exams"]
}
```

## Outside the workspace

| Path | Contents |
|---|---|
| `~/.config/imstudium/config.json` | `baseUrl`, `instanceOrigin`, `workspacePath`, OAuth settings |
| `~/.config/imstudium/session.json` | Session fallback (0600), used only when neither ImSicheren nor the OS keychain is available |
| `~/.config/imstudium/chrome-profile/` | The isolated browser profile for sign-in and silent renewal |
| `~/.config/imstudium/setup-manifest.json` | Which skills and MCP entries setup installed |
| `~/.local/share/imstudium/sync-state.json` | File sync state (file-ref id, change date, local path) |
| `~/.local/share/imstudium/routes.json` | The cached `/discovery` route catalog |
| `~/.local/share/imstudium/cache/` | Cache for public data (semesters, holidays) |

None of these belong in git.

## Finding content (agents)

```bash
imstudium search "Erwartungswert" --json          # ranked, offline: materials, news, forum, courseware, wiki
imstudium search "Normalform" --course datenbank --archive
rg -i "keyword" ~/Studium/WS2026-27/*/search/corpus.jsonl
```

Cite with `ref` (e.g. `WS2026-27/Statistik-I#Folien-03.pdf:12`) and read the page section in `extracted/<slug>/content.md`.

### Extraction limits

There's one local pipeline: pdf-inspector for PDFs and AnyDoc for Office. No API key, no Tesseract, no poppler, no LibreOffice.

- `content.md` is markdown, not LaTeX. For formulas and diagrams, open the original in `files/`.
- Image-only pages are marked `_(image-only page — no text layer)_`. Open the original.
- `corpus.jsonl` is for finding content, not for answering from image-only pages.
