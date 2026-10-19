import { describe, expect, it } from "vitest";
import { Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { consultationBookingUrl, ConsultationsResource, normalizeConsultationBlock } from "./consultations.js";
import { fakeClient, LECTURER } from "../test/planning-fixtures.js";

describe("consultations", () => {
  it("normalises blocks with slots (snake_case start_time quirk) and counts free slots", () => {
    const block: JsonApiResource = {
      type: "consultation-blocks",
      id: "b1",
      attributes: { start: "2026-10-21T14:00:00+02:00", end: "2026-10-21T15:00:00+02:00", size: 1, room: "Raum 1", note: "Bitte vorher anmelden" },
      relationships: {
        slots: { data: [{ type: "consultation-slots", id: "s1" }, { type: "consultation-slots", id: "s2" }] },
        range: { data: { type: "users", id: LECTURER } },
      },
    };
    const slots: JsonApiResource[] = [
      {
        type: "consultation-slots",
        id: "s2",
        attributes: { start_time: "2026-10-21T14:30:00+02:00", end_time: "2026-10-21T15:00:00+02:00", "is-bookable": false, "is-locked": false },
        relationships: { bookings: { data: [{ type: "consultation-bookings", id: "x" }] } },
      },
      {
        type: "consultation-slots",
        id: "s1",
        attributes: { start_time: "2026-10-21T14:00:00+02:00", end_time: "2026-10-21T14:30:00+02:00", "is-bookable": true, "is-locked": false },
        relationships: { bookings: { data: [] } },
      },
    ];
    const b = normalizeConsultationBlock(block, new Included(slots));
    expect(b.rangeType).toBe("users");
    expect(b.slots.map((s) => [s.id, s.bookable, s.bookings, s.free])).toEqual([
      ["s1", true, 0, 1],
      ["s2", false, 1, 0],
    ]);
    expect(b.freeSlots).toBe(1);
    expect(b.room).toBe("Raum 1");
  });
});

describe("ConsultationsResource (fake client)", () => {
  it("asks for current consultation blocks with slots included", async () => {
    const { client, calls } = fakeClient((path) =>
      path === `/users/${LECTURER}/consultations` ? { body: { data: [], meta: { page: { total: 0 } } } } : undefined,
    );
    await new ConsultationsResource(client).list({ type: "users", id: LECTURER });
    const q = new URL(`https://x${calls[0]}`).searchParams;
    expect(q.get("filter[current]")).toBe("1");
    expect(q.get("include")).toBe("slots");
  });

  it("links to the Stud.IP booking page instead of booking", () => {
    expect(consultationBookingUrl("https://studip.example.test/", { username: "a.beispiel" })).toBe(
      "https://studip.example.test/dispatch.php/consultation/overview?username=a.beispiel",
    );
    expect(consultationBookingUrl("https://studip.example.test", { courseId: "c1" })).toBe(
      "https://studip.example.test/dispatch.php/consultation/overview?cid=c1",
    );
    expect(consultationBookingUrl("https://studip.example.test", {})).toBeNull();
  });
});

