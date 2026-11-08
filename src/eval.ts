// Runs the pipeline on every labeled synthetic email and scores it. This produces the number for the website card.
// Usage: npm run eval [-- --limit 10 --concurrency 5 --triage-only]
// TRIAGE=d3 (default) or TRIAGE=claude picks the triage backend. --triage-only skips drafting: fast, compares backends.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CATEGORY_NAMES, MANUAL_MINUTES_PER_EMAIL, TRIAGE_BACKEND } from "./config.ts";
import { processEmail } from "./pipeline.ts";
import { labeledEmails, stripLabel } from "./sources/mock.ts";
import type { Ticket } from "./types.ts";

const { values } = parseArgs({ options: { limit: { type: "string" }, concurrency: { type: "string" }, "triage-only": { type: "boolean", default: false } } });
const draft = !values["triage-only"];
const emails = labeledEmails.slice(0, values.limit ? Number(values.limit) : undefined);
// d3 shares one GPU, so parallel requests only queue (and inflate per-email times). Claude calls overlap well.
const concurrency = Number(values.concurrency ?? (TRIAGE_BACKEND === "d3" && !draft ? 1 : 5));

console.log(`Evaluating ${emails.length} emails · triage: ${TRIAGE_BACKEND} · drafts: ${draft ? "claude -p" : "skipped"} (concurrency ${concurrency})\n`);

const results: { email: (typeof emails)[number]; ticket: Ticket }[] = [];
const started = performance.now();

// Fail fast on setup problems (classifier not running, Claude Code not signed in) instead of scoring 50 errors.
const first = await processEmail(stripLabel(emails[0]), undefined, undefined, { draft });
if (first.status === "error") {
  console.error(`The first email failed, so the eval stopped before spending anything else:\n  ${first.error}`);
  console.error("\nCheck that the d3 classifier is running (npm run classifier) and that `claude -p` works in this terminal.");
  process.exit(1);
}
results.push({ email: emails[0], ticket: first });
console.log(`${first.triage?.category === emails[0].label.category ? "✓" : "✗"} ${emails[0].id}  setup OK, running the rest…`);
const queue = emails.slice(1);

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const ticket = await processEmail(stripLabel(e), undefined, undefined, { draft });
      results.push({ email: e, ticket });
      const t = ticket.triage;
      const ok = t?.category === e.label.category ? "✓" : "✗";
      console.log(`${ok} ${e.id}  expected ${e.label.category.padEnd(8)} got ${(t?.category ?? ticket.status).padEnd(8)} ${((ticket.timings.total_ms ?? 0) / 1000).toFixed(1)}s  ${e.subject}`);
    }
  }),
);
results.sort((a, b) => a.email.id.localeCompare(b.email.id));

const wallSeconds = (performance.now() - started) / 1000;
const n = results.length;
const ok = results.filter((r) => r.ticket.status === "review");
const pct = (k: number) => Math.round((k / n) * 100);

const categoryHits = results.filter((r) => r.ticket.triage?.category === r.email.label.category).length;
const priorityHits = results.filter((r) => r.ticket.triage?.priority === r.email.label.priority).length;
// A failed email scores as a miss everywhere, even when its expected order is "none".
const orderHits = results.filter((r) => r.ticket.status !== "error" && (r.ticket.order?.id ?? null) === r.email.label.order_id).length;
const avg = (f: (t: Ticket) => number | undefined) => ok.reduce((s, r) => s + (f(r.ticket) ?? 0), 0) / Math.max(ok.length, 1) / 1000;
const avgSeconds = avg((t) => t.timings.total_ms);
const avgTriageSeconds = avg((t) => t.timings.triage_ms);
// API-equivalent cost reported by claude -p. On a Claude subscription it isn't billed per call; d3 is free.
const cost = results.reduce((s, r) => s + r.ticket.cost_usd, 0);

// Confusion matrix: rows = expected, columns = predicted
const matrix = Object.fromEntries(CATEGORY_NAMES.map((a) => [a, Object.fromEntries([...CATEGORY_NAMES, "error"].map((b) => [b, 0]))]));
for (const r of results) matrix[r.email.label.category][r.ticket.triage?.category ?? "error"]++;

const summary = {
  date: new Date().toISOString().slice(0, 10),
  triage_backend: TRIAGE_BACKEND,
  emails: n,
  errors: n - ok.length,
  category_accuracy: pct(categoryHits),
  priority_accuracy: pct(priorityHits),
  order_match_accuracy: pct(orderHits),
  avg_seconds_per_email: Number(avgSeconds.toFixed(1)),
  avg_triage_seconds: Number(avgTriageSeconds.toFixed(2)),
  drafts: draft,
  manual_minutes_per_email: MANUAL_MINUTES_PER_EMAIL,
  cost_usd_total: Number(cost.toFixed(3)),
  cost_usd_per_email: Number((cost / n).toFixed(4)),
  wall_seconds: Number(wallSeconds.toFixed(0)),
  headline: `${n} test emails: ${pct(categoryHits)}% correctly tagged, ${pct(orderHits)}% matched to the right order, ${avgSeconds.toFixed(0)} seconds per email instead of ${MANUAL_MINUTES_PER_EMAIL} minutes.`,
};

const misses = results
  .filter((r) => r.ticket.triage?.category !== r.email.label.category || (r.ticket.order?.id ?? null) !== r.email.label.order_id)
  .map((r) => ({
    id: r.email.id,
    subject: r.email.subject,
    expected: r.email.label,
    got: { category: r.ticket.triage?.category, priority: r.ticket.triage?.priority, order_id: r.ticket.order?.id ?? null, match: r.ticket.order_match },
    error: r.ticket.error,
  }));

mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
const payload = JSON.stringify({ summary, matrix, misses, tickets: results.map((r) => r.ticket) }, null, 2);
const runName = `eval-${summary.date}-${TRIAGE_BACKEND}${draft ? "" : "-triage-only"}.json`;
writeFileSync(new URL(`../results/${runName}`, import.meta.url), payload);
// latest.json feeds the dashboard's score badge: only a clean, full (with drafts) run may update it.
const publishable = summary.errors === 0 && draft && !values.limit;
if (publishable) writeFileSync(new URL("../results/latest.json", import.meta.url), payload);

console.log(`\n${summary.headline}`);
console.log(`Priority ${summary.priority_accuracy}% · triage ${summary.avg_triage_seconds}s/email · errors ${summary.errors} · claude -p cost $${summary.cost_usd_total} ($${summary.cost_usd_per_email}/email) · wall ${summary.wall_seconds}s`);
console.log("\nConfusion (rows expected, columns predicted):");
console.table(matrix);
if (misses.length) {
  console.log("Misses (review these: is the model wrong, or the label?):");
  for (const m of misses) console.log(`  ${m.id} ${m.subject}\n     expected ${JSON.stringify(m.expected)}\n     got      ${JSON.stringify(m.got)}${m.error ? `\n     error ${m.error}` : ""}`);
}
if (publishable) {
  console.log(`\nSaved results/${runName} and results/latest.json`);
} else if (summary.errors) {
  console.log(`\n⚠ ${summary.errors} emails failed, so this score isn't publishable. Saved to results/${runName} only; latest.json is unchanged.`);
  process.exitCode = 1;
} else {
  console.log(`\nSaved results/${runName} (only full runs with drafts and no --limit update latest.json)`);
}
