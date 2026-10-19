import type { Command } from "commander";
import {
  consultationBookingUrl,
  dateKey,
  dayLabel,
  hhmm,
  ImstudiumError,
  isAuthError,
  type ConsultationBlockInfo,
  type CoursePerson,
} from "@imstudium/sdk";
import { act, getSdk, note, output, type Sdk } from "../runtime.js";
import { currentCourses, resolveCourse } from "../course-arg.js";

interface Owner {
  key: string;
  name: string;
  courses: string[];
  person?: CoursePerson;
  courseId?: string;
}

/** One block: "Di 21.10. 14:00–16:00 · Raum 1 · 3 von 8 Slots frei" (+ note, free times). */
export function formatBlock(b: ConsultationBlockInfo, now: number, showAllSlots = false): string[] {
  const start = new Date(b.start);
  const end = new Date(b.end);
  const free = b.slots.filter((s) => s.bookable && Date.parse(s.start) >= now);
  const status = b.slots.length ? (free.length ? `${free.length} von ${b.slots.length} Slots frei` : "ausgebucht") : "ohne Slots";
  const lines = [`  ${dayLabel(dateKey(start))} ${hhmm(start)}–${hhmm(end)}${b.room ? ` · ${b.room}` : ""} · ${status}`];
  if (b.note) lines.push(`    ${b.note.replace(/\s+/g, " ").slice(0, 160)}`);
  if (free.length && (showAllSlots || free.length <= 6)) lines.push(`    frei: ${free.map((s) => hhmm(new Date(s.start))).join(", ")}`);
  return lines;
}

async function lecturersOf(sdk: Sdk, courses: Array<{ id: string; title: string }>, owners: Map<string, Owner>) {
  const lists = await Promise.all(
    courses.map(async (c) => {
      try {
        return { c, people: await sdk.people.lecturers(c.id) };
      } catch (err) {
        if (isAuthError(err)) throw err;
        note(`Hinweis (${c.title}): ${err instanceof Error ? err.message : String(err)}`);
        return { c, people: [] as CoursePerson[] };
      }
    }),
  );
  for (const { c, people } of lists) {
    for (const p of people) {
      const owner = owners.get(p.id) ?? { key: p.id, name: p.name, courses: [], person: p };
      owner.courses.push(c.title);
      owners.set(p.id, owner);
    }
  }
}

export function registerSprechstunden(program: Command): void {
  program
    .command("sprechstunden")
    .alias("consultations")
    .description("Upcoming office hours (Sprechstunden) of your lecturers — read-only, booking stays in Stud.IP")
    .argument("[query]", "Course (title/slug/number/id) or lecturer name; default: all current courses")
    .option("--expired", "Include past blocks")
    .option("--slots", "List every free slot time")
    .action(
      act(async (query: string | undefined, opts: { expired?: boolean; slots?: boolean }) => {
        const sdk = await getSdk();
        const now = Date.now();
        const owners = new Map<string, Owner>();

        if (!query) {
          await lecturersOf(sdk, await currentCourses(sdk), owners);
        } else {
          let course: { id: string; title: string } | null = null;
          try {
            course = await resolveCourse(sdk, query);
          } catch (err) {
            if (!(err instanceof ImstudiumError && err.code === "COURSE_NOT_FOUND")) throw err;
          }
          if (course) {
            await lecturersOf(sdk, [course], owners);
            owners.set(`course:${course.id}`, { key: `course:${course.id}`, name: course.title, courses: [], courseId: course.id });
          } else {
            // A lecturer's name: your courses' lecturers first, then Stud.IP's user search.
            await lecturersOf(sdk, await currentCourses(sdk), owners);
            const q = query.toLowerCase();
            for (const [key, o] of owners) if (!o.name.toLowerCase().includes(q)) owners.delete(key);
            if (!owners.size) {
              for (const p of await sdk.people.searchUsers(query, 3)) owners.set(p.id, { key: p.id, name: p.name, courses: [], person: p });
            }
            if (!owners.size) {
              throw new ImstudiumError(`No course or lecturer matches "${query}"`, "NOT_FOUND", 404, "Try a course title or a lecturer's last name");
            }
          }
        }

        const blocks = new Map<string, ConsultationBlockInfo[]>();
        await Promise.all(
          [...owners.values()].map(async (o) => {
            const range = o.courseId ? { type: "courses" as const, id: o.courseId } : { type: "users" as const, id: o.key };
            try {
              const list = await sdk.consultations.list(range, { includeExpired: opts.expired });
              blocks.set(
                o.key,
                list.filter((b) => opts.expired || !b.end || Date.parse(b.end) >= now).map((b) => ({ ...b, owner: o.name })),
              );
            } catch (err) {
              if (isAuthError(err)) throw err;
              if (!o.courseId) note(`Hinweis: ${o.name}: ${err instanceof Error ? err.message : String(err)}`);
              blocks.set(o.key, []);
            }
          }),
        );

        const lines: string[] = [];
        for (const o of owners.values()) {
          const list = blocks.get(o.key) ?? [];
          if (o.courseId && !list.length) continue; // course-level hours are optional
          lines.push(`${o.name}${o.courses.length ? `  (${[...new Set(o.courses)].join(", ")})` : ""}`);
          if (!list.length) lines.push("  keine anstehenden Sprechstunden in Stud.IP");
          for (const b of list) lines.push(...formatBlock(b, now, opts.slots));
          const url = list.length
            ? consultationBookingUrl(sdk.consultations.instanceOrigin, { username: o.person?.username, courseId: o.courseId })
            : null;
          if (url) lines.push(`  Buchen in Stud.IP: ${url}`);
          lines.push("");
        }
        output(
          {
            owners: [...owners.values()].map((o) => ({
              id: o.courseId ?? o.key,
              type: o.courseId ? "course" : "lecturer",
              name: o.name,
              username: o.person?.username ?? null,
              courses: [...new Set(o.courses)],
              blocks: blocks.get(o.key) ?? [],
            })),
          },
          lines.join("\n").trimEnd() || "Keine Sprechstunden gefunden.",
        );
      }),
    );
}
