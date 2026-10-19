import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { optionalSince, parseSince } from "./since.js";

const NOW = new Date(2026, 9, 19, 15, 30, 0); // 2026-10-19 15:30 local

describe("parseSince", () => {
  it("reads relative durations", () => {
    assert.equal(parseSince("24h", NOW).getTime(), NOW.getTime() - 24 * 3600_000);
    assert.equal(parseSince("7d", NOW).getTime(), NOW.getTime() - 7 * 86_400_000);
    assert.equal(parseSince("2w", NOW).getTime(), NOW.getTime() - 14 * 86_400_000);
    assert.equal(parseSince("30min", NOW).getTime(), NOW.getTime() - 30 * 60_000);
    assert.equal(parseSince("90m", NOW).getTime(), NOW.getTime() - 90 * 60_000);
    assert.equal(parseSince(" 3D ", NOW).getTime(), NOW.getTime() - 3 * 86_400_000);
  });

  it("reads months, today and yesterday", () => {
    const mo = parseSince("1mo", NOW);
    assert.equal(mo.getMonth(), 8);
    assert.equal(mo.getDate(), 19);
    assert.deepEqual(parseSince("today", NOW), new Date(2026, 9, 19));
    assert.deepEqual(parseSince("yesterday", NOW), new Date(2026, 9, 18));
  });

  it("reads dates and timestamps", () => {
    assert.deepEqual(parseSince("2026-10-01", NOW), new Date(2026, 9, 1));
    assert.equal(parseSince("2026-10-01T08:00:00Z", NOW).toISOString(), "2026-10-01T08:00:00.000Z");
  });

  it("rejects nonsense with a hint", () => {
    assert.throws(() => parseSince("soon", NOW), /Cannot read --since/);
    assert.throws(() => parseSince("2026-02-31", NOW), /Cannot read --since/);
  });

  it("passes undefined through", () => {
    assert.equal(optionalSince(undefined), undefined);
  });
});
