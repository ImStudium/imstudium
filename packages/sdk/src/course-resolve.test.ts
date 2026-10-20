import { describe, expect, it } from "vitest";
import { pickCourse, resolveCourseQuery, resolveWorkspaceCourse } from "./workspace-path.js";
import type { StudiumWorkspace } from "./types.js";

const ID_STAT = "0123456789abcdef0123456789abcdef";

function ws(): StudiumWorkspace {
  const course = (id: string, title: string, slug: string, semesterId = "ws26", semester = "WS 2026/27") =>
    ({ id, title, slug, semesterId, semester, schedule: [], examDates: [], fileCount: 0, folderCount: 0 }) as StudiumWorkspace["courses"][number];
  return {
    activeSemester: { id: "ws26" },
    courses: [
      course(ID_STAT, "Statistik II", "statistik-ii"),
      course("b".repeat(32), "Statistik für Informatiker", "statistik-fur-informatiker"),
      course("c".repeat(32), "Natural Language Processing", "natural-language-processing"),
      course("d".repeat(32), "Datenbanken", "datenbanken", "ss26", "SS 2026"),
      course("e".repeat(32), "Datenbanken", "datenbanken", "ws26"),
    ],
  } as unknown as StudiumWorkspace;
}

describe("course resolver (P-006)", () => {
  it("course by 32-hex id", () => {
    expect(resolveWorkspaceCourse(ws(), ID_STAT).title).toBe("Statistik II");
  });

  it("course by alias", () => {
    expect(resolveWorkspaceCourse(ws(), "nlp", { nlp: "natural language processing" }).title).toBe("Natural Language Processing");
  });

  it("course by unique title fragment", () => {
    expect(resolveWorkspaceCourse(ws(), "informatiker").title).toBe("Statistik für Informatiker");
  });

  it("exact course title beats fragments", () => {
    expect(resolveWorkspaceCourse(ws(), "statistik ii").id).toBe(ID_STAT);
  });

  it("ambiguous course fragment → COURSE_AMBIGUOUS with candidates, never a silent first match", () => {
    let err: unknown;
    try {
      resolveWorkspaceCourse(ws(), "statistik");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "COURSE_AMBIGUOUS", exitCode: 5 });
    const candidates = (err as { details: { candidates: Array<{ id: string; title: string }> } }).details.candidates;
    expect(candidates.map((c) => c.title).sort()).toEqual(["Statistik II", "Statistik für Informatiker"]);
    expect(() => pickCourse(ws(), "statistik")).toThrow(/matches 2 courses/);
  });

  it("same course in several terms: the focus semester decides", () => {
    expect(resolveWorkspaceCourse(ws(), "datenbanken").id).toBe("e".repeat(32));
  });

  it("unknown course → COURSE_NOT_FOUND with the available titles; pickCourse → undefined", () => {
    expect(() => resolveWorkspaceCourse(ws(), "chemie")).toThrow(expect.objectContaining({ code: "COURSE_NOT_FOUND" }));
    expect(pickCourse(ws(), "chemie")).toBeUndefined();
  });

  it("live course candidates: course number and newest enrollment of one title", () => {
    const live = [
      { id: "1", title: "Analysis", slug: "analysis", courseNumber: "MTH-101" },
      { id: "2", title: "Analysis", slug: "analysis", courseNumber: "MTH-101b" },
      { id: "3", title: "Lineare Algebra", slug: "lineare-algebra", courseNumber: "MTH-102" },
    ];
    expect(resolveCourseQuery(live, "mth-102").id).toBe("3");
    expect(resolveCourseQuery(live, "analysis").id).toBe("2");
    expect(() => resolveCourseQuery(live, "a")).toThrow(expect.objectContaining({ code: "COURSE_AMBIGUOUS" }));
  });
});
