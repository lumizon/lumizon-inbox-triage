// Minimal Gmail REST client: OAuth refresh-token flow + the handful of endpoints we need.
import { existsSync, readFileSync } from "node:fs";

export const TOKEN_FILE = new URL("../../.secrets/gmail-token.json", import.meta.url);
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // read, label
  "https://www.googleapis.com/auth/gmail.compose", // drafts, send
  "https://www.googleapis.com/auth/gmail.insert", // seed synthetic emails into a test inbox
];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function oauthClient() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env");
  return { id, secret };
}

let cached: { token: string; expires: number } | undefined;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  if (!existsSync(TOKEN_FILE)) throw new Error("No Gmail token. Run `npm run gmail:auth` first.");
  const { refresh_token } = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  const { id, secret } = oauthClient();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export async function gmail<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`Gmail ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** Build an RFC 822 message. Non-ASCII subjects are MIME-encoded. */
export function rfc822(headers: Record<string, string | undefined>, body: string) {
  const enc = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`);
  const lines = Object.entries(headers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${k === "Subject" ? enc(v!) : v}`);
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit");
  return `${lines.join("\r\n")}\r\n\r\n${body}`;
}

export async function ensureLabel(name: string): Promise<string> {
  const { labels } = await gmail<{ labels: { id: string; name: string }[] }>("/labels");
  const found = labels.find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail<{ id: string }>("/labels", { method: "POST", body: { name } });
  return created.id;
}
