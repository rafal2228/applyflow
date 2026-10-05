import {
  candidateFingerprints,
  clearPendingDuplicates,
  duplicateReviewCounts,
  getJob,
  highConfidencePairIds,
  listJobs,
  pendingDuplicateReviews,
  resolveDuplicatePair,
  saveDuplicateCandidate,
  saveFingerprint,
  setDuplicateDecision,
} from "./db";
import { companySimilarity, fingerprintJob, similarity } from "./fingerprint";
import { decideDuplicate, layaInfo } from "./laya";
import { llmInfo } from "./llm";
import { truncate } from "./util";

/**
 * Duplicate review pipeline.
 *
 *   1. On ingest we fingerprint the offer and use LSH band collisions to find
 *      a handful of candidates (the "bloom filter" narrowing) — no table scan.
 *   2. Pairs above `DUPLICATE_THRESHOLD` are recorded as `pending` and both
 *      offers are flagged in the UI. Nothing is dropped.
 *   3. A scan asks the local decision engine (Laya) to judge each pending pair.
 *      The verdict informs the reviewer but never auto-drops: a human confirms
 *      ("mark duplicate") or dismisses ("keep both").
 */

function envThreshold(): number {
  const n = Number(process.env.DUPLICATE_THRESHOLD);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0.2, Math.min(0.95, n));
}

export const DUPLICATE_THRESHOLD = envThreshold();
export const MAX_CANDIDATES = 8;

function envAcceptConfidence(): number {
  const n = Number(process.env.DUPLICATE_ACCEPT_CONFIDENCE);
  if (!Number.isFinite(n)) return 0.8;
  return Math.max(0.5, Math.min(1, n));
}

/** AI confidence at or above which "accept all" will auto-confirm a pair. */
export const ACCEPT_CONFIDENCE = envAcceptConfidence();

/**
 * Pending pairs the engine judged with at least `min` confidence. `decision`
 * selects the verdict to act on: "same" (confirm) or "different" (dismiss).
 */
export function highConfidencePairs(
  min = ACCEPT_CONFIDENCE,
  decision: "same" | "different" = "same",
): { id: string; score: number }[] {
  return highConfidencePairIds(min, decision);
}

export interface IndexStats {
  indexed: number;
  candidates: number;
}

export interface ScanStats {
  scanned: number;
  same: number;
  different: number;
  skipped: number;
  errors: string[];
}

/** Index one job and record its candidate pairs. Safe to call on every ingest. */
export function recordDuplicateCandidates(jobId: string): IndexStats {
  const job = getJob(jobId);
  if (!job) return { indexed: 0, candidates: 0 };

  const fp = fingerprintJob(job);
  if (fp.tokens === 0) return { indexed: 0, candidates: 0 };
  saveFingerprint(jobId, fp);

  const candidates = candidateFingerprints(fp.bands, jobId, MAX_CANDIDATES * 6)
    .map((c) => {
      const cand = getJob(c.jobId);
      return {
        ...c,
        sim: similarity(fp, c),
        companySim: companySimilarity(job.company, cand?.company ?? ""),
        source: cand?.source ?? "",
      };
    })
    // A different board cross-posting the same role is the interesting case; the
    // same board listing one role per region is not a duplicate to review.
    .filter(
      (c) =>
        c.source !== job.source &&
        c.sim >= DUPLICATE_THRESHOLD &&
        c.companySim >= 0.2,
    )
    .sort((a, b) => b.sim - a.sim || b.sharedBands - a.sharedBands)
    .slice(0, MAX_CANDIDATES);

  for (const c of candidates) {
    saveDuplicateCandidate({
      jobId,
      candidateId: c.jobId,
      score: c.sim,
      sharedBands: c.sharedBands,
    });
  }
  return { indexed: 1, candidates: candidates.length };
}

/** Re-fingerprint every job and rebuild the candidate pairs from scratch. */
export function rebuildDuplicateCandidates(): IndexStats {
  clearPendingDuplicates();
  const total: IndexStats = { indexed: 0, candidates: 0 };
  for (const job of listJobs()) {
    const s = recordDuplicateCandidates(job.id);
    total.indexed += s.indexed;
    total.candidates += s.candidates;
  }
  return total;
}

/** True when at least one decision engine (Laya or LLM) is configured. */
export function decisionEngineAvailable(): boolean {
  return layaInfo().configured || llmInfo().configured;
}

/**
 * Run the decision engine over pending pairs. Updates their verdict but leaves
 * the review status to a human.
 */
export async function scanPendingDuplicates(limit = 25): Promise<ScanStats> {
  const stats: ScanStats = {
    scanned: 0,
    same: 0,
    different: 0,
    skipped: 0,
    errors: [],
  };
  const pending = pendingDuplicateReviews(limit);

  for (const pair of pending) {
    try {
      const decision = await decideDuplicate(pair.job, pair.candidate);
      if (!decision) {
        stats.skipped++;
        continue;
      }
      setDuplicateDecision(pair.id, {
        engine: decision.engine,
        decision: decision.same ? "same" : "different",
        confidence: decision.confidence,
        reason: decision.reason,
      });
      stats.scanned++;
      if (decision.same) stats.same++;
      else stats.different++;
    } catch (e) {
      stats.errors.push(
        `${truncate(pair.job.title, 40)}: ${(e as Error).message}`,
      );
    }
  }
  return stats;
}

/**
 * Bulk-resolve every pending pair the engine judged with at least `min`
 * confidence. `decision` = "same" confirms duplicates (archives + links the
 * newer offer, like "Mark duplicate"); "different" dismisses them (like
 * "Keep both"). Human review is optional; the caller opts in.
 */
export function acceptHighConfidence(
  min = ACCEPT_CONFIDENCE,
  dryRun = false,
  decision: "same" | "different" = "same",
): { accepted: number; ids: string[] } {
  const pairs = highConfidencePairs(min, decision);
  if (dryRun) return { accepted: pairs.length, ids: pairs.map((p) => p.id) };
  const resolve = decision === "same" ? "mark" : "keep";
  const ids: string[] = [];
  for (const pair of pairs) {
    if (resolveDuplicatePair(pair.id, resolve)) ids.push(pair.id);
  }
  return { accepted: ids.length, ids };
}

export interface DuplicateCounts {
  pending: number;
  confirmed: number;
  dismissed: number;
}

export function duplicateCounts(): DuplicateCounts {
  return duplicateReviewCounts();
}
