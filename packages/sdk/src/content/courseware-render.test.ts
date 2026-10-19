import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizeBlock, type CwBlock, type CwFile } from "../resources/courseware.js";
import { assignFileNames, containerLayout, renderBlock, type BlockRenderContext } from "./courseware-render.js";
import { normalizeContainer } from "../resources/courseware.js";
import { block, CH1, CH2, container, COURSE, FILE_HIDDEN, FILE_IMG, FILE_PDF, hid, UNIT } from "../test/content-fixtures.js";
import { htmlToMarkdown, studipMarkupToMarkdown } from "./markdown.js";

const ORIGIN = "https://studip.example.org";

const files: Record<string, CwFile> = {
  [FILE_PDF]: { id: FILE_PDF, name: "lecture-01.pdf", size: 2_500_000, mimeType: "application/pdf", chdate: null, downloadable: true },
  [FILE_IMG]: { id: FILE_IMG, name: "diagram.png", size: 50_000, mimeType: "image/png", chdate: null, downloadable: true },
  [FILE_HIDDEN]: { id: FILE_HIDDEN, name: "solutions.pdf", size: 1000, mimeType: "application/pdf", chdate: null, downloadable: false },
};

function ctx(over: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    origin: ORIGIN,
    courseId: COURSE,
    unitId: UNIT,
    headingLevel: 2,
    elementPaths: { [CH1]: "01-chapter-one.md", [CH2]: "02-chapter-two.md" },
    elementTitles: { [CH1]: "Chapter one", [CH2]: "Chapter two" },
    children: { [CH1]: [CH2] },
    files,
    fileNames: assignFileNames(files),
    elementId: CH1,
    ...over,
  };
}

const b = (type: string, payload: Record<string, unknown>): CwBlock => normalizeBlock(block(hid(type), type, payload));

describe("renderBlock", () => {
  it("text: tables, images, code and TeX survive", () => {
    const md = renderBlock(
      b("text", {
        text:
          '<p>Intro &amp; <strong>key</strong> idea \\(a^2+b^2\\)</p><table><tr><th>Term</th><th>Meaning</th></tr><tr><td>SQL</td><td>a | query language</td></tr></table>' +
          '<pre><code class="language-python">def f(x):\n    return x &lt; 2</code></pre><img src="/sendfile.php?id=1" alt="Plot">',
      }),
      ctx(),
    ).markdown;
    assert.match(md, /Intro & \*\*key\*\* idea \$a\^2\+b\^2\$/);
    assert.match(md, /\| Term \| Meaning \|\n\| --- \| --- \|\n\| SQL \| a \\\| query language \|/);
    assert.match(md, /```python\ndef f\(x\):\n {4}return x < 2\n```/);
    assert.match(md, /!\[Plot\]\(https:\/\/studip\.example\.org\/sendfile\.php\?id=1\)/);
  });

  it("headline, key-point, code, typewriter, confirm, date", () => {
    assert.equal(renderBlock(b("headline", { title: "Big idea", subtitle: "why" }), ctx()).markdown, "### Big idea\n\n_why_");
    assert.equal(renderBlock(b("key-point", { text: "Remember this" }), ctx()).markdown, "> **Key point:** Remember this");
    assert.equal(renderBlock(b("code", { content: "SELECT 1;\n", lang: "sql" }), ctx()).markdown, "```sql\nSELECT 1;\n```");
    assert.equal(renderBlock(b("typewriter", { text: "Hello" }), ctx()).markdown, "Hello");
    assert.equal(renderBlock(b("confirm", { text: "I read it" }), ctx()).markdown, "- [ ] I read it");
    assert.match(renderBlock(b("date", { timestamp: Date.UTC(2026, 11, 1, 9, 0), style: "countdown" }), ctx()).markdown, /^\*\*Date:\*\* 2026-12-01 \d\d:00 \(countdown\)$/);
  });

  it("links: internal pages resolve to sibling files, external stay external", () => {
    assert.equal(renderBlock(b("link", { type: "internal", target: CH2, title: "" }), ctx()).markdown, "**Link:** [Chapter two](./02-chapter-two.md)");
    assert.equal(renderBlock(b("link", { type: "external", url: "https://example.org/x", title: "Docs" }), ctx()).markdown, "**Link:** [Docs](https://example.org/x)");
  });

  it("file blocks link into files/ and request downloads; view-only stays online", () => {
    const dl = renderBlock(b("download", { title: "Slides", file_id: FILE_PDF, info: "Week 1" }), ctx());
    assert.equal(dl.markdown, "**Download:** [Slides](files/lecture-01.pdf) (2.4 MB)\n\nWeek 1");
    assert.deepEqual(dl.files, [FILE_PDF]);
    const doc = renderBlock(b("document", { title: "Reader", file_id: FILE_PDF, downloadable: "false" }), ctx());
    assert.match(doc.markdown, /view only in Stud\.IP/);
    assert.deepEqual(doc.files, []);
    const hidden = renderBlock(b("download", { title: "Solutions", file_id: FILE_HIDDEN }), ctx());
    assert.deepEqual(hidden.files, []);
    const video = renderBlock(b("video", { title: "Recording", source: "web", web_url: "https://video.example.org/1" }), ctx());
    assert.equal(video.markdown, "**Video:** [Recording](https://video.example.org/1)");
    const img = renderBlock(b("image-map", { file_id: FILE_IMG, shapes: [{ title: "Area A" }] }), ctx());
    assert.equal(img.markdown, "![Image map](files/diagram.png)\n- Area A");
  });

  it("folder blocks list files (no second download) but never the uploader's name", () => {
    const r = renderBlock(
      b("folder", {
        title: "Material",
        "folder-type": "StandardFolder",
        files: [{ id: FILE_PDF, attributes: { name: "lecture-01.pdf", filesize: 2_500_000 }, relationships: { owner: { meta: { name: "Synthetic Person" } } } }],
      }),
      ctx(),
    );
    assert.equal(r.markdown, "**Folder:** Material _(in the course files)_\n- lecture-01.pdf (2.4 MB)");
    assert.deepEqual(r.files, []);
    assert.ok(!r.markdown.includes("Synthetic Person"));
    const hw = renderBlock(b("folder", { title: "Hand-in", "folder-type": "HomeworkFolder", files: [{ id: FILE_PDF }] }), ctx());
    assert.deepEqual(hw.files, []);
  });

  it("table of contents lists child pages; flashcards, timeline, chart render as text", () => {
    assert.equal(renderBlock(b("table-of-contents", { title: "Overview" }), ctx()).markdown, "**Overview**\n\n- [Chapter two](./02-chapter-two.md)");
    const cards = renderBlock(b("dialog-cards", { cards: [{ front_text: "2+2?", back_text: "4" }] }), ctx()).markdown;
    assert.equal(cards, "**Flashcards:**\n\n1. **Q:** 2+2?\n   **A:** 4");
    const tl = renderBlock(b("timeline", { items: [{ date: "1990", title: "Start", description: "<p>begin</p>" }] }), ctx()).markdown;
    assert.equal(tl, "**Timeline:**\n\n- **1990** Start — begin");
    const chart = renderBlock(b("chart", { type: "bar", label: "Votes", content: [{ label: "A", value: "3" }] }), ctx()).markdown;
    assert.equal(chart, "**Chart (bar):** Votes\n\n| Label | Value |\n| --- | --- |\n| A | 3 |");
  });

  it("never leaks LTI secrets and falls back for unknown blocks", () => {
    const lti = renderBlock(b("lti", { title: "Quiz tool", consumer_key: "k", consumer_secret: "s3cret" }), ctx()).markdown;
    assert.ok(!lti.includes("s3cret"));
    assert.equal(renderBlock(b("plugin-thing", { title: "Fancy" }), ctx()).markdown, "> [block plugin-thing] Fancy");
  });
});

describe("containers and helpers", () => {
  it("lays out accordion sections, then unsectioned blocks by position", () => {
    const c = normalizeContainer(container(hid("acc"), CH1, "accordion", ["x1", "x2", "x3"], [{ name: "One", blocks: ["x2"] }]));
    const blocks = Object.fromEntries(
      ["x1", "x2", "x3"].map((id, i) => [id, { ...normalizeBlock(block(id, "text", { text: id }, 2 - i)), id }]),
    );
    const groups = containerLayout(c, blocks);
    assert.deepEqual(groups.map((g) => [g.name, g.blocks.map((x) => x.id)]), [["One", ["x2"]], ["", ["x3", "x1"]]]);
  });

  it("assigns unique, safe file names", () => {
    const names = assignFileNames({
      a: { id: "aaaaaa11", name: "notes.pdf", size: 1, mimeType: null, chdate: null, downloadable: true },
      b: { id: "bbbbbb22", name: "notes.pdf", size: 1, mimeType: null, chdate: null, downloadable: true },
      c: { id: "cccccc33", name: "a/b:c.pdf", size: 1, mimeType: null, chdate: null, downloadable: true },
    });
    assert.deepEqual(Object.values(names).sort(), ["files/a_b_c.pdf", "files/notes-bbbbbb.pdf", "files/notes.pdf"]);
  });

  it("converts legacy wiki markup", () => {
    const md = studipMarkupToMarkdown("!!!Title\n- item\n%%it%% [[Other Page|other]] [site]https://example.org", (n) => (n === "Other Page" ? "./other-page.md" : null));
    assert.equal(md, "## Title\n- item\n_it_ [other](./other-page.md) [site](https://example.org)");
    assert.equal(htmlToMarkdown("<ol><li>a</li><li>b</li></ol>"), "1. a\n2. b");
  });
});
