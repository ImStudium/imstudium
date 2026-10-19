import {
  displayName,
  excerpt,
  isoDay,
  isoMinute,
  type ForumDiscussion,
  type ForumThread,
  type MessageItem,
  type NewsItem,
} from "@imstudium/sdk";

/** Human output for communication commands: one line per item, then an indented excerpt. */

const INDENT = "    ";

function block(head: string, body?: string): string {
  return body ? `${head}\n${INDENT}${body}` : head;
}

function indentAll(text: string): string {
  return text
    .split("\n")
    .map((l) => (l ? `${INDENT}${l}` : ""))
    .join("\n");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatNews(items: NewsItem[], options: { showCourse?: boolean } = {}): string {
  if (items.length === 0) return "No announcements.";
  return items
    .map((n) => {
      const where = n.courseTitle ?? (n.scope === "global" ? "Stud.IP" : null);
      const head = [isoDay(n.date), options.showCourse ? where : null, n.title].filter(Boolean).join(" · ");
      return block(`${head} — ${displayName(n.author)}`, excerpt(n.text));
    })
    .join("\n");
}

export function formatMessages(items: MessageItem[]): string {
  if (items.length === 0) return "No messages.";
  return items
    .map((m) => {
      const who =
        m.box === "outbox"
          ? `→ ${m.recipients.length ? m.recipients.slice(0, 3).map((r) => r.name).join(", ") + (m.recipientCount > 3 ? ` +${m.recipientCount - 3}` : "") : plural(m.recipientCount, "recipient")}`
          : displayName(m.sender);
      const unread = m.box === "inbox" && m.read === false ? "● " : "";
      return block(`${isoMinute(m.date)} · ${unread}${who} · ${m.subject}  [${m.id}]`, excerpt(m.text));
    })
    .join("\n");
}

export function formatMessage(m: MessageItem): string {
  const shown = m.recipients.slice(0, 10).map((r) => r.name);
  const more = m.recipientCount - shown.length;
  const to = shown.length
    ? `${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`
    : plural(m.recipientCount, "recipient");
  return [
    m.subject,
    `From: ${displayName(m.sender)}`,
    `To:   ${to}`,
    `Date: ${isoMinute(m.date)}${m.read === false ? " · unread" : ""}`,
    ...(m.tags.length ? [`Tags: ${m.tags.join(", ")}`] : []),
    "",
    m.text || "(no text)",
  ].join("\n");
}

export type DiscussionWithCourse = ForumDiscussion & { courseTitle?: string | null };

export function formatDiscussions(items: DiscussionWithCourse[], options: { showCourse?: boolean } = {}): string {
  if (items.length === 0) return "No forum discussions.";
  return items
    .map((d) => {
      const title = d.topicName ? `${d.topicName} › ${d.title}` : d.title;
      const counts = `${plural(d.postingsCount, "posting")}${d.unreadCount ? `, ${d.unreadCount} new` : ""}`;
      const flags = [d.sticky && "pinned", d.closed && "closed"].filter(Boolean).join(", ");
      const head = [isoDay(d.lastActivity), options.showCourse ? d.courseTitle : null, title]
        .filter(Boolean)
        .join(" · ");
      return `${head} — ${counts}${flags ? ` (${flags})` : ""}${d.startedBy ? ` · ${d.startedBy.name}` : ""}  [${d.id}]`;
    })
    .join("\n");
}

export function formatThread(thread: ForumThread): string {
  const d = thread.discussion;
  const meta = [
    d.topicName,
    plural(thread.postings.length, "posting"),
    d.startedBy && `started by ${d.startedBy.name}${d.createdAt ? ` on ${isoDay(d.createdAt)}` : ""}`,
    d.closed && "closed",
  ].filter(Boolean);
  return [
    d.title,
    meta.join(" · "),
    "",
    ...thread.postings.flatMap((p) => [
      `${isoMinute(p.date)} · ${displayName(p.author)}${p.moderator ? " (lecturer/tutor)" : ""}`,
      indentAll(p.text || "(empty)"),
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
}
