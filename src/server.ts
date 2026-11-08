// Review dashboard server: JSON API + server-sent events for the live log. No framework needed.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { BUSINESS, DRAFT_ENGINE, MANUAL_MINUTES_PER_EMAIL, PORT, TRIAGE_BACKEND } from "./config.ts";
import { OMLX_MODEL } from "./llm.ts";
import { processEmail } from "./pipeline.ts";
import { source } from "./sources/index.ts";
import { store } from "./store.ts";
import type { LogEvent, Ticket } from "./types.ts";

const PUBLIC = new URL("../public/", import.meta.url);
const RESULTS = new URL("../results/latest.json", import.meta.url);
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const PROCESS_CONCURRENCY = Math.max(1, Number(process.env.PROCESS_CONCURRENCY ?? 3));

const clients = new Set<ServerResponse>();
const log: LogEvent[] = [];

function broadcast(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

function emitFor(ticketId: string) {
  return (kind: LogEvent["kind"], text: string) => {
    const ev = { at: new Date().toISOString(), ticket_id: ticketId, kind, text };
    log.push(ev);
    if (log.length > 200) log.shift();
    broadcast("log", ev);
  };
}

const upsert = (t: Ticket) => {
  store.put(t);
  broadcast("ticket", t);
};

let running = false;

async function runInbox(limit: number, gapMs: number, set: "main" | "edge", ids?: string[]) {
  if (running) return { started: false, reason: "Already processing" };
  running = true;
  broadcast("running", true);
  try {
    // ids: just these emails (a recording that needs a particular one), else the next `limit` new ones
    const emails = ids?.length ? (await source.fetchNew(1000, store.has, set)).filter((e) => ids.includes(e.id)) : await source.fetchNew(limit, store.has, set);
    // Several emails in flight: d3 triage still runs one at a time on the GPU (~0.4 s each), but the
    // Claude drafts (~10 s, mostly network wait) overlap. Starts are staggered so the live log stays readable.
    const queue = [...emails];
    const worker = async (slot: number) => {
      if (gapMs) await new Promise((r) => setTimeout(r, slot * gapMs));
      for (let email = queue.shift(); email; email = queue.shift()) {
        await processEmail(email, upsert, emitFor(email.id));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROCESS_CONCURRENCY, emails.length) }, (_, slot) => worker(slot)));
    return { started: true, count: emails.length };
  } finally {
    running = false;
    broadcast("running", false);
  }
}

function stats() {
  const all = store.all();
  const done = all.filter((t) => t.status !== "processing" && t.status !== "error");
  const avgMs = done.length ? done.reduce((s, t) => s + (t.timings.total_ms ?? 0), 0) / done.length : 0;
  return {
    total: all.length,
    awaiting: all.filter((t) => t.status === "review").length,
    approved: all.filter((t) => t.status === "approved").length,
    edited: all.filter((t) => t.status === "approved" && t.final_reply !== t.draft?.reply).length,
    errors: all.filter((t) => t.status === "error").length,
    avg_seconds: avgMs / 1000,
    minutes_saved: done.length * MANUAL_MINUTES_PER_EMAIL - (done.length * avgMs) / 60_000,
  };
}

async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const json = (res: ServerResponse, data: unknown, status = 200) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ running, log })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (path === "/api/meta") {
      const evalResult = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")).summary : null;
      return json(res, { business: BUSINESS.name, source: source.name, model: `triage: ${TRIAGE_BACKEND} · drafts: ${DRAFT_ENGINE === "ollama" ? `ollama/${process.env.OLLAMA_MODEL ?? "lfm3"}` : DRAFT_ENGINE === "omlx" ? `omlx/${OMLX_MODEL}` : "claude -p"}`, manual_minutes: MANUAL_MINUTES_PER_EMAIL, eval: evalResult });
    }
    if (path === "/api/tickets") return json(res, store.all());
    if (path === "/api/stats") return json(res, stats());

    if (req.method === "POST" && path === "/api/process") {
      const { limit = 5, gap_ms = 600, set = "main", ids } = await body(req);
      runInbox(Number(limit), Number(gap_ms), set === "edge" ? "edge" : "main", Array.isArray(ids) ? ids.map(String) : undefined).catch((err) => emitFor("system")("error", String(err?.message ?? err)));
      return json(res, { ok: true });
    }
    if (req.method === "POST" && path === "/api/reset") {
      store.clear();
      log.length = 0;
      broadcast("reset", true);
      return json(res, { ok: true });
    }

    const action = path.match(/^\/api\/tickets\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && action) {
      const ticket = store.get(decodeURIComponent(action[1]));
      if (!ticket) return json(res, { error: "Not found" }, 404);
      if (ticket.status !== "review") return json(res, { error: `Ticket is ${ticket.status}` }, 409);

      if (action[2] === "approve") {
        const { reply } = await body(req);
        ticket.final_reply = String(reply ?? ticket.draft?.reply ?? "");
        ticket.delivery_note = await source.deliver(ticket, ticket.final_reply);
        ticket.status = "approved";
      } else {
        ticket.status = "rejected";
      }
      ticket.decided_at = new Date().toISOString();
      upsert(ticket);
      emitFor(ticket.id)(ticket.status === "approved" ? "approved" : "rejected", `${ticket.status === "approved" ? "Approved" : "Rejected"}: "${ticket.email.subject}"`);
      broadcast("stats", stats());
      return json(res, ticket);
    }

    // Static files
    const file = new URL(path === "/" ? "index.html" : path.slice(1), PUBLIC);
    if (!file.pathname.startsWith(PUBLIC.pathname) || !existsSync(file)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": TYPES[extname(file.pathname)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
}).listen(PORT, () => console.log(`Inbox triage dashboard: http://localhost:${PORT}  (source: ${source.name}, triage: ${TRIAGE_BACKEND}, drafts: ${DRAFT_ENGINE})`));
