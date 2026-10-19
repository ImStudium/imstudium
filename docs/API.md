# Stud.IP JSON:API — ImStudium capability matrix

**Instance:** [digicampus.uni-augsburg.de](https://digicampus.uni-augsburg.de), Stud.IP **6.1.2**
**API base:** `https://digicampus.uni-augsburg.de/jsonapi.php/v1/`
**Routes:** **422** route patterns in `/discovery`, of which **257** allow GET. Method counts across all routes: GET 257, POST 80, DELETE 70, PATCH 57, PUT 11.

ImStudium reads with GET and nothing else unless you pass `--write`. All counts come from `imstudium routes`, as of 2026-10-19. Other instances differ, so run `imstudium routes --refresh` to see yours.

## Authentication

| Method | Header / cookie | ImStudium |
|---|---|---|
| Session cookie | `Seminar_Session` | Yes. `imstudium login` signs you in through the instance's Shibboleth in a browser window and captures the cookie |
| OAuth2 Bearer | `Authorization: Bearer` | Yes, once the university registers a client. See [OAUTH.md](OAUTH.md) |
| HTTP Basic | `Authorization: Basic` | No. Shibboleth/MFA instances don't allow it |

ImStudium stores the session in ImSicheren when installed, otherwise the OS keychain, otherwise `~/.config/imstudium/session.json` (0600). An HTML login page in place of JSON means the session expired (`SESSION_EXPIRED`). A 401 triggers one silent headless renewal from the isolated login profile.

## Public routes (no session)

| Route | Used by |
|---|---|
| `/discovery` | `imstudium routes` (catalog cached for a week in `~/.local/share/imstudium/routes.json`) |
| `/studip/properties` | `routes` (Stud.IP version) |
| `/semesters` | `semester`, `semesters`, semester resolution (cached daily) |
| `/holidays` | `holidays`, the Feiertag marks in `week` (cached weekly). Served as plain JSON, not JSON:API |
| `/tree-node/*` | `catalog search`, `catalog areas` (course search per semester, study-area tree, course details) |

## Coverage: domain → command → workspace

| Domain | Main GET routes | Command | Written by `sync` |
|---|---|---|---|
| You & your courses | `/users/me`, `/users/{id}/courses`, `/courses/{id}` | `courses list\|show`, `studium` | `studium.json`, `STUDIUM.md`, `COURSE.md` |
| Semesters | `/semesters` | `semester`, `semester start`, `semesters` | `activeSemester` in `studium.json`, `archive/` |
| Files | `/{courses}/{id}/file-refs`, `/{courses}/{id}/folders`, `/folders/{id}/folders`, `/file-refs/{id}/content` | `sync`, `files tree`, `files download` | `files/` (Stud.IP folder tree), `extracted/`, `search/` |
| Weekly plan | `/users/{id}/schedule` (seminar-cycle-dates, schedule-entries) | `stundenplan`, `week` | `stundenplan.md` |
| Dates | `/courses/{id}/events`, `/users/{id}/events` | `today`, `week` | `stundenplan.md` |
| Calendar export | `/users/{id}/events.ics` | `today --offline`, `export calendar` | `calendar.ics` |
| Holidays | `/holidays` | `holidays` | — |
| Exams | `/courses/{id}/events` (date type), course achievement text | `klausuren` | `klausuren.md` |
| News | `/courses/{id}/news`, `/studip/news`, `/news/{id}/comments` | `news` | `news/` |
| Forum | `/courses/{id}/forum-categories`, `/forum-topics`, `/forum-discussions`, `/forum-discussions/{id}?include=postings` | `forum` | `forum/<topic>/<thread>.md` |
| Messages | `/users/{id}/inbox`, `/users/{id}/outbox`, `/messages/{id}` | `inbox`, `outbox`, `message` | never written |
| Blubber | `/users/{id}/blubber-threads`, `/courses/{id}/blubber-threads`, `/blubber-threads/{id}/comments` | `blubber` | — |
| Activity | `/users/{id}/activitystream` | `feed` | — |
| Courseware | `/courses/{id}/courseware-units`, `/courseware-units/{id}`, `/courseware-structural-elements/{id}/descendants`, `…/containers`, `/courseware-containers/{id}/blocks`, `/courseware-blocks/{id}/file-refs` | `courseware` / `cw` | `courseware/<unit>/` |
| Courseware tasks | `/courseware-tasks?filter[cid]=…`, `/courseware-task-groups/{id}` | `tasks` | `abgaben.md`, `.imstudium/tasks.json` |
| Wiki | `/courses/{id}/wiki-pages` | `wiki` | `wiki/` |
| People | `/courses/{id}/memberships`, `/courses/{id}/status-groups` | `people` | — (students are counted, never named) |
| Sprechstunden | `/{users\|courses}/{id}/consultations?include=slots` | `sprechstunden` | — (booking stays in Stud.IP) |
| Catalog | `/tree-node/*` (public), `/courses?filter[q]`, `/modules`, `/courses-of-study` | `catalog search\|areas\|modules\|studies` | — |
| Everything else | any of the 257 GET routes | `api <path>` | — |

### Route catalog at a glance

These are GET route patterns grouped by path, as rough counts:

| Area | GET routes | Covered by a dedicated command |
|---|---|---|
| Courseware (units, elements, containers, blocks, tasks, peer review, templates, public links) | ~62 | units, pages, blocks, block files, tasks |
| Catalog and study structure (tree-node, study areas, modules, courses of study, degrees, sem types) | ~34 | tree-node search and areas, modules, courses of study |
| Instance plugins under `/legacy/*` (Augsburg-specific) | 34 | — (reach them with `api`) |
| Forum | ~17 | categories, topics, discussions, postings via include |
| Files and folders | ~16 | file-refs, folders, content |
| Blubber | ~11 | threads and comments |
| Schedule, events, semesters, holidays | ~9 | all |
| Consultations | ~7 | blocks and slots (read-only) |
| News | ~7 | course, global, comments |
| Messages | ~6 | inbox, outbox, single message |
| Wiki | ~5 | page list (whole tree) |
| Users, institutes, memberships, config, themes, LTI, … | ~45 | `users/me`, courses, memberships, status groups, activity stream |

## Quirks (Stud.IP 6.1)

The domain work turned up these behaviours. ImStudium works around each one.

| Quirk | What ImStudium does |
|---|---|
| `GET /forum-discussions/{id}/postings` **marks the discussion as read** for the student | Reads postings via `GET /forum-discussions/{id}?include=postings,postings.author`, which has no side effect |
| `GET /courseware-structural-elements/{id}` **stores the student's last-visited page** (`COURSEWARE_LAST_ELEMENT`) | Never calls it. Roots come from the unit (`include=structural-element`) and everything below from `/descendants`, `/containers` and `/blocks` |
| `/courses/{id}/news` only returns announcements **inside their publication window**, and news routes reject unknown filters | `--since` and `--limit` apply locally. `sync` keeps expired announcements in `news/` as a local archive |
| `/users/{id}/schedule` **rejects `page[...]`** with 400 | Calls it unpaginated; `filter[timestamp]` picks the semester. A cycle's course is the `owner` relationship, and cycles carry `HH:MM` plus a weekday |
| Message GETs (`/users/{id}/inbox`, `/outbox`, `/messages/{id}`) **never mark anything read**; only PATCH does | `inbox`/`message` are safe to read. ImStudium never sends the PATCH |
| Stud.IP 6 course events use `start`, `categories` and `is-cancelled`, and their `title` is the course name | Exam detection reads the date type and description, not the title. Cancelled exams are skipped |
| `/holidays` and `/tree-node/course/details/{id}` return **plain JSON**, not JSON:API | Dedicated normalisers |
| A session that ran out gets the **HTML login page** in place of JSON | Reported as `SESSION_EXPIRED` |
| Bursts get **429** | Retries honour `Retry-After`, with at most 6 requests in flight |

## Exploring

```bash
imstudium routes                       # every GET route of your instance
imstudium routes forum                 # filter by substring
imstudium routes courseware --all-methods
imstudium routes --refresh             # fetch /discovery again

imstudium api /users/me/courses --flat                   # /users/me/… expands to your id
imstudium api /courses/<id>/news --include author --flat
imstudium api /users/me/inbox --filter unread=1 --limit 5 --flat
imstudium api /semesters --all --flat
```

`--flat` lifts attributes to the top level and turns relationships into ids. `--include`, `--filter key=value`, `--fields type=a,b`, `--param`, `--limit` and `--all` (follow pagination) map straight onto JSON:API query parameters.

Non-GET methods need `-X <METHOD> --data '<json>' --write`. ImStudium never does this on its own, and the MCP door refuses it.

## Gaps

- Media streams of the Stud.IP media plugin (no JSON:API routes)
- LTI tools: metadata only
- Course registration (Anmeldesets) and consultation booking: write operations, intentionally left to Stud.IP

## References

- [Stud.IP JSON:API docs](https://docs.gitlab.studip.de/entwicklung/jsonapi/start/)
- [Files API](https://docs.gitlab.studip.de/entwicklung/jsonapi/files/)
- [OAuth2](https://docs.gitlab.studip.de/entwicklung/functions/oauth2/)
