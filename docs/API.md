# Stud.IP JSON:API — ImStudium capability matrix

**Instance:** `https://digicampus.uni-augsburg.de` · Stud.IP **5.4.11**  
**API base:** `https://digicampus.uni-augsburg.de/jsonapi.php/v1/`  
**Routes:** 258 (from `/discovery`)

## Authentication

| Method | Header / cookie | ImStudium Jul 2025+ |
|--------|-----------------|----------------------|
| Session cookie | `Seminar_Session` | Yes — `imstudium login` (auto browser capture) |
| OAuth2 Bearer | `Authorization: Bearer` | Yes — preferred when instance OAuth is configured |
| HTTP Basic | `Authorization: Basic` | No — blocked by Shibboleth/MFA at Uni Augsburg |

## File downloads (primary automation path)

| Action | Route |
|--------|-------|
| Download | `GET /file-refs/{id}/content` |
| ETag check | `HEAD /file-refs/{id}/content` |
| Metadata | `GET /file-refs/{id}` |
| List all files (flat) | `GET /courses/{id}/file-refs` |
| List folder files | `GET /folders/{id}/file-refs` |
| List subfolders | `GET /folders/{id}/folders` |

### Recommended sync pipeline

1. `GET /users/me`
2. `GET /users/{id}/courses`
3. For each course: paginate `GET /courses/{id}/file-refs`
4. For each file-ref: `HEAD /content` → `GET /content` if changed

Pagination: default `page[limit]=30` — follow `links.next`.

## Other readable domains

| Domain | Routes | Export |
|--------|--------|--------|
| Courses | `/courses`, `/users/{id}/courses` | studium.json |
| Schedule | `/users/{id}/schedule` | JSON |
| Calendar | `/users/{id}/events.ics` | .ics file |
| Events | `/courses/{id}/events` | Klausur extraction |
| Wiki | `/courses/{id}/wiki-pages` | .md per page |
| News | `/courses/{id}/news` | .md per item |
| Forum | `/courses/{id}/forum-categories` | JSON (v2) |
| Courseware | `/courses/{id}/courseware` + structural elements | file-refs on blocks |
| Semesters | `/semesters` | filter helper |

## Gaps (not in JSON:API)

- Stud.IP **Media plugin** streams — no `/media` routes
- LTI embeds — metadata only
- Course registration (Anmeldesets)

## Discovery

```bash
imstudium discover
# or
curl https://digicampus.uni-augsburg.de/jsonapi.php/v1/discovery
```

## References

- [Stud.IP JSON:API docs](https://docs.gitlab.studip.de/entwicklung/jsonapi/start/)
- [Files API](https://docs.gitlab.studip.de/entwicklung/jsonapi/files/)
- [OAuth2](https://docs.gitlab.studip.de/entwicklung/functions/oauth2/)
