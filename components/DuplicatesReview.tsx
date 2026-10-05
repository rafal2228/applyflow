"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  GitMerge,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { DuplicateReview, DuplicateStatus } from "@/lib/types";

interface DuplicatesResponse {
  reviews: DuplicateReview[];
  total: number;
  limit: number;
  offset: number;
  counts: { pending: number; confirmed: number; dismissed: number };
  threshold: number;
  accept: { threshold: number; same: number; different: number };
  engine: {
    available: boolean;
    laya: { configured: boolean; endpoint?: string };
    llm: { configured: boolean; model?: string };
  };
}

const FILTERS: { value: DuplicateStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 25;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function decisionBadge(r: DuplicateReview) {
  if (r.decision === "exact") return <Badge variant="secondary">Exact key</Badge>;
  if (r.decision === "same")
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
        AI: same role {r.confidence != null ? pct(r.confidence) : ""}
      </Badge>
    );
  if (r.decision === "different")
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-700">
        AI: different {r.confidence != null ? pct(r.confidence) : ""}
      </Badge>
    );
  return <Badge variant="outline">Not judged</Badge>;
}

export default function DuplicatesReview({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<DuplicatesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<DuplicateStatus | "all">("pending");
  const [busy, setBusy] = useState<"scan" | "rebuild" | "accept" | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "same" | "different" | null
  >(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (filter !== "all") qs.set("status", filter);
      const res = await fetch(`/api/duplicates?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok)
        throw new Error(`Could not load duplicates (HTTP ${res.status}).`);
      setData((await res.json()) as DuplicatesResponse);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Step back if the current page emptied out (e.g. after resolving pairs).
  useEffect(() => {
    if (data && page > 0 && page * PAGE_SIZE >= data.total) {
      setPage((p) => Math.max(0, p - 1));
    }
  }, [data, page]);

  async function run(action: "scan" | "rebuild" | "rescan") {
    setBusy(action === "rescan" ? "scan" : action);
    const t = toast.loading(
      action === "rebuild" ? "Rebuilding fingerprints…" : "Scanning duplicates…",
    );
    try {
      const res = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, limit: 50 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");
      const scan = json.scan as { scanned: number; same: number } | undefined;
      toast.success(
        action === "rebuild"
          ? "Fingerprints rebuilt"
          : `Judged ${scan?.scanned ?? 0} pair(s) · ${scan?.same ?? 0} same role`,
        { id: t },
      );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(null);
    }
  }

  async function resolve(id: string, action: "keep" | "mark") {
    setResolving(id);
    try {
      const res = await fetch(`/api/duplicates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not update");
      toast.success(action === "mark" ? "Marked as duplicate" : "Kept both");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResolving(null);
    }
  }

  async function acceptAll(decision: "same" | "different") {
    const min = data?.accept?.threshold ?? 0.8;
    setBusy("accept");
    const t = toast.loading(
      decision === "same"
        ? "Confirming high-confidence duplicates…"
        : "Dismissing high-confidence non-duplicates…",
    );
    try {
      const res = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", minConfidence: min, decision }),
      });
      const json = (await res.json()) as {
        accepted?: { accepted: number };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Could not update");
      const n = json.accepted?.accepted ?? 0;
      toast.success(
        decision === "same"
          ? `Confirmed ${n} duplicate(s)`
          : `Dismissed ${n} pair(s)`,
        { id: t },
      );
      setConfirmAction(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(null);
    }
  }

  // Only report the engine as missing once the queue has actually loaded — on
  // the very first render `data` is null, so `engine` is undefined and the
  // "No decision engine configured" notice would flash (for as long as the
  // fetch takes) even when an engine is configured.
  if (!data) {
    return (
      <div className="grid gap-3 pt-3">
        {loadError ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {loadError}
          </p>
        ) : (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading duplicate queue…
          </div>
        )}
      </div>
    );
  }

  const reviews = data.reviews;
  const engine = data?.engine;
  const acceptThreshold = data?.accept?.threshold ?? 0.8;
  const acceptSame = data?.accept?.same ?? 0;
  const acceptDifferent = data?.accept?.different ?? 0;

  return (
    <div className="grid gap-3 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Engine:{" "}
          {engine?.laya.configured ? (
            <strong className="text-foreground">Laya (local)</strong>
          ) : engine?.llm.configured ? (
            <strong className="text-foreground">LLM fallback</strong>
          ) : (
            <strong className="text-foreground">none — manual review only</strong>
          )}
        </span>
        {data && <span>· similarity threshold {pct(data.threshold)}</span>}
        {data && (
          <span>
            · {data.counts.pending} pending · {data.counts.confirmed} confirmed
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("rebuild")}
          >
            {busy === "rebuild" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Rebuild
          </Button>
          <Button
            size="xs"
            disabled={busy !== null || !engine?.available}
            title={engine?.available ? undefined : "Configure LAYA_BASE_URL or OPENAI_*"}
            onClick={() => run("scan")}
          >
            {busy === "scan" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI scan
          </Button>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2">
          <GitMerge className="size-3.5 shrink-0 text-emerald-600" />
          <span>
            {acceptSame > 0
              ? `${acceptSame} pair${acceptSame === 1 ? "" : "s"} judged the same role at ≥ ${pct(acceptThreshold)}.`
              : `No same-role pair reaches ≥ ${pct(acceptThreshold)} yet.`}
          </span>
          {confirmAction === "same" ? (
            <>
              <Button
                size="xs"
                className="ml-auto"
                disabled={busy !== null}
                onClick={() => acceptAll("same")}
              >
                {busy === "accept" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Check />
                )}
                Confirm {acceptSame}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={acceptSame === 0 || busy !== null}
              title={
                acceptSame === 0
                  ? `No same-role pairs at ≥ ${pct(acceptThreshold)}`
                  : `Confirm ${acceptSame} duplicate(s)`
              }
              onClick={() => setConfirmAction("same")}
            >
              <GitMerge />
              Accept same{acceptSame > 0 ? ` (${acceptSame})` : ""}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          <X className="size-3.5 shrink-0" />
          <span>
            {acceptDifferent > 0
              ? `${acceptDifferent} pair${acceptDifferent === 1 ? "" : "s"} judged different at ≥ ${pct(acceptThreshold)}.`
              : `No different-role pair reaches ≥ ${pct(acceptThreshold)} yet.`}
          </span>
          {confirmAction === "different" ? (
            <>
              <Button
                size="xs"
                className="ml-auto"
                disabled={busy !== null}
                onClick={() => acceptAll("different")}
              >
                {busy === "accept" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Check />
                )}
                Confirm {acceptDifferent}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={acceptDifferent === 0 || busy !== null}
              title={
                acceptDifferent === 0
                  ? `No different-role pairs at ≥ ${pct(acceptThreshold)}`
                  : `Dismiss ${acceptDifferent} pair(s)`
              }
              onClick={() => setConfirmAction("different")}
            >
              <X />
              Dismiss different{acceptDifferent > 0 ? ` (${acceptDifferent})` : ""}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="xs"
            variant={filter === f.value ? "secondary" : "ghost"}
            onClick={() => {
              setFilter(f.value);
              setPage(0);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {!engine?.available && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No decision engine configured. Pairs are still found by fingerprint and
          queued for manual review. Run the local Laya server and set{" "}
          <code>LAYA_BASE_URL</code> (or set <code>OPENAI_*</code>) to get AI
          verdicts.
        </p>
      )}

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
          <Copy className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No {filter === "all" ? "" : filter} duplicate candidates.
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-[52vh]">
          <div className="grid gap-2 pr-2">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {pct(r.score)}
                  </Badge>
                  {decisionBadge(r)}
                  {r.sharedBands > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {r.sharedBands} shared band{r.sharedBands === 1 ? "" : "s"}
                    </span>
                  )}
                  {r.status !== "pending" && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "ml-auto",
                        r.status === "confirmed" && "text-emerald-700",
                      )}
                    >
                      {r.status}
                    </Badge>
                  )}
                </div>

                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {[r.job, r.candidate].map((j, i) => (
                    <a
                      key={j.id}
                      href={j.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2 transition hover:bg-muted"
                    >
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {i === 0 ? "Newer" : "Existing"} · {j.source}
                      </div>
                      <div className="truncate text-sm font-medium">{j.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {j.company}
                        {j.location ? ` · ${j.location}` : ""}
                      </div>
                    </a>
                  ))}
                </div>

                {r.reason && (
                  <p className="mt-2 text-xs text-muted-foreground">{r.reason}</p>
                )}

                {r.status === "pending" ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={resolving === r.id}
                      onClick={() => resolve(r.id, "keep")}
                    >
                      <X />
                      Keep both
                    </Button>
                    <Button
                      size="xs"
                      disabled={resolving === r.id}
                      onClick={() => resolve(r.id, "mark")}
                      title="Mark the newer offer as a duplicate and archive it"
                    >
                      {resolving === r.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <GitMerge />
                      )}
                      Mark duplicate
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="size-3.5" />
                    {r.status === "confirmed"
                      ? "Confirmed — newer offer archived"
                      : "Dismissed — kept both"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {data.total > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} of{" "}
            {data.total}
          </span>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={page === 0 || busy !== null}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= data.total || busy !== null}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
