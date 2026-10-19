import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  buildElementTree,
  normalizeBlock,
  normalizeContainer,
  normalizeElement,
  normalizeTask,
  normalizeUnit,
  type CoursewareUnitContent,
} from "../resources/courseware.js";
import { normalizeWikiPage, renderWiki, writeWiki } from "../resources/wiki.js";
import { renderUnit } from "./courseware-render.js";
import { renderCoursewareIndex, writeCoursewareUnit } from "./courseware-write.js";
import { parseFrontmatter } from "./markdown.js";
import { syncContent, type ContentSyncDeps } from "./sync-content.js";
import {
  block,
  CH1,
  CH2,
  container,
  COURSE,
  element,
  FILE_PDF,
  hid,
  ROOT,
  task,
  taskGroup,
  UNIT,
  unitResource,
  wikiPage,
} from "../test/content-fixtures.js";

const ORIGIN = "https://studip.example.org";

function unitContent(withSecond = true): CoursewareUnitContent {
  const root = element(ROOT, "Week 1: Basics", 0, null);
  const unit = normalizeUnit(unitResource(), [root]);
  const els = [normalizeElement(element(CH1, "Relational model", 0, ROOT))];
  if (withSecond) els.push(normalizeElement(element(CH2, "SQL queries", 1, ROOT)));
  const c1 = normalizeContainer(container(hid("c1"), CH1, "list", [hid("b1"), hid("b2")]));
  return {
    courseId: COURSE,
    unit,
    elements: buildElementTree(normalizeElement(root), els),
    containers: { [CH1]: [c1], [CH2]: [], [ROOT]: [] },
    blocks: {
      [hid("b1")]: normalizeBlock(block(hid("b1"), "text", { text: "<p>Tables have rows.</p>" }, 0, hid("c1"))),
      [hid("b2")]: normalizeBlock(block(hid("b2"), "download", { title: "Slides", file_id: FILE_PDF }, 1, hid("c1"))),
    },
    files: {
      [FILE_PDF]: { id: FILE_PDF, name: "slides.pdf", size: 11, mimeType: "application/pdf", chdate: "2026-10-04T08:30:00+02:00", downloadable: true },
    },
    errors: [],
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "imstudium-content-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderUnit", () => {
  it("one file per page, numbered in reading order, with frontmatter and Stud.IP link", () => {
    const r = renderUnit(unitContent(), { origin: ORIGIN });
    assert.equal(r.slug, "week-1-basics");
    assert.deepEqual(r.elements.map((e) => e.path), ["00-week-1-basics.md", "01-relational-model.md", "02-sql-queries.md"]);
    const page = r.elements[1]!;
    const fm = parseFrontmatter(page.markdown);
    assert.equal(fm.source, "studip-courseware");
    assert.equal(fm.element, CH1);
    assert.equal(fm.url, `${ORIGIN}/dispatch.php/course/courseware/courseware/${UNIT}?cid=${COURSE}#/structural_element/${CH1}`);
    assert.match(page.markdown, /\n## 1 Relational model\n\nTables have rows\.\n\n\*\*Download:\*\* \[Slides\]\(files\/slides\.pdf\) \(11 B\)\n$/);
    assert.match(r.elements[0]!.markdown, /\*\*Subpages:\*\*\n\n- \[Relational model\]\(\.\/01-relational-model\.md\)/);
    assert.deepEqual(r.downloads.map((f) => f.id), [FILE_PDF]);
  });
});

describe("writeCoursewareUnit", () => {
  it("writes pages and files, skips unchanged on the next run, removes vanished pages", async () => {
    const fetched: string[] = [];
    const fetchFile = async (id: string, dest: string) => {
      fetched.push(id);
      await writeFile(dest, "hello world");
      return 11;
    };
    const unitDir = join(dir, "courseware", "week-1-basics");
    const first = await writeCoursewareUnit(renderUnit(unitContent(), { origin: ORIGIN }), unitDir, { fetchFile });
    assert.equal(first.written, 3);
    assert.equal(first.files.downloaded, 1);
    assert.equal((await stat(join(unitDir, "files", "slides.pdf"))).mtime.toISOString(), new Date("2026-10-04T08:30:00+02:00").toISOString());

    const second = await writeCoursewareUnit(renderUnit(unitContent(), { origin: ORIGIN }), unitDir, { fetchFile });
    assert.equal(second.written, 0);
    assert.equal(second.skipped, 3);
    assert.equal(second.files.skipped, 1);
    assert.equal(fetched.length, 1);

    await writeFile(join(unitDir, "notes-by-me.md"), "# my own notes\n");
    const third = await writeCoursewareUnit(renderUnit(unitContent(false), { origin: ORIGIN }), unitDir, { fetchFile });
    assert.equal(third.removed, 1);
    const names = (await readdir(unitDir)).sort();
    assert.deepEqual(names, ["00-week-1-basics.md", "01-relational-model.md", "files", "notes-by-me.md"]);
  });

  it("dry run writes nothing", async () => {
    const unitDir = join(dir, "dry");
    const r = await writeCoursewareUnit(renderUnit(unitContent(), { origin: ORIGIN }), unitDir, { dryRun: true });
    assert.equal(r.written, 3);
    await assert.rejects(readdir(unitDir));
  });
});

describe("renderCoursewareIndex", () => {
  it("lists tasks with deadlines and the unit outline", () => {
    const rendered = renderUnit(unitContent(), { origin: ORIGIN });
    const t = normalizeTask(
      task(hid("t1"), hid("tg"), CH1, {}),
      [taskGroup(hid("tg"), "Sheet 1", "2026-10-01T00:00:00+02:00", "2026-10-24T23:59:00+02:00")],
      { courseId: COURSE, now: new Date("2026-10-22T10:00:00+02:00") },
    );
    const md = renderCoursewareIndex({ courseId: COURSE, courseTitle: "Databases", origin: ORIGIN, units: [{ rendered, folder: "week-1-basics" }], tasks: [t] });
    assert.match(md, /# Courseware — Databases/);
    assert.match(md, /## Tasks and deadlines\n\n- \*\*2026-10-24 \d\d:59\*\* · open · Sheet 1/);
    assert.match(md, /- \[Week 1: Basics\]\(week-1-basics\/00-week-1-basics\.md\)\n {2}- \[1 Relational model\]\(week-1-basics\/01-relational-model\.md\)/);
  });
});

describe("wiki", () => {
  const pages = [
    wikiPage("11", "WikiWikiWeb", "<!--HTML--><p>Welcome. See <a href=\"https://studip.example.org/dispatch.php/course/wiki/page/12?cid=x\">exam info</a>.</p>"),
    wikiPage("12", "Exam info", "!!Dates\n- written exam\n[[WikiWikiWeb|home]]"),
    wikiPage("13", "Room plan", "<p>Room 1</p>", "12"),
  ].map(normalizeWikiPage);

  it("builds the tree with the start page first and local links", () => {
    const r = renderWiki(pages, { origin: ORIGIN, courseId: COURSE, courseTitle: "Databases" });
    assert.deepEqual(r.pages.map((p) => [p.node.file, p.node.depth]), [["start.md", 0], ["exam-info.md", 0], ["room-plan.md", 1]]);
    assert.match(r.pages[0]!.markdown, /See \[exam info\]\(\.\/exam-info\.md\)/);
    assert.match(r.pages[1]!.markdown, /### Dates\n- written exam\n\[home\]\(\.\/start\.md\)/);
    assert.match(r.readme, /- \[Exam info\]\(\.\/exam-info\.md\)\n {2}- \[Room plan\]\(\.\/room-plan\.md\)/);
    assert.equal(parseFrontmatter(r.pages[2]!.markdown).parent, "12");
  });

  it("writes idempotently and drops removed pages", async () => {
    const wikiDir = join(dir, "wiki");
    const a = await writeWiki(renderWiki(pages, { origin: ORIGIN, courseId: COURSE }), wikiDir);
    assert.equal(a.written, 3);
    const b = await writeWiki(renderWiki(pages, { origin: ORIGIN, courseId: COURSE }), wikiDir);
    assert.equal(b.skipped, 3);
    const c = await writeWiki(renderWiki(pages.slice(0, 2), { origin: ORIGIN, courseId: COURSE }), wikiDir);
    assert.equal(c.removed, 1);
    assert.match(await readFile(join(wikiDir, "README.md"), "utf-8"), /2 pages/);
  });
});

describe("syncContent", () => {
  it("writes courseware + wiki for one course and returns its tasks", async () => {
    const content = unitContent();
    const deps: ContentSyncDeps = {
      origin: ORIGIN,
      courseware: {
        listCourseUnits: async () => [content.unit],
        loadUnitContent: async () => content,
        listTasks: async (courseId, ctx) => [
          normalizeTask(
            task(hid("t1"), hid("tg"), CH1, {}),
            [taskGroup(hid("tg"), "Sheet 1", "2026-10-01T00:00:00+02:00", "2026-10-24T23:59:00+02:00"), element(CH1, "Sheet 1 (copy)", 0, ROOT)],
            { ...ctx, courseId },
          ),
        ],
      },
      wiki: { listPages: async () => [normalizeWikiPage(wikiPage("1", "WikiWikiWeb", "<p>Hi</p>"))] },
      fetchFile: async (_id, dest) => {
        await writeFile(dest, "x");
        return 1;
      },
    };
    const courseDir = join(dir, "WS2026-27", "Databases");
    const res = await syncContent(deps, { id: COURSE, title: "Databases" }, courseDir, { now: new Date("2026-10-20T10:00:00+02:00") });
    assert.equal(res.errors.length, 0);
    assert.equal(res.courseware?.units, 1);
    assert.equal(res.courseware?.pages, 3);
    assert.equal(res.courseware?.files.downloaded, 1);
    assert.equal(res.wiki?.pages, 1);
    assert.equal(res.tasks[0]?.courseTitle, "Databases");
    assert.equal(res.tasks[0]?.unitTitle, "Week 1: Basics");
    const tree = (await readdir(join(courseDir, "courseware"))).sort();
    assert.deepEqual(tree, ["README.md", "week-1-basics"]);
    assert.deepEqual((await readdir(join(courseDir, "wiki"))).sort(), ["README.md", "start.md"]);
  });
});
