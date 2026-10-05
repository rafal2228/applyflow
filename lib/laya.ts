import { chatJson } from "./llm";
import { truncate } from "./util";
import type { JobRow } from "./types";

/**
 * Local decision engine (Laya) client.
 *
 * Laya is a non-autoregressive "system 1" model: given a state and typed
 * questions it returns typed answers with calibrated probabilities in a single
 * forward pass, with no text generation and no hallucination. For duplicate
 * finding that is a great fit — we only need "same role? yes/no" plus a
 * confidence, and we can run it on-prem for free.
 *
 * The app talks to the self-hosted Jev-compatible server (`laya-serve`):
 *
 *   POST {LAYA_BASE_URL}/v1/systemone
 *   { "state": {...}, "questions": { "same_role": {...} } }
 *
 * If no Laya endpoint is configured we fall back to the existing
 * OpenAI-compatible LLM so duplicate review still works.
 */

export interface LayaConfig {
  baseUrl: string;
  apiKey: string;
}

export function layaConfig(): LayaConfig | null {
  const baseUrl = process.env.LAYA_BASE_URL?.trim();
  if (!baseUrl) return null;
  return { baseUrl, apiKey: process.env.LAYA_API_KEY?.trim() || "" };
}

export interface LayaInfo {
  configured: boolean;
  endpoint?: string;
}

function systemOneEndpoint(baseUrl: string): string {
  const u = baseUrl.replace(/\/+$/, "");
  return u.endsWith("/v1/systemone") ? u : `${u}/v1/systemone`;
}

export function layaInfo(): LayaInfo {
  const cfg = layaConfig();
  if (!cfg) return { configured: false };
  return { configured: true, endpoint: systemOneEndpoint(cfg.baseUrl) };
}

export interface DupDecision {
  same: boolean;
  confidence: number;
  reason: string;
  engine: string;
  model?: string;
}

function posting(job: JobRow): string {
  const lines = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    job.location ? `Location: ${job.location}` : "",
    job.remote ? "Remote: yes" : "",
    job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
    "",
    truncate(job.description.replace(/\s+/g, " "), 1200),
  ].filter(Boolean);
  return lines.join("\n");
}

interface SystemOneAnswer {
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  answer_confidence?: number;
  probabilities?: Record<string, number>;
}

interface SystemOneResponse {
  answers?: { same_role?: SystemOneAnswer };
  error?: string;
}

/** Ask the local Laya server whether two postings are the same role. */
async function decideViaLaya(a: JobRow, b: JobRow): Promise<DupDecision> {
  const cfg = layaConfig();
  if (!cfg) throw new Error("Laya is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(systemOneEndpoint(cfg.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        state: {
          posting_a: posting(a),
          posting_b: posting(b),
        },
        questions: {
          same_role: {
            type: "choice",
            instructions:
              "Is posting B the SAME job title/role as posting A? Judge the ROLE, not the company.",
            criteria: {
              same: "the job title/role is the same; only wording, seniority abbreviations or location differ",
              different:
                "the titles describe different roles, even if the company or seniority matches",
            },
          },
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Laya HTTP ${res.status}: ${truncate(body, 200)}`);
  }

  const data = (await res.json()) as SystemOneResponse;
  if (data.error) throw new Error(`Laya error: ${data.error}`);
  const answer = data.answers?.same_role;
  if (!answer) throw new Error("Laya returned no `same_role` answer.");

  // Prefer explicit probabilities; some auto-routed builds use a `noul`
  // probability instead of a label. `confidence` alone can be a calibration
  // factor, so use `answer_confidence` / `probabilities` when available.
  const pSame = answer.probabilities?.same;
  let same: boolean;
  let confidence: number;
  if (typeof pSame === "number") {
    same = pSame >= 0.5;
    confidence = Math.max(pSame, 1 - pSame);
  } else if (typeof answer.noul === "number") {
    same = answer.noul >= 0.5;
    confidence = Math.abs(answer.noul - 0.5) * 2;
  } else {
    same = (answer.choice ?? "").toLowerCase() === "same";
    confidence =
      typeof answer.answer_confidence === "number"
        ? answer.answer_confidence
        : typeof answer.confidence === "number"
          ? answer.confidence
          : 0.5;
  }

  return {
    same,
    confidence,
    reason: answer.choice ? `Laya chose "${answer.choice}".` : "Laya decision.",
    engine: "laya",
  };
}

interface RawLlmDecision {
  same?: boolean;
  confidence?: number;
  reason?: string;
}

/** Fallback: ask the configured OpenAI-compatible LLM. */
async function decideViaLlm(a: JobRow, b: JobRow): Promise<DupDecision> {
  const prompt = `Two job postings may be duplicates (the same role cross-posted to multiple boards). Decide.

POSTING A
${posting(a)}

POSTING B
${posting(b)}

Return ONLY JSON: {"same":true|false,"confidence":0-1,"reason":"<one line>"}`;
  const { data, model } = await chatJson<RawLlmDecision>(prompt, {
    system: "You detect duplicate job postings. Reply with JSON only.",
  });
  return {
    same: data.same === true,
    confidence:
      typeof data.confidence === "number"
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.5,
    reason: data.reason ?? "",
    engine: "llm",
    model,
  };
}

/**
 * Decide whether two postings are the same role. Uses local Laya when
 * configured, otherwise the LLM. Returns `null` when nothing is configured.
 */
export async function decideDuplicate(
  a: JobRow,
  b: JobRow,
): Promise<DupDecision | null> {
  if (layaInfo().configured) return decideViaLaya(a, b);
  try {
    return await decideViaLlm(a, b);
  } catch (e) {
    if ((e as Error).message.includes("LLM not configured")) return null;
    throw e;
  }
}
