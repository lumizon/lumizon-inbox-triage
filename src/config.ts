// Everything a client Sprint changes lives here: the business, its categories and its policy.
import { readFileSync } from "node:fs";

export const PORT = Number(process.env.PORT ?? 4400);
export const SOURCE = (process.env.SOURCE ?? "mock") as "mock" | "gmail";

// Triage runs on a local d3 decision model (classifier/ service) or on Claude via `claude -p`.
export const TRIAGE_BACKEND = (process.env.TRIAGE ?? "d3") as "d3" | "claude";
export const D3_URL = process.env.D3_URL ?? "http://127.0.0.1:4401";

// Reply drafts: Claude via `claude -p` (default), or a local model through Ollama (OLLAMA_MODEL) or oMLX (OMLX_MODEL).
export const DRAFT_ENGINE = (process.env.DRAFT ?? "claude") as "claude" | "ollama" | "omlx";

export const BUSINESS = {
  name: "Kettle & Pine",
  description: "an online store selling coffee gear, kettles, grinders and specialty beans",
  signature: "Sam\nKettle & Pine Customer Care",
  // The demo pretends "today" is fixed so order ages and policy windows stay reproducible.
  today: "2026-11-03",
};

export const CATEGORIES = {
  billing: "Charges, payments, invoices and receipts, promo codes, prices and shipping fees charged.",
  shipping: "Delivery status, tracking, delays, address changes, pickup, and shipping questions for orders not yet received.",
  refund: "Returns, refunds, cancellations, and items received damaged, defective, wrong or missing.",
  bug: "Website, checkout, account, app or email technical problems.",
  other: "Everything else: product questions, wholesale, partnerships, praise, job applications, spam.",
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_NAMES = Object.keys(CATEGORIES) as Category[];
export const PRIORITY_RULES = {
  urgent: "Money taken in error, lost or returned parcels, chargeback or legal threats, angry repeat contacts, or a change that must happen before the order ships.",
  normal: "A customer needs something done about their order or account.",
  low: "Questions, praise, feedback, spam and anything with no action needed on an order.",
} as const;
export type Priority = keyof typeof PRIORITY_RULES;
export const PRIORITIES = Object.keys(PRIORITY_RULES) as Priority[];

export const SENTIMENTS = {
  positive: "Happy, thankful or enthusiastic.",
  neutral: "Matter-of-fact.",
  frustrated: "Disappointed or annoyed, but polite.",
  angry: "Hostile, threatening, shouting or repeating complaints.",
} as const;

export const POLICY = readFileSync(new URL("../data/policy.md", import.meta.url), "utf8");

// Used for the "time saved" line. Time yourself handling 5 emails by hand and put the real number here.
export const MANUAL_MINUTES_PER_EMAIL = 4;
