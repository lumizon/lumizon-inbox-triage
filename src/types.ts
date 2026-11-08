import type { Triage } from "./triage.ts";
import type { Draft } from "./draft.ts";
import type { Order } from "./orders.ts";

export type InboundEmail = {
  id: string;
  from_name: string;
  from_email: string;
  subject: string;
  body: string;
  received_at: string;
  // Source-specific handle, e.g. Gmail message and thread ids.
  ref?: Record<string, string>;
};

export type OrderMatch =
  | "by_id" // order number in the email, sender owns the order
  | "by_sender" // no number, found the sender's latest order
  | "id_mismatch" // order number belongs to someone else: not shared with the sender
  | "none";

export type TicketStatus = "processing" | "review" | "approved" | "rejected" | "error";

export type Ticket = {
  id: string;
  email: InboundEmail;
  status: TicketStatus;
  triage?: Triage;
  order?: Order;
  order_match?: OrderMatch;
  draft?: Draft;
  final_reply?: string;
  delivery_note?: string;
  error?: string;
  timings: { triage_ms?: number; lookup_ms?: number; draft_ms?: number; total_ms?: number };
  /** API-equivalent cost reported by claude -p (d3 runs locally: 0). On a Claude subscription it isn't billed per call. */
  cost_usd: number;
  created_at: string;
  decided_at?: string;
};

export type LogEvent = {
  at: string;
  ticket_id: string;
  kind: "received" | "tagged" | "order" | "drafted" | "done" | "error" | "approved" | "rejected";
  text: string;
};
