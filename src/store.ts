// The review queue. A JSON file is plenty for a demo; swap for Postgres/SQLite in a real Sprint.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Ticket } from "./types.ts";

const FILE = new URL("../data/queue.json", import.meta.url);

const tickets = new Map<string, Ticket>(
  existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Ticket[]).map((t) => [t.id, t]) : [],
);

const save = () => writeFileSync(FILE, JSON.stringify([...tickets.values()], null, 2));

export const store = {
  all: () => [...tickets.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  get: (id: string) => tickets.get(id),
  has: (id: string) => tickets.has(id),
  put(t: Ticket) {
    tickets.set(t.id, structuredClone(t));
    save();
  },
  clear() {
    tickets.clear();
    save();
  },
};
