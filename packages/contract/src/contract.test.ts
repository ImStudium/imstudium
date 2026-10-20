import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CLI_OUTPUTS,
  ContextOutput,
  envelopeV1,
  ErrorBody,
  FEED_SCHEMAS,
  FeedItem,
  findSchema,
  schemaNames,
  SearchOutput,
  SourcePage,
  TodayOutput,
  toJsonSchema,
} from "./index.js";

/** Property names that must never appear in a feed shape (FINISH F3a). */
const CREDENTIAL = /cookie|token|password|passwd|secret|session|authorization|bearer|api_?key/i;

function propertyNames(schema: unknown, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return out;
  const node = schema as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties as Record<string, unknown>)) {
      out.add(k);
      propertyNames(v, out);
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "additionalProperties", "$defs"]) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => propertyNames(x, out));
    else if (v && typeof v === "object") {
      if (key === "$defs") Object.values(v).forEach((x) => propertyNames(x, out));
      else propertyNames(v, out);
    }
  }
  return out;
}

function credentialFields(schema: z.ZodType): string[] {
  return [...propertyNames(z.toJSONSchema(schema, { unrepresentable: "any" }))].filter((n) => CREDENTIAL.test(n));
}

const date = {
  id: "d1",
  courseId: "c".repeat(32),
  courseTitle: "Statistik I",
  start: "2026-10-20T10:00:00+02:00",
  end: "2026-10-20T11:30:00+02:00",
  location: "HS I",
  cancelled: false,
  kind: "lecture" as const,
  category: "Vorlesung",
  typeId: 1,
  description: null,
  recurrence: "Di 10:00",
  source: "ics" as const,
};

describe("CLI output schemas", () => {
  it("every schema renders to JSON Schema", () => {
    for (const name of schemaNames()) {
      const json = toJsonSchema(name);
      expect(json, name).toBeTruthy();
      expect(json!.$schema, name).toMatch(/json-schema/);
    }
  });

  it("v1 envelope adds schemaVersion and keeps payload keys at the top level", () => {
    const payload = { query: "x", count: 0, hits: [] };
    expect(envelopeV1(SearchOutput).parse({ schemaVersion: "1", ...payload })).toMatchObject(payload);
    expect(() => envelopeV1(SearchOutput).parse({ schemaVersion: "2", ...payload })).toThrow();
  });

  it("accepts a synthetic today payload", () => {
    const today = {
      from: "2026-10-20",
      to: "2026-10-20",
      source: "ics",
      stale: true,
      icsUpdatedAt: null,
      warnings: [],
      days: [{ date: "2026-10-20", weekday: 2, label: "Di 20.10.", holiday: null, entries: [date] }],
      date: "2026-10-20",
      entries: [date],
      next: null,
    };
    expect(TodayOutput.parse(today)).toEqual(today);
  });

  it("rejects a context payload with the wrong shape", () => {
    expect(() => ContextOutput.parse({ generatedAt: "x" })).toThrow();
  });

  it("finds schemas by command path, error and feed name", () => {
    expect(findSchema("semester   start")?.name).toBe("semester start");
    expect(findSchema("error")?.schema).toBe(ErrorBody);
    expect(findSchema("feed.FeedItem")?.kind).toBe("feed");
    expect(findSchema("nope")).toBeNull();
    expect(Object.keys(CLI_OUTPUTS)).toEqual(
      expect.arrayContaining(["context", "today", "week", "tasks", "news", "inbox", "forum", "courseware", "search", "changes", "semester", "sync"]),
    );
  });
});

describe("imstudium/source/v1 feed", () => {
  const item = {
    id: "digicampus.uni-augsburg.de:file:abc",
    updated_at: "2026-10-20T08:00:00.000001Z",
    title: "Blatt 1.pdf",
    path: "WS2026-27/statistik-i/files/Blatt 1.pdf",
    fields: { course: "Statistik I", pages: 3, link_only: false, note: null },
    file: {
      name: "Blatt 1.pdf",
      mime: "application/pdf",
      bytes: 1024,
      pages: 3,
      sha256: null,
      studip_etag: null,
      link_only: false,
      terms_of_use: "unknown",
      url: null,
      brain: null,
    },
    web_url: "https://digicampus.uni-augsburg.de/sendfile.php?id=abc",
    app_url: "https://app.imstudium.com/f/abc",
  };

  it("a golden item round-trips through a page", () => {
    const page = { contract: "imstudium/source/v1", scope: "current/materials", items: [item], next_cursor: null, has_more: false };
    expect(SourcePage.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it("v1 never carries a file URL", () => {
    expect(() => FeedItem.parse({ ...item, file: { ...item.file, url: "https://x" } })).toThrow();
  });

  it("rejects scope keys outside the grammar", () => {
    expect(() => SourcePage.parse({ contract: "imstudium/source/v1", scope: "current/secrets", items: [], next_cursor: null, has_more: false })).toThrow();
  });

  it("no feed shape has a credential-shaped field", () => {
    for (const [name, schema] of Object.entries(FEED_SCHEMAS)) {
      expect(credentialFields(schema), name).toEqual([]);
    }
  });

  it("the credential scan catches a planted cookie field", () => {
    expect(credentialFields(FeedItem.extend({ cookie: z.string() }))).toEqual(["cookie"]);
  });
});
