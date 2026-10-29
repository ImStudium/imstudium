# Agent study workflow

Example session for an LLM using ImStudium MCP.

## 1. Orient

```
Tool: imstudium_whoami
→ authenticated? workspace path?
```

```
Tool: studium_overview
→ course list, file counts, semester context
```

## 2. Exam priority

```
Tool: studium_klausuren
→ nextDeadlines sorted by daysRemaining
```

Focus on **confirmed** exams first. Ask student to verify **unconfirmed** entries.

## 3. Per-course prep

For each exam in the next 14 days:

```
Tool: studium_course_brief { course: "Analysis II" }
Tool: studium_find_materials { course: "Analysis II", query: "klausur" }
```

## 4. Refresh (if needed)

```
Tool: imstudium_sync_dry_run
→ preview downloads
```

The sync itself is a terminal step (not available over MCP): `imstudium sync` — full sync + rebuild of studium.json.

## 5. Study block output

Agent should produce:

- Next exam date + days remaining
- 3 priority files from `studium_find_materials`
- One 60-minute focus block with clear done state

## Cron (host)

```cron
0 8 * * * imstudium sync --quiet -o ~/Studium
```

After cron, agents can work offline from local workspace only.
