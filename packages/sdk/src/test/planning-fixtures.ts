/**
 * SYNTHETIC Stud.IP 6.1 payloads for planning tests — shapes follow the
 * JSON:API schemas (CourseEvent, SeminarCycleDate, ScheduleEntry,
 * ConsultationBlock/Slot, CourseMember, StatusGroup, TreeNode). No real data.
 */
import { StudIpClient } from "../client.js";
import type { JsonApiResource } from "../types.js";

export const COURSE_A = "a".repeat(32);
export const COURSE_B = "b".repeat(32);
export const ME = "f".repeat(32);
export const LECTURER = "1".repeat(32);
export const TUTOR = "2".repeat(32);

export function courseEvent(
  id: string,
  courseId: string,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
): JsonApiResource {
  return {
    type: "course-events",
    id,
    attributes: {
      title: "1001 Beispielkurs",
      description: null,
      start,
      end,
      type: 1,
      categories: "Vorlesung",
      location: "Hörsaal A",
      "is-cancelled": false,
      recurrence: "Montag: 10:00 - 11:30, wöchentlich",
      ...extra,
    },
    relationships: { owner: { data: { type: "courses", id: courseId } } },
  };
}

export function cycleDate(id: string, courseId: string, extra: Record<string, unknown> = {}): JsonApiResource {
  return {
    type: "seminar-cycle-dates",
    id,
    attributes: {
      title: "1001 Beispielkurs",
      description: null,
      start: "10:00",
      end: "11:30",
      weekday: 1,
      recurrence: {
        FREQ: "WEEKLY",
        INTERVAL: 1,
        DTSTART: "2026-10-12T10:00:00+02:00",
        UNTIL: "2027-02-01T10:00:00+01:00",
        // PHP json_encode of a non-sequential array → object
        EXDATES: { "2": "2026-10-26T10:00:00+01:00" },
      },
      locations: ["Hörsaal A"],
      ...extra,
    },
    relationships: { owner: { data: { type: "courses", id: courseId } } },
  };
}

export function personalEntry(id: string): JsonApiResource {
  return {
    type: "schedule-entries",
    id,
    attributes: { title: "Lerngruppe", description: "Bibliothek", start: "18:00", end: "19:30", weekday: 3, color: "" },
    relationships: { owner: { data: { type: "users", id: ME } } },
  };
}

/** Fake fetch: route handler gets (path, URLSearchParams); records every URL. */
export function fakeClient(
  handler: (path: string, query: URLSearchParams) => { status?: number; body: unknown; contentType?: string } | undefined,
): { client: StudIpClient; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${url.pathname.replace(/^\/jsonapi\.php\/v1/, "")}${url.search}`);
    const res = handler(url.pathname.replace(/^\/jsonapi\.php\/v1/, ""), url.searchParams);
    if (!res) return new Response(JSON.stringify({ errors: [{ status: "404", title: "Not found" }] }), { status: 404, headers: { "content-type": "application/vnd.api+json" } });
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "content-type": res.contentType ?? "application/vnd.api+json" },
    });
  }) as typeof fetch;
  return {
    client: new StudIpClient({ baseUrl: "https://studip.example.test/jsonapi.php/v1", fetchImpl, retries: 0 }),
    calls,
  };
}
