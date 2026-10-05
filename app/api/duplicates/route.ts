import {
  clearPendingDuplicates,
  listDuplicateReviews,
  listDuplicateReviewsPage,
} from "@/lib/db";
import {
  ACCEPT_CONFIDENCE,
  DUPLICATE_THRESHOLD,
  acceptHighConfidence,
  duplicateCounts,
  decisionEngineAvailable,
  highConfidencePairs,
  rebuildDuplicateCandidates,
  scanPendingDuplicates,
} from "@/lib/duplicates";
import { layaInfo } from "@/lib/laya";
import { llmInfo } from "@/lib/llm";
import type { DuplicateStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUSES: DuplicateStatus[] = ["pending", "confirmed", "dismissed"];

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || raw === null || raw === "") return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Duplicate review queue (paginated) + engine status. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  const filter = STATUSES.includes(status as DuplicateStatus)
    ? (status as DuplicateStatus)
    : undefined;
  const limit = clampInt(params.get("limit"), 25, 1, 100);
  const offset = clampInt(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const page = listDuplicateReviewsPage(filter, limit, offset);
  return Response.json({
    reviews: page.reviews,
    total: page.total,
    limit,
    offset,
    counts: duplicateCounts(),
    threshold: DUPLICATE_THRESHOLD,
    accept: {
      threshold: ACCEPT_CONFIDENCE,
      same: highConfidencePairs(ACCEPT_CONFIDENCE, "same").length,
      different: highConfidencePairs(ACCEPT_CONFIDENCE, "different").length,
    },
    engine: {
      available: decisionEngineAvailable(),
      laya: layaInfo(),
      llm: llmInfo(),
    },
  });
}

/** `scan` (AI over pending pairs), `rebuild` (re-fingerprint all), `rescan`. */
export async function POST(req: Request) {
  let body: {
    action?: string;
    limit?: number;
    minConfidence?: number;
    dryRun?: boolean;
    decision?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body → default action */
  }
  const action = body.action ?? "scan";

  try {
    const rebuild =
      action === "rebuild" || action === "rescan"
        ? rebuildDuplicateCandidates()
        : undefined;
    const scan =
      action === "scan" || action === "rescan"
        ? await scanPendingDuplicates(body.limit ?? 25)
        : undefined;
    const cleared = action === "clear" ? clearPendingDuplicates() : undefined;
    const accepted =
      action === "accept"
        ? acceptHighConfidence(
            body.minConfidence,
            body.dryRun,
            body.decision === "different" ? "different" : "same",
          )
        : undefined;
    if (
      !rebuild &&
      !scan &&
      cleared === undefined &&
      accepted === undefined
    ) {
      return Response.json(
        {
          error: `Unknown action "${action}". Expected scan | rebuild | rescan | clear | accept.`,
        },
        { status: 400 },
      );
    }
    return Response.json({
      rebuild,
      scan,
      cleared,
      accepted,
      counts: duplicateCounts(),
      reviews: listDuplicateReviews("pending", 25),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
