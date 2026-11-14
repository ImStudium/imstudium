import { describe, expect, it } from "vitest";
import { DOCTOR_CHECKS } from "./doctor.js";

/** The semester check against a fake Stud.IP: roll over only once there are courses in the new semester. */

const check = DOCTOR_CHECKS.find((c) => c.id === "semester")!;
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

const ws = (end: string) =>
  ({ activeSemester: { id: "s-old", title: "SoSe 2026", slug: "SoSe-2026", end } }) as never;

function sdk(courses: number | "signed-out" | "error") {
  return {
    courses: {
      semesters: {
        listAll: async () => [
          { id: "s-old", attributes: { title: "SoSe 2026", start: iso(-200), end: iso(-20) } },
          { id: "s-new", attributes: { title: "WiSe 2026/27", start: iso(-19), end: iso(150) } },
        ],
      },
      listMine: async (_q: unknown, o: { semesterId: string }) => {
        if (courses === "error") throw new Error("synthetic");
        expect(o.semesterId).toBe("s-new");
        return Array.from({ length: courses as number }, (_, i) => ({ id: `c${i}` }));
      },
    },
    auth: { loadSession: async () => (courses === "signed-out" ? null : { type: "cookie" }) },
  } as never;
}

const run = (s: unknown, offline = false) => check.run({ sdk: s as never, ws: ws(iso(-20)), offline, workspace: "/synthetic", setup: Promise.resolve({} as never) });

describe("doctor semester", () => {
  it("0 courses in the new semester: ok, stays, no semester start", async () => {
    const r = await run(sdk(0));
    expect(r).toMatchObject({ status: "ok", fix: null, data: { enrolled: 0, studip: expect.stringMatching(/WiSe/) } });
    expect(r.detail).toMatch(/no courses in WiSe 2026\/27/);
  });

  it("courses in the new semester: semester start", async () => {
    expect(await run(sdk(3))).toMatchObject({ status: "warn", fix: "imstudium semester start", data: { enrolled: 3 } });
    expect((await run(sdk(3))).detail).toMatch(/3 courses there/);
  });

  it("signed out or unreadable: semester start as before", async () => {
    expect(await run(sdk("signed-out"))).toMatchObject({ status: "warn", fix: "imstudium semester start", data: { enrolled: null } });
    expect(await run(sdk("error"))).toMatchObject({ status: "warn", fix: "imstudium semester start" });
  });

  it("offline with an ended semester points to semester status, which knows about enrolment", async () => {
    expect(await run(sdk(0), true)).toMatchObject({ status: "warn", fix: "imstudium semester" });
  });
});
