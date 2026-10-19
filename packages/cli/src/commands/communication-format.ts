import {
  displayName,
  excerpt,
  isoDay,
  isoMinute,
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
