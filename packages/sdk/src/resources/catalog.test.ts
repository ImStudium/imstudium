import { describe, expect, it } from "vitest";
import { Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import {
  CatalogResource,
  normalizeCatalogCourse,
  normalizeCatalogDetails,
  normalizeModule,
  normalizeStudyArea,
  studyAreaNodeId,
} from "./catalog.js";
import { COURSE_A, fakeClient, LECTURER } from "../test/planning-fixtures.js";

describe("catalog normalisers", () => {
  it("reads a course with sem-type and members-count meta", () => {
    const course: JsonApiResource = {
      type: "courses",
      id: COURSE_A,
      attributes: { "course-number": "1001", title: "Beispielkurs", "course-type": 1 },
      relationships: {
        "sem-type": { data: { type: "sem-types", id: "1" } },
        "start-semester": { data: { type: "semesters", id: "sem1" } },
      },
      meta: { "members-count": 42 },
    };
    const c = normalizeCatalogCourse(course, new Included([{ type: "sem-types", id: "1", attributes: { name: "Vorlesung" } }]), "https://studip.example.test");
    expect(c).toMatchObject({ number: "1001", title: "Beispielkurs", typeName: "Vorlesung", memberCount: 42, semesterId: "sem1" });
    expect(c.url).toBe(`https://studip.example.test/dispatch.php/course/details?sem_id=${COURSE_A}`);
  });

  it("reads the public course details (lecturers, dates HTML)", () => {
    const d = normalizeCatalogDetails(COURSE_A, {
      semester: "WS 2026/27",
      lecturers: [{ id: LECTURER, username: "abeispiel", name: "Dr. Ada Beispiel" }],
      admissionstate: null,
      dates: '<ul class="list-unstyled"><li>\n  Dienstag, 14:00 - 15:30, Wöchentlich (ab dem 13.10.26), <em>Raum 1</em>  </li><li>Mittwoch, 10:00 - 11:30</li></ul>',
    });
    expect(d.lecturers.map((l) => l.name)).toEqual(["Dr. Ada Beispiel"]);
    expect(d.dates).toEqual(["Dienstag, 14:00 - 15:30, Wöchentlich (ab dem 13.10.26), _Raum 1_", "Mittwoch, 10:00 - 11:30"]);
  });

  it("reads tree-node study areas with their path", () => {
    const area = normalizeStudyArea({
      type: "tree-node",
      id: "StudipStudyArea_abc",
      attributes: {
        id: "abc",
        name: "Informatik",
        description: "",
        "has-children": true,
        ancestors: [
          { id: "root", name: "Campus", classname: "StudipStudyArea" },
          { id: "fac", name: "Fakultät", classname: "StudipStudyArea" },
          { id: "abc", name: "Informatik", classname: "StudipStudyArea" },
        ],
      },
    });
    expect(area).toEqual({ id: "abc", name: "Informatik", description: null, hasChildren: true, path: ["Fakultät", "Informatik"] });
    expect(studyAreaNodeId()).toBe("StudipStudyArea_root");
    expect(studyAreaNodeId("abc")).toBe("StudipStudyArea_abc");
    expect(studyAreaNodeId("StudipStudyArea_abc")).toBe("StudipStudyArea_abc");
  });

  it("reads modules", () => {
    expect(
      normalizeModule({ type: "modules", id: "m1", attributes: { code: "INF-1", name: "Beispielmodul", cp: 5, cycle: "jedes Semester", responsible: "<p>Lehrstuhl X</p>" } }),
    ).toMatchObject({ code: "INF-1", name: "Beispielmodul", cp: 5, cycle: "jedes Semester", responsible: "Lehrstuhl X" });
  });
});

describe("CatalogResource (fake client)", () => {
  it("searches the public catalog tree with semester + recursive filters", async () => {
    const { client, calls } = fakeClient((path) => {
      if (path === "/tree-node/StudipStudyArea_root/courses") {
        return {
          body: {
            data: [{ type: "courses", id: COURSE_A, attributes: { title: "Beispielkurs", "course-number": "1001" }, relationships: { "sem-type": { data: { type: "sem-types", id: "1" } } }, meta: { "members-count": 3 } }],
            included: [{ type: "sem-types", id: "1", attributes: { name: "Seminar" } }],
            meta: { page: { offset: 0, limit: 5, total: 1 } },
          },
        };
      }
      return undefined;
    });
    const res = await new CatalogResource(client).search({ q: "Beispiel", semesterId: "sem1", limit: 5 });
    expect(res.source).toBe("tree");
    expect(res.total).toBe(1);
    expect(res.courses[0]).toMatchObject({ title: "Beispielkurs", typeName: "Seminar", memberCount: 3 });
    const q = new URL(`https://x${calls[0]}`).searchParams;
    expect(q.get("filter[q]")).toBe("Beispiel");
    expect(q.get("filter[semester]")).toBe("sem1");
    expect(q.get("filter[recursive]")).toBe("1");
    await expect(new CatalogResource(client).search({ q: "ab" })).rejects.toThrow(/at least 3/);
  });

});

