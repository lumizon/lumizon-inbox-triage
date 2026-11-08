// One-time OAuth: opens a consent URL, catches the redirect on localhost, saves a refresh token.
// Use a TEST Google account, never a real customer inbox, for the demo.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { SCOPES, TOKEN_FILE, oauthClient } from "../src/sources/gmail-api.ts";

const PORT = 3456;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const { id, secret } = oauthClient();

const url =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({ client_id: id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" });

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? "", REDIRECT).searchParams.get("code");
  if (!code) return res.writeHead(400).end("Missing code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!json.refresh_token) {
    res.writeHead(500).end(`No refresh token: ${JSON.stringify(json)}`);
    console.error(json);
    process.exit(1);
  }
  mkdirSync(new URL(".", TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: json.refresh_token }), { mode: 0o600 });
  res.end("Gmail connected. You can close this tab.");
  console.log("Saved refresh token to .secrets/gmail-token.json");
  server.close();
});

server.listen(PORT, "127.0.0.1", () => console.log(`Open this URL and approve access:\n\n${url}\n`));
