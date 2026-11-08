// Synthetic inbox from data/emails.json (the 50 scored emails) and data/edge-cases.json (adversarial, for demos).
// Labels are stripped: the pipeline never sees the answers.
import { readFileSync } from "node:fs";
import type { InboundEmail } from "../types.ts";
import type { EmailSource } from "./index.ts";

export type LabeledEmail = InboundEmail & { label: { category: string; priority: string; order_id: string | null } };

const read = (file: string): LabeledEmail[] => JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), "utf8"));

export const labeledEmails = read("emails.json");
export const edgeCases = read("edge-cases.json");

export const stripLabel = ({ label: _label, why: _why, ...email }: LabeledEmail & { why?: string }): InboundEmail => email;

export const mockSource: EmailSource = {
  name: "mock inbox",
  async fetchNew(limit, isKnown, set = "main") {
    return (set === "edge" ? edgeCases : labeledEmails)
      .filter((e) => !isKnown(e.id))
      .slice(0, limit)
      .map(stripLabel);
  },
  async deliver(ticket) {
    return `Reply to ${ticket.email.from_email} marked as sent (mock inbox)`;
  },
};
