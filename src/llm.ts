// One helper for every Claude call: runs the Claude Code CLI headless (`claude -p`), signed in with your
// Claude account, so no API key is needed. Output is constrained by a JSON schema and validated with Zod.
import { spawn } from "node:child_process";
import { z } from "zod";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL; // e.g. "sonnet"; unset = your Claude Code default

type CliResult = { is_error: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "lfm3";

// oMLX: local MLX server on Apple Silicon with an OpenAI-compatible API. Key is in ~/.omlx/settings.json (auth.api_key).
const OMLX_URL = process.env.OMLX_URL ?? "http://127.0.0.1:8000/v1";
export const OMLX_MODEL = process.env.OMLX_MODEL ?? "Youssofal--Qwen3.8-27B-MTPLX-Optimized-Quality";

export type Engine = "claude" | "ollama" | "omlx";

export async function structured<S extends z.ZodType>(opts: { schema: S; system: string; user: string; engine?: Engine }): Promise<{ data: z.infer<S>; ms: number; cost_usd: number }> {
  // claude -p's validator rejects Zod's "$schema: draft 2020-12" marker; the schema itself is plain JSON Schema.
  const { $schema: _marker, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  if (opts.engine === "ollama") return ollama(opts, jsonSchema);
  if (opts.engine === "omlx") return omlx(opts, jsonSchema);
  return claude(opts, jsonSchema);
}

// ---------- Local model through oMLX (OpenAI-compatible, schema-constrained decoding) ----------

async function omlx<S extends z.ZodType>(opts: { schema: S; system: string; user: string }, jsonSchema: Record<string, unknown>) {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${OMLX_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.OMLX_API_KEY ? { authorization: `Bearer ${process.env.OMLX_API_KEY}` } : {}) },
      body: JSON.stringify({
        model: OMLX_MODEL,
        temperature: 0.2,
        max_tokens: 4000,
        // Reasoning models (Qwen3.x) otherwise "think" for thousands of tokens before the JSON: ~4x slower,
        // and the reply can be cut off at max_tokens. Set OMLX_THINKING=true to allow it.
        chat_template_kwargs: { enable_thinking: process.env.OMLX_THINKING === "true" },
        response_format: { type: "json_schema", json_schema: { name: "output", strict: true, schema: jsonSchema } },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
  } catch {
    throw new Error(`oMLX not reachable at ${OMLX_URL}. Start it with: omlx serve`);
  }
  if (!res.ok) throw new Error(`oMLX error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = out.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${OMLX_MODEL} returned invalid JSON: ${content.slice(0, 200)}`);
  }
  return { data: opts.schema.parse(parsed) as z.infer<S>, ms: performance.now() - started, cost_usd: 0 };
}

// ---------- Local model through Ollama (e.g. Liquid AI LFM3) ----------

async function ollama<S extends z.ZodType>(opts: { schema: S; system: string; user: string }, jsonSchema: Record<string, unknown>) {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: jsonSchema, // Ollama constrains the output to this schema
        // LFM3 model card's recommended sampling for chat/tool use/structured output
        options: { temperature: 0.1, top_k: 50, repeat_penalty: 1.1 },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
  } catch {
    throw new Error(`Ollama not reachable at ${OLLAMA_URL}. Is the Ollama app running?`);
  }
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = (await res.json()) as { message?: { content?: string } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.message?.content ?? "");
  } catch {
    throw new Error(`${OLLAMA_MODEL} returned invalid JSON: ${(out.message?.content ?? "").slice(0, 200)}`);
  }
  return { data: opts.schema.parse(parsed) as z.infer<S>, ms: performance.now() - started, cost_usd: 0 };
}

// ---------- Claude through Claude Code headless (claude -p) ----------

async function claude<S extends z.ZodType>(opts: { schema: S; system: string; user: string }, jsonSchema: Record<string, unknown>) {
  const started = performance.now();
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(jsonSchema),
    "--system-prompt", opts.system,
    // A plain model call: no tools, no project settings, hooks, MCP servers or saved session.
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    ...(CLAUDE_MODEL ? ["--model", CLAUDE_MODEL] : []),
  ];

  const out = await run(args, opts.user);
  let parsed: CliResult;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`Unexpected output from claude -p: ${out.slice(0, 200)}`);
  }
  if (parsed.is_error || parsed.structured_output == null) {
    throw new Error(`claude -p failed: ${parsed.result ?? "no structured output"}`);
  }
  return { data: opts.schema.parse(parsed.structured_output), ms: performance.now() - started, cost_usd: parsed.total_cost_usd ?? 0 };
}

function run(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => reject(new Error(`Could not start "${CLAUDE_BIN}": ${err.message}. Is Claude Code installed and signed in?`)));
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude -p exited with ${code}: ${(stderr || stdout).slice(0, 300)}`))));
    child.stdin.end(stdin);
  });
}

// Emails are untrusted input. Wrap them so instructions inside an email are treated as data.
export function emailBlock(e: { from_name: string; from_email: string; subject: string; body: string; received_at: string }) {
  return `<email>
<from>${e.from_name} &lt;${e.from_email}&gt;</from>
<received_at>${e.received_at}</received_at>
<subject>${e.subject}</subject>
<body>
${e.body}
</body>
</email>`;
}
