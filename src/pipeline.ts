// Email in, ticket ready for review out: triage -> order lookup -> draft.
import { draft } from "./draft.ts";
import { findOrder } from "./orders.ts";
import { triage } from "./triage.ts";
import type { InboundEmail, LogEvent, Ticket } from "./types.ts";

export type Emit = (kind: LogEvent["kind"], text: string) => void;

export async function processEmail(
  email: InboundEmail,
  onUpdate: (t: Ticket) => void = () => {},
  emit: Emit = () => {},
  opts: { draft?: boolean } = {},
): Promise<Ticket> {
  const started = performance.now();
  const ticket: Ticket = {
    id: email.id,
    email,
    status: "processing",
    timings: {},
    cost_usd: 0,
    created_at: new Date().toISOString(),
  };

  emit("received", `New email: "${email.subject}"`);
  onUpdate(ticket);

  try {
    const t = await triage(email);
    ticket.triage = t.data;
    ticket.timings.triage_ms = t.ms;
    ticket.cost_usd += t.cost_usd;
    emit("tagged", `Tagged ${t.data.category} · priority ${t.data.priority} · ${Math.round(t.data.confidence * 100)}% sure (${t.data.backend})`);
    onUpdate(ticket);

    const lookupStart = performance.now();
    const { order, match } = findOrder(t.data.order_id, email.from_email);
    ticket.order = order;
    ticket.order_match = match;
    ticket.timings.lookup_ms = performance.now() - lookupStart;
    emit("order", orderLine(match, order?.id, order?.status));
    onUpdate(ticket);

    if (opts.draft !== false) {
      const d = await draft(email, t.data, order, match);
      ticket.draft = d.data;
      ticket.timings.draft_ms = d.ms;
      ticket.cost_usd += d.cost_usd;
    }
    ticket.status = "review";
    ticket.timings.total_ms = performance.now() - started;
    emit("drafted", "Draft reply ready for review");
    emit("done", `✓ Done in ${(ticket.timings.total_ms / 1000).toFixed(1)}s`);
  } catch (err) {
    ticket.status = "error";
    ticket.error = err instanceof Error ? err.message : String(err);
    ticket.timings.total_ms = performance.now() - started;
    emit("error", `Failed: ${ticket.error}`);
  }

  onUpdate(ticket);
  return ticket;
}

function orderLine(match: string, id?: string, status?: string) {
  switch (match) {
    case "by_id":
      return `Order #${id} found · ${status}`;
    case "by_sender":
      return `No order number · matched #${id} from sender · ${status}`;
    case "id_mismatch":
      return "Order number belongs to another customer · not shared";
    default:
      return "No order on file for this sender";
  }
}
