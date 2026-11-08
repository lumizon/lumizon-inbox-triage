// Order lookup. Swap this file for a Shopify / WooCommerce / database client in a real Sprint.
import { readFileSync } from "node:fs";
import type { OrderMatch } from "./types.ts";

export type Order = {
  id: string;
  customer: { name: string; email: string };
  placed_at: string;
  status: string;
  total: number;
  [key: string]: unknown;
};

const orders: Order[] = JSON.parse(readFileSync(new URL("../data/orders.json", import.meta.url), "utf8"));

const normalize = (id: string) => id.replace(/[^0-9]/g, "");

export function findOrder(orderId: string | null, senderEmail: string): { order?: Order; match: OrderMatch } {
  const sender = senderEmail.trim().toLowerCase();

  if (orderId) {
    const order = orders.find((o) => o.id === normalize(orderId));
    if (order) {
      // Never reveal one customer's order to someone else.
      if (order.customer.email.toLowerCase() !== sender) return { match: "id_mismatch" };
      return { order, match: "by_id" };
    }
  }

  const theirs = orders
    .filter((o) => o.customer.email.toLowerCase() === sender)
    .sort((a, b) => b.placed_at.localeCompare(a.placed_at));
  if (theirs[0]) return { order: theirs[0], match: "by_sender" };

  return { match: "none" };
}
