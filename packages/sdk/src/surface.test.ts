import { describe, expect, it } from "vitest";
import * as sdk from "./index.js";

/**
 * The SDK's runtime surface is an API decision. This snapshot fails when an
 * export appears or disappears; update it on purpose (vitest -u) and note
 * the change in CHANGELOG.md.
 */
describe("@imstudium/sdk public surface", () => {
  it("exports exactly the intended runtime names", async () => {
    await expect(Object.keys(sdk).sort().join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/surface.txt");
  });

  it("keeps HTML/UI and plumbing internal", () => {
    for (const name of ["escapeHtml", "designSystemStyles", "buildLoginHelperHtml", "readRequestBody", "parseFormBody", "cachedJson", "UNKNOWN_PERSON", "normalizeNews", "wireDoneIcon"]) {
      expect(name in sdk, name).toBe(false);
    }
  });
});
