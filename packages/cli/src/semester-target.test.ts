import { describe, expect, it } from "vitest";
import { workspaceSyncOptions } from "./commands/workspace.js";
import type { Sdk } from "./runtime.js";

/** Just enough SDK for workspaceSyncOptions: a config and a studium.json loader. */
function fakeSdk(opts: { pinned?: string; workspaceSemester?: string | null }): Sdk {
  return {
    config: { semesterId: opts.pinned },
    studium: {
      loadWorkspace: async () =>
        opts.workspaceSemester === null ? null : { activeSemester: { id: opts.workspaceSemester, title: "SS 2026", slug: "SS2026" } },
    },
  } as unknown as Sdk;
}

describe("which semester a sync targets", () => {
  it("stays on the workspace's semester — a rollover is semester start's job", async () => {
    expect(await workspaceSyncOptions(fakeSdk({ workspaceSemester: "ss26" }), "/w", {})).toEqual({ semesterId: "ss26" });
  });

  it("explicit flags and a pinned config still win", async () => {
    const sdk = fakeSdk({ workspaceSemester: "ss26", pinned: "pinned" });
    expect(await workspaceSyncOptions(sdk, "/w", {})).toEqual({ semesterId: "pinned" });
    expect(await workspaceSyncOptions(sdk, "/w", { semester: "WS 2026/27" })).toEqual({ semesterLabel: "WS 2026/27" });
    expect(await workspaceSyncOptions(sdk, "/w", { allSemesters: true })).toEqual({ allSemesters: true });
  });

  it("a fresh folder (no studium.json) follows the calendar", async () => {
    expect(await workspaceSyncOptions(fakeSdk({ workspaceSemester: null }), "/w", {})).toEqual({});
  });
});
