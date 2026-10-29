import { describe, expect, it } from "vitest";
import { joinPagesFormFeed, splitMarkdownPages } from "./local-docs.js";

describe("splitMarkdownPages", () => {
  it("splits form feeds", () => {
    expect(splitMarkdownPages("page one\fpage two")).toEqual(["page one", "page two"]);
  });

  it("splits horizontal rules", () => {
    expect(splitMarkdownPages("# S1\n\nHi\n\n---\n\n# S2\n\nThere")).toHaveLength(2);
  });

  it("keeps a single page", () => {
    expect(splitMarkdownPages("# Doc\n\nHello")).toEqual(["# Doc\n\nHello"]);
  });
});

describe("joinPagesFormFeed", () => {
  it("rejoins for vault-style splitters", () => {
    const md = joinPagesFormFeed([
      { index: 0, markdown: "A" },
      { index: 1, markdown: "B" },
    ]);
    expect(splitMarkdownPages(md)).toEqual(["A", "B"]);
  });
});
