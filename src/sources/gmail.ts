// Gmail inbox: picks up unread mail, labels it, and on approval saves (or sends) the reply in-thread.
import type { InboundEmail } from "../types.ts";
import { ensureLabel, fromB64url, gmail, b64url, rfc822 } from "./gmail-api.ts";
import type { EmailSource } from "./index.ts";

const QUERY = process.env.GMAIL_QUERY ?? "in:inbox is:unread -label:ai-triaged";
const SEND = process.env.GMAIL_SEND === "true";

type Part = { mimeType: string; body?: { data?: string }; parts?: Part[] };
type Message = {
  id: string;
  threadId: string;
  internalDate: string;
  payload: Part & { headers: { name: string; value: string }[] };
};

function plainText(part: Part): string {
  if (part.mimeType === "text/plain" && part.body?.data) return fromB64url(part.body.data);
  for (const p of part.parts ?? []) {
    const text = plainText(p);
    if (text) return text;
  }
  // HTML-only mail: strip tags as a fallback.
  if (part.mimeType === "text/html" && part.body?.data) return fromB64url(part.body.data).replace(/<[^>]+>/g, " ");
  return "";
}

function parseFrom(value: string) {
  const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], email: m[2].trim() } : { name: value.trim(), email: value.trim() };
}

export const gmailSource: EmailSource = {
  name: "Gmail",
  async fetchNew(limit, isKnown) {
    const list = await gmail<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(QUERY)}&maxResults=${limit}`);
    const labelId = await ensureLabel("ai-triaged");
    const emails: InboundEmail[] = [];

    for (const { id } of list.messages ?? []) {
      if (isKnown(id)) continue;
      const msg = await gmail<Message>(`/messages/${id}?format=full`);
      const header = (n: string) => msg.payload.headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      const from = parseFrom(header("From"));
      emails.push({
        id: msg.id,
        from_name: from.name,
        from_email: from.email,
        subject: header("Subject"),
        body: plainText(msg.payload).trim(),
        received_at: new Date(Number(msg.internalDate)).toISOString(),
        ref: { threadId: msg.threadId, messageId: header("Message-ID") },
      });
      // Label on pickup so the next poll skips it, even if processing fails.
      await gmail(`/messages/${id}/modify`, { method: "POST", body: { addLabelIds: [labelId] } });
    }
    return emails.sort((a, b) => a.received_at.localeCompare(b.received_at));
  },

  async deliver(ticket, reply) {
    const { email } = ticket;
    const subject = email.subject.toLowerCase().startsWith("re:") ? email.subject : `Re: ${email.subject}`;
    const raw = b64url(
      rfc822({ To: `${email.from_name} <${email.from_email}>`, Subject: subject, "In-Reply-To": email.ref?.messageId, References: email.ref?.messageId }, reply),
    );
    const message = { raw, threadId: email.ref?.threadId };

    if (SEND) {
      await gmail("/messages/send", { method: "POST", body: message });
      await gmail(`/messages/${email.id}/modify`, { method: "POST", body: { removeLabelIds: ["UNREAD"] } });
      return `Sent to ${email.from_email} from Gmail`;
    }
    await gmail("/drafts", { method: "POST", body: { message } });
    return "Saved as a draft in the Gmail thread";
  },
};
