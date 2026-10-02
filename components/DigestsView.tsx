"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import Markdown from "./Markdown";

interface DigestListItem {
  day: string;
  updatedAt: string;
  preview: string;
}

interface DigestRecord {
  day: string;
  markdown: string;
  updatedAt: string | null;
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function DigestsView() {
  const [list, setList] = useState<DigestListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const open = useCallback(async (day: string) => {
    setSelected(day);
    setDigest(null);
    setMissing(false);
    const res = await fetch(`/api/digest?day=${encodeURIComponent(day)}`, {
      cache: "no-store",
    });
    if (res.ok) setDigest((await res.json()).digest as DigestRecord);
    else setMissing(true);
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/digest", { cache: "no-store" });
      const items = ((await res.json()).digests ?? []) as DigestListItem[];
      setList(items);
      if (items[0]) await open(items[0].day);
      else {
        setSelected(null);
        setDigest(null);
      }
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function generate() {
    setBusy(true);
    const t = toast.loading("Generating digest…");
    try {
      const res = await fetch("/api/digest", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Digest ready", { id: t });
      const itemsRes = await fetch("/api/digest", { cache: "no-store" });
      setList(((await itemsRes.json()).digests ?? []) as DigestListItem[]);
      await open((data.digest as DigestRecord).day);
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="flex min-h-0 flex-col rounded-xl border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">History</span>
          <Button size="xs" variant="ghost" onClick={loadList} title="Refresh">
            <RefreshCw />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 p-2">
            {list.map((d) => (
              <button
                key={d.day}
                onClick={() => open(d.day)}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-left transition",
                  selected === d.day
                    ? "bg-muted ring-1 ring-foreground/10"
                    : "hover:bg-muted/60",
                )}
              >
                <span className="block text-sm font-medium">{formatDay(d.day)}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {d.preview || "—"}
                </span>
              </button>
            ))}
            {list.length === 0 && !loading && (
              <p className="p-3 text-center text-sm text-muted-foreground">
                No digests yet.
              </p>
            )}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-h-0 flex-col rounded-xl border">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {digest ? formatDay(digest.day) : "Digest"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {digest?.updatedAt
                ? `Updated ${new Date(digest.updatedAt).toLocaleString()}`
                : "Daily shortlist & market summary"}
            </div>
          </div>
          <Button size="sm" onClick={generate} disabled={busy}>
            <Sparkles />
            {busy ? "Generating…" : "Generate today"}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {digest ? (
              <Markdown>{digest.markdown}</Markdown>
            ) : missing ? (
              <p className="text-sm text-muted-foreground">Digest not found.</p>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <FileText className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No digests yet — generate today&apos;s to see your shortlist and
                  market summary.
                </p>
                <Button size="sm" onClick={generate} disabled={busy}>
                  <Sparkles />
                  Generate today
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
