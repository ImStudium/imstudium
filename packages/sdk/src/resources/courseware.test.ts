import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { StudIpClient } from "../client.js";
import { Included } from "../jsonapi.js";
import {
  buildElementTree,
  cleanDate,
  CoursewareResource,
  coursewareElementUrl,
  daysUntil,
  normalizeBlock,
  normalizeContainer,
  normalizeElement,
  normalizeTask,
  normalizeUnit,
  sortTasks,
} from "./courseware.js";
import {
  block,
  CH1,
  CH1A,
  CH2,
  container,
  COURSE,
  element,
  fileRef,
  FILE_PDF,
  hid,
  ROOT,
  routeFetch,
  task,
  taskGroup,
  UNIT,
  unitResource,
} from "../test/content-fixtures.js";

const ORIGIN = "https://studip.example.org";

describe("courseware normalizers", () => {
  it("takes the unit title from the included root element", () => {
    const root = element(ROOT, "Week 1: Basics", 0, null, { payload: { description: "Intro unit" } });
    const unit = normalizeUnit(unitResource(), [root]);
    assert.equal(unit.title, "Week 1: Basics");
    assert.equal(unit.description, "Intro unit");
    assert.equal(unit.rootId, ROOT);
    assert.equal(unit.courseId, COURSE);
    assert.equal(unit.rangeType, "course");
    assert.equal(unit.visibleFrom, null);
  });

  it("orders elements depth-first by position with outline numbers", () => {
    const root = normalizeElement(element(ROOT, "Root", 0, null));
    const tree = buildElementTree(root, [
      normalizeElement(element(CH2, "Second", 1, ROOT)),
      normalizeElement(element(CH1A, "First.A", 0, CH1)),
      normalizeElement(element(CH1, "First", 0, ROOT)),
      normalizeElement(element(hid("orphan"), "Orphan", 5, hid("missing"))),
    ]);
    assert.deepEqual(
      tree.map((n) => [n.title, n.depth, n.number, n.order]),
      [
        ["Root", 0, "", 0],
        ["First", 1, "1", 1],
        ["First.A", 2, "1.1", 2],
        ["Second", 1, "2", 3],
        ["Orphan", 1, "3", 4],
      ],
    );
    assert.deepEqual(tree[0]!.childIds, [CH1, CH2, hid("orphan")]);
  });

  it("reads accordion sections in both array and single-object form", () => {
    const a = normalizeContainer(container(hid("c1"), CH1, "accordion", ["b1", "b2"], [{ name: "Part A", blocks: ["b1"] }, { name: "Part B", blocks: ["b2"] }]));
    assert.equal(a.type, "accordion");
    assert.deepEqual(a.sections.map((s) => s.name), ["Part A", "Part B"]);
    const b = normalizeContainer(container(hid("c2"), CH1, "list", ["b3"], { name: "neue Liste", blocks: ["b3"] }));
    assert.deepEqual(b.sections, [{ name: "neue Liste", blockIds: ["b3"] }]);
  });

  it("keeps block payloads and parses JSON-string payloads", () => {
    const b = normalizeBlock(block(hid("b"), "text", { text: "<p>Hi</p>" }));
    assert.equal(b.type, "text");
    assert.deepEqual(b.payload, { text: "<p>Hi</p>" });
    const raw = block(hid("b2"), "code", {});
    raw.attributes!.payload = '{"content":"x = 1","lang":"python"}';
    assert.equal(normalizeBlock(raw).payload.lang, "python");
  });

  it("treats Stud.IP epoch dates as unset", () => {
    assert.equal(cleanDate("1970-01-01T01:00:00+01:00"), null);
    assert.equal(cleanDate("2026-10-24T23:59:00+02:00"), "2026-10-24T23:59:00+02:00");
    assert.equal(cleanDate(undefined), null);
  });
});

describe("courseware tasks", () => {
  const now = new Date("2026-10-20T12:00:00+02:00");
  const group = taskGroup(hid("tg1"), "Exercise sheet 3", "2026-10-13T00:00:00+02:00", "2026-10-24T23:59:00+02:00");
  const taskElement = element(hid("tel"), "Exercise sheet 3 (your copy)", 0, CH1);

  it("normalizes an open task with deadline and days left", () => {
    const t = normalizeTask(task(hid("t1"), hid("tg1"), hid("tel"), { progress: 42.345 }), [group, taskElement], {
      courseId: COURSE,
      courseTitle: "Synthetic Course",
      unitTitles: { [UNIT]: "Week 1" },
      origin: ORIGIN,
      now,
    });
    assert.equal(t.title, "Exercise sheet 3");
    assert.equal(t.status, "open");
    assert.equal(t.deadline, "2026-10-24T23:59:00+02:00");
    assert.equal(t.daysLeft, 4);
    assert.equal(t.progress, 42.3);
    assert.equal(t.unitId, UNIT);
    assert.equal(t.unitTitle, "Week 1");
    assert.equal(t.renewalDate, null);
    assert.equal(t.url, coursewareElementUrl(ORIGIN, COURSE, UNIT, hid("tel")));
  });

  it("uses a granted extension as the deadline and flags overdue/submitted", () => {
    const inc = new Included([group, taskElement]);
    const ctx = { courseId: COURSE, now: new Date("2026-10-26T12:00:00+01:00") };
    const extended = normalizeTask(
      task(hid("t2"), hid("tg1"), hid("tel"), { renewal: "granted", "renewal-date": "2026-10-31T23:59:00+01:00" }),
      inc,
      ctx,
    );
    assert.equal(extended.deadline, "2026-10-31T23:59:00+01:00");
    assert.equal(extended.status, "open");
    const late = normalizeTask(task(hid("t3"), hid("tg1"), hid("tel"), {}), inc, ctx);
    assert.equal(late.status, "overdue");
    assert.ok((late.daysLeft ?? 0) < 0);
    const done = normalizeTask(task(hid("t4"), hid("tg1"), hid("tel"), { submitted: true }), inc, ctx);
    assert.equal(done.status, "submitted");
    assert.deepEqual(sortTasks([done, extended, late]).map((t) => t.id), [late.id, extended.id, done.id]);
  });

  it("counts calendar days, not 24h windows", () => {
    const n = new Date(2026, 9, 20, 23, 0);
    assert.equal(daysUntil(new Date(2026, 9, 21, 1, 0).toISOString(), n), 1);
    assert.equal(daysUntil(null, n), null);
  });
});

describe("CoursewareResource (mocked transport)", () => {
  function setup() {
    const blockA = block(hid("blk1"), "download", { title: "Slides", file_id: FILE_PDF }, 0, hid("cnt1"));
    const routes = {
      [`/courses/${COURSE}/courseware-units`]: {
        data: [unitResource()],
        included: [element(ROOT, "Week 1", 0, null)],
        links: { next: null },
      },
      [`/courseware-structural-elements/${ROOT}/descendants`]: {
        data: [element(CH1, "Chapter 1", 0, ROOT, {}, [hid("cnt1")])],
        links: { next: null },
      },
      [`/courseware-structural-elements/${ROOT}/containers`]: { data: [], links: { next: null } },
      [`/courseware-structural-elements/${CH1}/containers`]: {
        data: [container(hid("cnt1"), CH1, "list", [hid("blk1")])],
        included: [blockA],
        links: { next: null },
      },
      [`/file-refs/${FILE_PDF}`]: { data: fileRef(FILE_PDF, "slides-week1.pdf", 4096) },
      "/courseware-tasks": {
        data: [task(hid("t1"), hid("tg1"), CH1, {})],
        included: [taskGroup(hid("tg1"), "Sheet 1", "2026-10-01T00:00:00+02:00", "2026-10-24T23:59:00+02:00")],
        links: { next: null },
      },
    };
    const { fetchImpl, calls } = routeFetch(routes);
    const client = new StudIpClient({ baseUrl: `${ORIGIN}/jsonapi.php/v1`, fetchImpl, retries: 0 });
    return { cw: new CoursewareResource(client), calls };
  }

  it("loads a unit without ever GETting a single structural element", async () => {
    const { cw, calls } = setup();
    const [unit] = await cw.listCourseUnits(COURSE);
    assert.equal(unit!.title, "Week 1");
    const content = await cw.loadUnitContent(unit!);
    assert.deepEqual(content.elements.map((e) => e.title), ["Week 1", "Chapter 1"]);
    assert.equal(content.containers[CH1]!.length, 1);
    assert.equal(content.blocks[hid("blk1")]!.type, "download");
    assert.equal(content.files[FILE_PDF]!.name, "slides-week1.pdf");
    // GET /courseware-structural-elements/{id} stores "last visited" in Stud.IP.
    assert.ok(!calls.some((c) => /^\/courseware-structural-elements\/[0-9a-f]{32}(\?|$)/.test(c)), calls.join("\n"));
    assert.ok(calls.some((c) => c.includes("include=blocks")));
  });

  it("filters tasks by course and returns [] when courseware is off", async () => {
    const { cw, calls } = setup();
    const tasks = await cw.listTasks(COURSE, { now: new Date("2026-10-20T10:00:00+02:00") });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.title, "Sheet 1");
    assert.ok(calls.some((c) => c.includes(`filter%5Bcid%5D=${COURSE}`)));
    assert.deepEqual(await cw.listCourseUnits(hid("nocw")), []);
  });
});
