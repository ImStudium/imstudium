import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ActivityItem, ForumThread, MessageItem, NewsItem } from "@imstudium/sdk";
import { formatActivities, formatMessage, formatMessages, formatNews, formatThread } from "./communication-format.js";

// Synthetic data only.
const lecturer = { id: "u1", name: "Dr. Example Lecturer" };

const newsItem: NewsItem = {
  id: "n1",
  title: "Sheet 1 is online",
  text: "Hello class,\n\nsee the new sheet.\nThird line",
  date: "2026-10-12T14:03:00+02:00",
  createdAt: null,
  updatedAt: null,
  expiresAt: null,
  author: lecturer,
  scope: "course",
  courseId: "c1",
  courseTitle: "Example Course",
  commentsAllowed: false,
};

const msg: MessageItem = {
  id: "m1",
  box: "inbox",
  subject: "Room change",
  text: "We move to room 1001.",
  date: "2026-10-12T09:15:00+02:00",
  read: false,
  priority: "normal",
  tags: [],
  sender: lecturer,
  recipients: [],
  recipientCount: 40,
};

describe("communication formatting", () => {
  it("prints news as one line plus an indented excerpt", () => {
    assert.equal(
      formatNews([newsItem], { showCourse: true }),
      "2026-10-12 · Example Course · Sheet 1 is online — Dr. Example Lecturer\n    Hello class, · see the new sheet.",
    );
    assert.equal(formatNews([]), "No announcements.");
  });

  it("marks unread inbox messages and shows the id", () => {
    assert.equal(
      formatMessages([msg]),
      "2026-10-12 09:15 · ● Dr. Example Lecturer · Room change  [m1]\n    We move to room 1001.",
    );
    assert.match(formatMessages([{ ...msg, box: "outbox" }]), /→ 40 recipients/);
  });

  it("prints a full message", () => {
    const out = formatMessage({ ...msg, recipients: [{ id: "u9", name: "Me Student" }], recipientCount: 3 });
    assert.match(out, /^Room change\nFrom: Dr\. Example Lecturer\nTo: {3}Me Student \(\+2 more\)\nDate: 2026-10-12 09:15 · unread\n\nWe move/);
  });

  it("prints a thread with indented postings", () => {
    const thread: ForumThread = {
      discussion: {
        id: "d1",
        title: "Question on task 3",
        topicId: "t1",
        topicName: "Exercise sheets",
        startedBy: { id: "u2", name: "Student A" },
        sticky: false,
        closed: false,
        closedAt: null,
        views: 0,
        postingsCount: 1,
        unreadCount: 0,
        createdAt: "2026-10-10T09:00:00+02:00",
        lastActivity: "2026-10-10T09:00:00+02:00",
      },
      postings: [
        { id: "p1", discussionId: "d1", text: "Is b) optional?\nThanks", date: "2026-10-10T09:00:00+02:00", updatedAt: null, author: { id: "u2", name: "Student A" }, anonymous: false, moderator: false },
      ],
    };
    assert.equal(
      formatThread(thread),
      "Question on task 3\nExercise sheets · 1 posting · started by Student A on 2026-10-10\n\n2026-10-10 09:00 · Student A\n    Is b) optional?\n    Thanks",
    );
  });

  it("prints the activity feed", () => {
    const a: ActivityItem = {
      id: "a1",
      date: "2026-10-12T10:00:00+02:00",
      type: "documents",
      verb: "created",
      title: "Someone uploaded a file",
      text: "sheet-1.pdf",
      contextType: "course",
      courseId: "c1",
      courseTitle: "Example Course",
      objectType: "file-refs",
      objectId: "f1",
      actor: lecturer,
      url: null,
    };
    assert.equal(formatActivities([a]), "2026-10-12 10:00 · Example Course · [documents] Someone uploaded a file\n    sheet-1.pdf");
  });
});
