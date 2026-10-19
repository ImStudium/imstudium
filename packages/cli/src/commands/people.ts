import type { Command } from "commander";
import type { CoursePeople, CoursePerson } from "@imstudium/sdk";
import { act, getSdk, note, output } from "../runtime.js";
import { currentCourses, resolveCourse } from "../course-arg.js";

function names(people: CoursePerson[]): string {
  return people.map((p) => p.name).join(", ");
}

/** Human block for one course. Students appear only as a count. */
export function formatCoursePeople(title: string, r: CoursePeople): string[] {
  const lines = [title, `  Lehrende:     ${r.lecturers.length ? names(r.lecturers) : "—"}`];
  if (r.tutors.length) lines.push(`  Tutor:innen:  ${names(r.tutors)}`);
  if (r.groups.length) {
    lines.push(`  Gruppen:      ${r.groups.map((g) => `${g.name}${g.capacity ? ` (max ${g.capacity})` : ""}`).join(", ")}`);
  }
  const students = r.studentCount != null ? `${r.studentCount} Studierende` : null;
  const members = r.memberCount != null ? `${r.memberCount} Mitglieder gesamt` : null;
  if (students || members) lines.push(`  Teilnehmende: ${[students, members].filter(Boolean).join(" · ")}`);
  return lines;
}

export function registerPeople(program: Command): void {
  program
    .command("people")
    .description("Who teaches what: lecturers, tutors, groups and student count per course")
    .argument("[course]", "Course title fragment, slug, number or id (default: all current courses)")
    .action(
      act(async (courseArg?: string) => {
        const sdk = await getSdk();
        const courses = courseArg ? [await resolveCourse(sdk, courseArg)] : await currentCourses(sdk);
        const results = await Promise.all(
          courses.map(async (c) => ({ title: c.title, people: await sdk.people.coursePeople(c.id) })),
        );
        const lines: string[] = [];
        for (const { title, people } of results) {
          lines.push(...formatCoursePeople(title, people), "");
          for (const w of people.warnings) note(`Hinweis (${title}): ${w}`);
        }
        output(
          {
            courses: results.map(({ title, people }) => ({
              courseId: people.courseId,
              title,
              lecturers: people.lecturers,
              tutors: people.tutors,
              groups: people.groups,
              studentCount: people.studentCount,
              memberCount: people.memberCount,
              source: people.source,
            })),
          },
          lines.join("\n").trimEnd() || "Keine Veranstaltungen.",
        );
      }),
    );
}
