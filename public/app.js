const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const secs = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)}s`);

const tickets = new Map();
let selected = null;
let meta = {};

const MATCH = {
  by_id: "matched by order number",
  by_sender: "matched by sender (no number given)",
  id_mismatch: "number belongs to another customer, hidden",
  none: "no order on file",
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function addLog(ev) {
  const li = document.createElement("li");
  li.className = ev.kind;
  // Highlight the key values the way the website hero does.
  const text = esc(ev.text).replace(/Tagged (\w+) · priority (\w+)/, "Tagged <em>$1</em> · priority <em>$2</em>").replace(/#(\d+)/, "<em>#$1</em>");
  li.innerHTML = `<b>${time(ev.at)}</b>${text}`;
  const log = $("[data-log]");
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

function renderList() {
  const ul = $("[data-tickets]");
  const list = [...tickets.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  ul.innerHTML = list
    .map((t) => {
      const cat = t.triage?.category;
      return `<li data-id="${esc(t.id)}" aria-current="${t.id === selected}">
        <div class="row">
          ${cat ? `<span class="tag tag--cat" style="--c: var(--${esc(cat)})">${esc(cat)}</span>` : `<span class="tag">…</span>`}
          ${t.triage?.priority === "urgent" ? `<span class="tag tag--urgent">urgent</span>` : ""}
          <span>${esc(t.email.from_name)}</span>
          <span class="state">${esc(t.status)}</span>
        </div>
        <div class="subj">${esc(t.email.subject)}</div>
      </li>`;
    })
    .join("");
}

function orderHtml(o) {
  if (!o) return `<p class="muted">Nothing to show.</p>`;
  const items = (o.items ?? []).map((i) => `${i.qty} × ${esc(i.name)}`).join("<br>");
  const events = o.shipping?.events ?? [];
  const extras = Object.entries(o)
    .filter(([k]) => !["id", "customer", "placed_at", "status", "items", "subtotal", "shipping", "total", "payment"].includes(k))
    .map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`)
    .join("");
  const charges = o.payment?.charges ?? [];
  return `<dl class="order">
    <dt>Order</dt><dd><b>#${esc(o.id)}</b> · ${esc(o.status)}</dd>
    <dt>Customer</dt><dd>${esc(o.customer.name)}</dd>
    <dt>Placed</dt><dd>${esc(o.placed_at)}</dd>
    <dt>Items</dt><dd>${items}</dd>
    <dt>Total</dt><dd>$${Number(o.total).toFixed(2)} <span class="muted">(shipping ${esc(o.shipping?.method)} $${Number(o.shipping?.fee ?? 0).toFixed(2)})</span></dd>
    <dt>Charges</dt><dd>${charges.map((c) => `$${c.amount} ${esc(c.status)} ${esc(c.date)}`).join("<br>")}</dd>
    ${o.shipping?.carrier ? `<dt>Carrier</dt><dd>${esc(o.shipping.carrier)} ${esc(o.shipping.tracking)}</dd>` : ""}
    ${extras}
  </dl>
  ${events.length ? `<ol class="events">${events.map((e) => `<li>${esc(e.date)} · ${esc(e.status)}${e.location ? ` · ${esc(e.location)}` : ""}</li>`).join("")}</ol>` : ""}`;
}

function renderDetail() {
  const t = tickets.get(selected);
  const root = $("[data-detail]");
  if (!t) return;
  // Don't wipe a reply the reviewer is editing when a background update arrives.
  if (root.dataset.id === t.id && root.dataset.status === t.status && t.status === "review") return;

  root.innerHTML = "";
  root.append($("#detail-tpl").content.cloneNode(true));
  root.dataset.id = t.id;
  root.dataset.status = t.status;
  const f = (name) => $(`[data-f="${name}"]`, root);

  f("subject").textContent = t.email.subject;
  f("from").textContent = `${t.email.from_name} <${t.email.from_email}>`;
  f("received").textContent = new Date(t.email.received_at).toLocaleString();
  f("status").textContent = t.status;
  f("status").className = `status ${t.status}`;
  f("body").textContent = t.email.body;

  const tr = t.triage;
  f("tags").innerHTML = tr
    ? [
        `<span class="tag tag--cat" style="--c: var(--${esc(tr.category)})">${esc(tr.category)}</span>`,
        `<span class="tag ${tr.priority === "urgent" ? "tag--urgent" : ""}">priority ${esc(tr.priority)}</span>`,
        `<span class="tag">${esc(tr.sentiment)}</span>`,
        `<span class="tag" title="${esc(tr.probabilities ? Object.entries(tr.probabilities).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(" · ") : "self-reported")}">${Math.round(tr.confidence * 100)}% sure</span>`,
        `<span class="tag">${tr.backend === "d3" ? "d3 · local" : "claude"}</span>`,
      ].join("")
    : `<span class="tag">triaging…</span>`;
  f("summary").textContent = tr?.summary ?? t.draft?.summary ?? "";

  f("match").textContent = t.order_match ? `· ${MATCH[t.order_match]}` : "";
  f("order").innerHTML = t.order_match ? orderHtml(t.order) : `<p class="muted">Looking up…</p>`;

  const d = t.draft;
  f("timing").textContent = t.timings.total_ms ? `· ${secs(t.timings.total_ms)} total (triage ${secs(t.timings.triage_ms)}, draft ${secs(t.timings.draft_ms)})` : "";
  f("note").textContent = t.error ? `Error: ${t.error}` : d ? `${d.needs_attention ? "⚠ Read carefully: " : "Note: "}${d.internal_note}` : "Drafting…";
  f("note").classList.toggle("attention", Boolean(d?.needs_attention || t.error));
  f("reply").value = t.final_reply ?? d?.reply ?? "";
  f("reply").readOnly = t.status !== "review";
  f("actions").innerHTML = (d?.actions ?? [])
    .filter((a) => a.type !== "none")
    .map((a) => `<span class="action"><b>${esc(a.type.replace(/_/g, " "))}</b>${esc(a.detail)}</span>`)
    .join("");

  const decided = t.status !== "review";
  $("[data-approve]", root).disabled = decided;
  $("[data-reject]", root).disabled = decided;
  f("delivery").textContent = t.delivery_note ?? (t.status === "rejected" ? "Rejected: handle manually." : "");

  $("[data-approve]", root).onclick = () => decide("approve", f("reply").value);
  $("[data-reject]", root).onclick = () => decide("reject");
}

async function decide(action, reply) {
  try {
    const t = await api(`/api/tickets/${encodeURIComponent(selected)}/${action}`, { reply });
    tickets.set(t.id, t);
    // Jump to the next ticket waiting for review: this is the fast path on camera.
    const next = [...tickets.values()].filter((x) => x.status === "review").sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    select(next?.id ?? t.id);
  } catch (err) {
    alert(err.message);
  }
}

function select(id) {
  selected = id;
  delete $("[data-detail]").dataset.id;
  renderList();
  renderDetail();
}

async function refreshStats() {
  const s = await api("/api/stats");
  $('[data-stat="total"]').textContent = s.total;
  $('[data-stat="awaiting"]').textContent = s.awaiting;
  $('[data-stat="avg"]').textContent = s.avg_seconds ? `${s.avg_seconds.toFixed(1)}s` : "–";
  $('[data-stat="saved"]').textContent = s.minutes_saved > 0 ? `${Math.round(s.minutes_saved)} min` : "–";
}

function setRunning(on) {
  $("[data-run]").disabled = on;
  const state = $("[data-run-state]");
  state.textContent = on ? "running" : "idle";
  state.classList.toggle("live", on);
}

$("[data-tickets]").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) select(li.dataset.id);
});
$("[data-run]").addEventListener("click", () => {
  const choice = $("[data-limit]").value;
  const body = choice === "edge" ? { limit: 10, set: "edge" } : { limit: Number(choice) };
  api("/api/process", body).catch((e) => alert(e.message));
});
$("[data-reset]").addEventListener("click", async () => {
  if (!confirm("Clear all tickets from the queue?")) return;
  await api("/api/reset", {});
});

const events = new EventSource("/api/events");
events.addEventListener("hello", (e) => {
  const { running, log } = JSON.parse(e.data);
  $("[data-log]").innerHTML = "";
  log.forEach(addLog);
  setRunning(running);
});
events.addEventListener("log", (e) => addLog(JSON.parse(e.data)));
events.addEventListener("running", (e) => setRunning(JSON.parse(e.data)));
events.addEventListener("ticket", (e) => {
  const t = JSON.parse(e.data);
  tickets.set(t.id, t);
  if (!selected) selected = t.id;
  renderList();
  if (t.id === selected) renderDetail();
  refreshStats();
});
events.addEventListener("stats", refreshStats);
events.addEventListener("reset", () => {
  tickets.clear();
  selected = null;
  $("[data-log]").innerHTML = "";
  $("[data-detail]").innerHTML = `<div class="empty"><p><b>Queue cleared.</b></p></div>`;
  renderList();
  refreshStats();
});

meta = await api("/api/meta");
$("[data-business]").textContent = `· ${meta.business}`;
$("[data-source]").textContent = meta.source;
$("[data-model]").textContent = meta.model;
if (meta.eval) {
  $("[data-eval]").hidden = false;
  $("[data-eval-text]").textContent = `${meta.eval.category_accuracy}% tagged right · ${meta.eval.emails} emails`;
}
for (const t of await api("/api/tickets")) tickets.set(t.id, t);
renderList();
refreshStats();
