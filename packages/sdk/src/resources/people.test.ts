import { describe, expect, it } from "vitest";
import { Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { normalizePerson, normalizeStatusGroup, PeopleResource } from "./people.js";
import { COURSE_A, fakeClient, LECTURER, TUTOR } from "../test/planning-fixtures.js";

describe("people normalisers", () => {
  it("builds a person from a membership + included user", () => {
    const membership: JsonApiResource = {
      type: "course-memberships",
      id: "m1",
      attributes: { permission: "dozent", position: 0, label: "Modulverantwortung" },
      relationships: { user: { data: { type: "users", id: LECTURER } } },
    };
    const user: JsonApiResource = {
      type: "users",
      id: LECTURER,
      attributes: { "formatted-name": "Dr. Ada Beispiel", username: "abeispiel", email: "ada@example.test" },
    };
    expect(normalizePerson(membership, new Included([user]))).toEqual({
      id: LECTURER,
      name: "Dr. Ada Beispiel",
      username: "abeispiel",
      email: "ada@example.test",
      label: "Modulverantwortung",
      position: 0,
    });
  });

  it("reads status groups; size 0 = unlimited", () => {
    expect(
      normalizeStatusGroup({
        type: "status-groups",
        id: "g1",
        attributes: { name: "Übung 1", size: 0, position: 2, selfassign: true, "selfassign-start": null },
      }),
    ).toMatchObject({ name: "Übung 1", capacity: null, selfAssign: true, position: 2 });
  });
});

describe("PeopleResource (fake client)", () => {
  it("returns lecturers/tutors by name but students only as a count", async () => {
    const { client, calls } = fakeClient((path, q) => {
      if (path === `/courses/${COURSE_A}/memberships`) {
        const perm = q.get("filter[permission]");
        if (perm === "dozent" || perm === "tutor") {
          const uid = perm === "dozent" ? LECTURER : TUTOR;
          return {
            body: {
              data: [{ type: "course-memberships", id: `m-${perm}`, attributes: { permission: perm, position: 0 }, relationships: { user: { data: { type: "users", id: uid } } } }],
              included: [{ type: "users", id: uid, attributes: { "formatted-name": perm === "dozent" ? "Dr. Ada Beispiel" : "Tutor Test" } }],
              meta: { page: { offset: 0, limit: 100, total: 1 } },
            },
          };
        }
        if (perm === "autor") {
          expect(q.get("include")).toBeNull();
          return { body: { data: [{ type: "course-memberships", id: "s", attributes: {} }], meta: { page: { offset: 0, limit: 1, total: 137 } } } };
        }
      }
      if (path === `/courses/${COURSE_A}/status-groups`) {
        return { body: { data: [{ type: "status-groups", id: "g", attributes: { name: "Übung A", size: 25, position: 0 } }] } };
      }
      if (path === `/courses/${COURSE_A}`) {
        return { body: { data: { type: "courses", id: COURSE_A, attributes: { title: "x" }, meta: { "members-count": 140 } } } };
      }
      return undefined;
    });
    const people = await new PeopleResource(client).coursePeople(COURSE_A);
    expect(people.lecturers.map((p) => p.name)).toEqual(["Dr. Ada Beispiel"]);
    expect(people.tutors.map((p) => p.name)).toEqual(["Tutor Test"]);
    expect(people.studentCount).toBe(137);
    expect(people.memberCount).toBe(140);
    expect(people.groups).toEqual([expect.objectContaining({ name: "Übung A", capacity: 25 })]);
    expect(people.source).toBe("memberships");
    // The student count request never asks for user records.
    expect(calls.some((c) => c.includes("filter%5Bpermission%5D=autor") && c.includes("include"))).toBe(false);
  });

  it("falls back to the public course details for lecturers when memberships are forbidden", async () => {
    const { client } = fakeClient((path) => {
      if (path === `/courses/${COURSE_A}/memberships`) return { status: 403, body: { errors: [{ status: "403", title: "Forbidden" }] } };
      if (path === `/tree-node/course/details/${COURSE_A}`) {
        return {
          contentType: "application/json",
          body: { semester: "WS 2026/27", lecturers: [{ id: LECTURER, username: "abeispiel", name: "Dr. Ada Beispiel" }], dates: "" },
        };
      }
      return { status: 403, body: { errors: [{ status: "403", title: "Forbidden" }] } };
    });
    const resource = new PeopleResource(client);
    const people = await resource.coursePeople(COURSE_A);
    expect(people.source).toBe("public");
    expect(people.lecturers.map((p) => p.name)).toEqual(["Dr. Ada Beispiel"]);
    expect(people.studentCount).toBeNull();
    expect(people.warnings.length).toBeGreaterThan(0);
    expect((await resource.lecturers(COURSE_A)).map((p) => p.username)).toEqual(["abeispiel"]);
  });
});

