import type { StudIpClient } from "../client.js";
import { htmlToText, Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { fetchPages, personFrom, personRef, toIso, toMs, type Person } from "./comm-util.js";

export type MessageBox = "inbox" | "outbox" | "single";

/** One Stud.IP message ("Nachricht"), normalised. */
export interface MessageItem {
  id: string;
  box: MessageBox;
  subject: string;
  /** Body as readable text. */
  text: string;
  date: string;
  /** Whether *you* have read it (Stud.IP's is-read for the current user); null if unknown. */
  read: boolean | null;
  priority: string | null;
  tags: string[];
  /** null id = sent by Stud.IP itself (system message). */
  sender: Person;
  /** Recipients whose names were included in the response. */
  recipients: Person[];
  recipientCount: number;
}

export interface MessageListOptions {
  /** Inbox only: just unread messages (server-side filter[unread]=1). */
  unread?: boolean;
  limit?: number;
  since?: Date;
}

const SYSTEM_SENDER: Person = { id: null, name: "Stud.IP" };

export function normalizeMessage(
  resource: JsonApiResource,
  included: Included = new Included(),
  box: MessageBox = "single",
): MessageItem {
  const a = resource.attributes ?? {};
  const recipientData = resource.relationships?.recipients?.data;
  const recipientIds = Array.isArray(recipientData) ? recipientData : recipientData ? [recipientData] : [];
  const recipients = recipientIds
    .filter((r) => included.get(r.type, r.id))
    .map((r) => personRef(included, r.type, r.id));
  const tags = Array.isArray(a.tags) ? a.tags.map(String) : [];
  return {
    id: resource.id,
    box,
    subject: String(a.subject ?? "").trim() || "(no subject)",
    text: htmlToText(a.message),
    date: toIso(a.mkdate) ?? "",
    read: typeof a["is-read"] === "boolean" ? (a["is-read"] as boolean) : null,
    priority: typeof a.priority === "string" && a.priority ? a.priority : null,
    tags,
    sender: personFrom(included, resource, "sender") ?? SYSTEM_SENDER,
    recipients,
    recipientCount: recipientIds.length,
  };
}

function select(items: MessageItem[], options: MessageListOptions): MessageItem[] {
  const since = options.since?.getTime();
  const out = items
    .filter((m) => since === undefined || toMs(m.date) >= since)
    .filter((m) => !options.unread || m.read !== true)
    .sort((a, b) => toMs(b.date) - toMs(a.date));
  return options.limit && options.limit > 0 ? out.slice(0, options.limit) : out;
}

/**
 * Inbox/outbox. Every call here is a plain GET: in Stud.IP 6.1 neither the box
 * routes nor GET /messages/{id} mark anything as read (only PATCH does).
 */
export class MessagesResource {
  constructor(private client: StudIpClient) {}

  async inbox(userId: string, options: MessageListOptions = {}): Promise<MessageItem[]> {
    // Boxes are sorted newest first server-side, so a limit can be pushed down
    // unless we still have to cut by date locally.
    const page = await fetchPages(
      this.client,
      `/users/${userId}/inbox`,
      { include: "sender", filter: options.unread ? { unread: 1 } : undefined },
      { max: options.since ? 500 : (options.limit ?? 50) },
    );
    const included = new Included(page.included);
    return select(page.data.map((r) => normalizeMessage(r, included, "inbox")), options);
  }

  async outbox(userId: string, options: Omit<MessageListOptions, "unread"> = {}): Promise<MessageItem[]> {
    const page = await fetchPages(
      this.client,
      `/users/${userId}/outbox`,
      { include: "recipients" },
      { max: options.since ? 500 : (options.limit ?? 50) },
    );
    const included = new Included(page.included);
    return select(page.data.map((r) => normalizeMessage(r, included, "outbox")), options);
  }

  /** One message with sender and every recipient. Does not mark it read. */
  async get(messageId: string): Promise<MessageItem> {
    const { data, included } = await this.client.getOne(`/messages/${messageId}`, {
      include: "sender,recipients",
    });
    return normalizeMessage(data, new Included(included), "single");
  }
}
