import { SOURCE } from "../config.ts";
import type { InboundEmail, Ticket } from "../types.ts";
import { gmailSource } from "./gmail.ts";
import { mockSource } from "./mock.ts";

export interface EmailSource {
  name: string;
  /** New emails not yet in the queue, oldest first. `set` picks the mock edge-case emails; other sources ignore it. */
  fetchNew(limit: number, isKnown: (id: string) => boolean, set?: "main" | "edge"): Promise<InboundEmail[]>;
  /** Deliver an approved reply. Returns a short note for the UI. */
  deliver(ticket: Ticket, reply: string): Promise<string>;
}

export const source: EmailSource = SOURCE === "gmail" ? gmailSource : mockSource;
