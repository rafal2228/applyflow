"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  DownloadCloud,
  FileText,
  Gauge,
  Loader2,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RunState } from "@/lib/pipeline";

interface SourceInfo {
  name: string;
  label: string;
}

interface PipelineInfo {
  available: boolean;
  sources: SourceInfo[];
  runs: RunState[];
}

interface MarketRow {
  keyword: string;
  pl: number;
  remoteGlobal: number;
}

const ACTIONS: {
  action: string;
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline";
}[] = [
  { action: "daily", label: "Daily run", icon: <CalendarClock />, variant: "default" },
  { action: "expire", label: "Expire stale", icon: <Gauge />, variant: "outline" },
  { action: "digest", label: "Write digest", icon: <FileText />, variant: "outline" },
  { action: "monitor", label: "Market snapshot", icon: <RefreshCw />, variant: "outline" },
];

export default function ToolsPanel({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<PipelineInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<RunState | null>(null);
  const [starting, setStarting] = useState(false);
  const [market, setMarket] = useState<MarketRow[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  const loadInfo = useCallback(async () => {
    const res = await fetch("/api/pipeline", { cache: "no-store" });
    const data = (await res.json()) as PipelineInfo;
    setInfo(data);
    if (selected.size === 0)
      setSelected(new Set(data.sources.map((s) => s.name)));
  }, [selected.size]);

  const loadMarket = useCallback(async () => {
    const res = await fetch("/api/market", { cache: "no-store" });
    if (res.ok) setMarket((await res.json()).counts as MarketRow[]);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadInfo();
    void loadMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Poll the active run.
  useEffect(() => {
    if (!run?.running) return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/pipeline/${run.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { run: RunState };
      setRun(data.run);
      if (!data.run.running) {
        clearInterval(id);
        onChanged();
        void loadInfo();
        if (data.run.exitCode === 0) toast.success(`${data.run.label} finished`);
        else toast.error(`${data.run.label} failed (code ${data.run.exitCode})`);
      }
    }, 1200);
    return () => clearInterval(id);
  }, [run?.running, run?.id, onChanged, loadInfo]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.lines.length]);

  async function startAction(action: string, sources?: string[]) {
    setStarting(true);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sources }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start");
      setRun(data.run as RunState);
      toast.message(`${data.run.label} started`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function toggle(name: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }

  const total = market.reduce(
    (a, r) => ({ pl: a.pl + r.pl, rg: a.rg + r.remoteGlobal }),
    { pl: 0, rg: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find &amp; pipeline tools</DialogTitle>
          <DialogDescription>
            Run discovery and maintenance (discover · expire · digest · market)
            and watch the output live.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="find" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="find">Find jobs</TabsTrigger>
            <TabsTrigger value="runs">Run log</TabsTrigger>
            <TabsTrigger value="market">Market</TabsTrigger>
          </TabsList>

          <TabsContent value="find" className="grid gap-4 pt-3">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sources
                </span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setSelected(new Set(info?.sources.map((s) => s.name)))
                    }
                  >
                    All
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelected(new Set())}
                  >
                    None
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {info?.sources.map((s) => (
                  <label key={s.name} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(s.name)}
                      onCheckedChange={() => toggle(s.name)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={starting || !selected.size}
                onClick={() => startAction("discover", [...selected])}
              >
                <DownloadCloud />
                Discover selected
              </Button>
              {ACTIONS.map((a) => (
                <Button
                  key={a.action}
                  variant={a.variant ?? "outline"}
                  disabled={starting}
                  onClick={() => startAction(a.action)}
                >
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              After discovering, use “Grade new” on the board to score what came
              in through your OpenAI-compatible endpoint.
            </p>
          </TabsContent>

          <TabsContent value="runs" className="grid min-h-0 gap-2 pt-3">
            {run ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {run.running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlayCircle className="size-4" />
                  )}
                  <span className="font-medium">{run.label}</span>
                  <span className="text-muted-foreground">
                    {run.running
                      ? "running…"
                      : `exit ${run.exitCode}`}
                  </span>
                </div>
                <ScrollArea className="h-64 rounded-lg border bg-muted/40">
                  <pre
                    ref={logRef}
                    className="max-h-64 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap"
                  >
                    {run.lines.join("\n") || "…"}
                  </pre>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No run yet. Start one from the “Find jobs” tab.
              </p>
            )}
          </TabsContent>

          <TabsContent value="market" className="grid gap-3 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Matching postings — Poland{" "}
                <strong className="text-foreground">{total.pl}</strong> · global
                remote <strong className="text-foreground">{total.rg}</strong>
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const res = await fetch("/api/market", { method: "POST" });
                  if (res.ok) {
                    setMarket((await res.json()).counts as MarketRow[]);
                    toast.success("Snapshot saved");
                  }
                }}
              >
                <RefreshCw />
                Take snapshot
              </Button>
            </div>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Keyword</th>
                    <th className="px-3 py-2 text-right font-medium">Poland</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Global remote
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {market.map((r) => (
                    <tr key={r.keyword} className="border-b last:border-0">
                      <td className="px-3 py-1.5">{r.keyword}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.pl}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.remoteGlobal}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
