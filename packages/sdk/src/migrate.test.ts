import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { convertLegacyManifest } from "./migrate.js";

describe("convertLegacyManifest", () => {
  it("renames digicampusVersion to imstudiumVersion", () => {
    const converted = convertLegacyManifest({
      schemaVersion: "1",
      digicampusVersion: "0.1.0",
      workspace: "~/Studium",
    });
    assert.equal(converted.imstudiumVersion, "0.1.0");
    assert.equal(converted.digicampusVersion, undefined);
  });

  it("keeps existing imstudiumVersion", () => {
    const converted = convertLegacyManifest({
      imstudiumVersion: "0.2.0",
      digicampusVersion: "0.1.0",
    });
    assert.equal(converted.imstudiumVersion, "0.2.0");
  });
});
