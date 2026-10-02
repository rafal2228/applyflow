import { truncate } from "./util";

/**
 * Minimal OpenAI-compatible chat client. The app only assumes a base URL that
 * speaks the `/chat/completions` protocol — no vendor/backend specifics. Both
 * grading and tailoring go through here.
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";

export function llmConfig(): LlmConfig | null {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model };
}

export interface LlmInfo {
  configured: boolean;
  model?: string;
  endpoint?: string;
}

export function llmInfo(): LlmInfo {
  const cfg = llmConfig();
  if (!cfg) return { configured: false };
  return { configured: true, model: cfg.model, endpoint: chatEndpoint(cfg.baseUrl) };
}

/** Accept a base URL (`.../v1`) or a full `/chat/completions` URL. */
function chatEndpoint(baseUrl: string): string {
  const u = baseUrl.replace(/\/+$/, "");
  return u.endsWith("/chat/completions") ? u : `${u}/chat/completions`;
}

/**
 * Pull the first JSON value out of possibly fenced / chatty text. Scans for the
 * matching closing bracket (respecting strings/escapes) so trailing prose or a
 * repeated object doesn't break parsing.
 */
export function extractJson<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const a = t.indexOf("{");
  const b = t.indexOf("[");
  const start = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (start < 0) throw new Error("No JSON found in model output.");

  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1)) as T;
    }
  }
  throw new Error("Unterminated JSON in model output.");
}

interface ChatResult {
  choices?: { message?: { content?: unknown } }[];
  error?: { message?: string };
}

/**
 * Parse a chat-completions body. Some OpenAI-compatible servers append an SSE
 * terminator (`data: [DONE]`) even to non-streaming responses, so try plain
 * JSON, then any `data:` payloads, then a balanced-JSON scan.
 */
function parseChatResponse(text: string): ChatResult {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as ChatResult;
  } catch {
    /* fall through */
  }
  const payloads = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*data:\s?/, "").trim())
    .filter((p) => p && p !== "[DONE]");
  for (let i = payloads.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(payloads[i]) as ChatResult;
    } catch {
      /* try next */
    }
  }
  return extractJson<ChatResult>(trimmed);
}

function contentToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw))
    return raw
      .map((p) =>
        typeof p === "string" ? p : ((p as { text?: string }).text ?? ""),
      )
      .join("");
  return "";
}

export interface ChatOpts {
  system?: string;
  timeoutMs?: number;
  temperature?: number;
}

/**
 * One completion, parsed as JSON. Throws on transport/HTTP/parse errors so
 * callers can surface a clear message to the UI.
 */
export async function chatJson<T>(
  prompt: string,
  opts: ChatOpts = {},
): Promise<{ data: T; model: string }> {
  const cfg = llmConfig();
  if (!cfg) {
    throw new Error(
      "LLM not configured — set OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL in applyflow/.env.local",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetch(chatEndpoint(cfg.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: opts.temperature ?? 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: opts.system ?? "You are a precise assistant. Reply with JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM endpoint HTTP ${res.status}: ${truncate(body, 300)}`);
  }

  const data = parseChatResponse(await res.text());
  if (data.error)
    throw new Error(`LLM endpoint error: ${data.error.message ?? "unknown"}`);

  const content = contentToString(data.choices?.[0]?.message?.content);
  if (!content) throw new Error("LLM endpoint returned an empty completion.");

  return { data: extractJson<T>(content), model: cfg.model };
}
