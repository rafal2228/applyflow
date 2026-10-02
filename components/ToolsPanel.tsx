"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  DownloadCloud,
  FileText,
  Gauge,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { RunState, RunSummary } from "@/lib/pipeline";

interface SourceInfo {
  name: string;
  label: string;
}

interface PipelineInfo {
  available: boolean;
  sources: SourceInfo[];
  runs: RunSummary[];
}

interface MarketRow {
  keyword: string;
  pl: number;
  remoteGlobal: number;
}

const MAINTENANCE: {
  action: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  primary?: boolean;
}[] = [
  {
    action: "daily",
    title: "Daily run",
    description:
      "The full pass: discover new jobs, expire stale ones, then write the digest.",
    icon: <CalendarClock />,
    primary: true,
  },
  {
    action: "expire",
    title: "Expire stale",
    description:
      "Mark active jobs not seen in discovery for 14 days as expired.",
    icon: <Gauge />,
  },
  {
    action: "digest",
    title: "Write digest",
    description:
      "Build today's shortlist and market summary into digest/latest.md.",
    icon: <FileText />,
  },
  {
    action: "monitor",
    title: "Market snapshot",
    description:
      "Record today's keyword counts (Poland vs global remote) for trends.",
    icon: <RefreshCw />,
  },
];

function elapsedText(
  startedAt: string,
  finishedAt: string | null,
  now: number,
): string {
  const end = finishedAt ? Date.parse(finishedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function RunStatusIcon({ run }: { run: { running: boolean; exitCode: number | null } }) {
  if (run.running)
    return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  if (run.exitCode === 0)
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
  return <XCircle className="size-4 shrink-0 text-destructive" />;
}

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
  const [tab, setTab] = useState("find");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [starting, setStarting] = useState(false);
  const [market, setMarket] = useState<MarketRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const logRef = useRef<HTMLPreElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const initializedSources = useRef(false);
  const notified = useRef<Set<string>>(new Set());

  const selectRun = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedRunId(id);
  }, []);

  const loadMarket = useCallback(async () => {
    const res = await fetch("/api/market", { cache: "no-store" });
    if (res.ok) setMarket((await res.json()).counts as MarketRow[]);
  }, []);

  // Single poll loop: refreshes the run list, the selected run, market, clock.
  useEffect(() => {
    if (!open) return;
    let alive = true;

    const tick = async () => {
      setNow(Date.now());
      try {
        const res = await fetch("/api/pipeline", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as PipelineInfo;
        setInfo({ available: data.available, sources: data.sources, runs: data.runs });
        setRuns(data.runs);

        if (!initializedSources.current && data.sources.length) {
          setSelected(new Set(data.sources.map((s) => s.name)));
          initializedSources.current = true;
        }

        // Follow the running run (or keep the current selection if still valid).
        let id = selectedIdRef.current;
        const running = data.runs.find((r) => r.running);
        if ((!id || !data.runs.some((r) => r.id === id)) && running) {
          id = running.id;
          selectRun(id);
        } else if (!id && data.runs[0]) {
          id = data.runs[0].id;
          selectRun(id);
        }

        if (id) {
          const rr = await fetch(`/api/pipeline/${id}`, { cache: "no-store" });
          if (rr.ok && alive) {
            const { run: full } = (await rr.json()) as { run: RunState };
            setRun(full);
            if (!full.running && !notified.current.has(full.id)) {
              notified.current.add(full.id);
              onChanged();
              if (full.exitCode === 0) toast.success(`${full.label} finished`);
              else toast.error(`${full.label} failed (exit ${full.exitCode})`);
            }
          }
        }
      } catch {
        /* ignore transient errors */
      }
    };

    void tick();
    void loadMarket();
    const int = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(int);
    };
  }, [open, selectRun, onChanged, loadMarket]);

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
      const newRun = data.run as RunState;
      notified.current.delete(newRun.id);
      selectRun(newRun.id);
      setRun(newRun);
      setTab("jobs");
      toast.message(`${newRun.label} started`);
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

  const runningRun = runs.find((r) => r.running) ?? null;
  const runningCount = runs.filter((r) => r.running).length;
  const total = market.reduce(
    (a, r) => ({ pl: a.pl + r.pl, rg: a.rg + r.remoteGlobal }),
    { pl: 0, rg: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find jobs &amp; maintenance</DialogTitle>
          <DialogDescription>
            Discover postings and run upkeep. Background jobs keep running while
            you work — track them under “Jobs”.
          </DialogDescription>
        </DialogHeader>

        {runningRun && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <span className="font-medium">{runningRun.label}</span>
            <span className="text-muted-foreground">
              running · {elapsedText(runningRun.startedAt, null, now)}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                selectRun(runningRun.id);
                setTab("jobs");
              }}
            >
              View progress
            </Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="find">Find jobs</TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs
              {runningCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1.5">
                  {runningCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="market">Market</TabsTrigger>
          </TabsList>

          {/* ------------------------------- Find ------------------------------- */}
          <TabsContent value="find" className="grid gap-4 pt-3">
            <section className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <DownloadCloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Discover new jobs</h3>
                  <p className="text-xs text-muted-foreground">
                    Pull fresh postings from the selected sources into your
                    board. Cross-board duplicates are skipped automatically.
                  </p>
                </div>
                <Button
                  className="ml-auto shrink-0"
                  size="sm"
                  disabled={starting || !selected.size}
                  onClick={() => startAction("discover", [...selected])}
                >
                  Discover ({selected.size})
                </Button>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
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
                  <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
                    None
                  </Button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
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
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Maintenance
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {MAINTENANCE.map((a) => (
                  <div
                    key={a.action}
                    className="flex flex-col gap-1.5 rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="text-muted-foreground [&_svg]:size-4">
                        {a.icon}
                      </span>
                      {a.title}
                    </div>
                    <p className="flex-1 text-xs text-muted-foreground">
                      {a.description}
                    </p>
                    <div>
                      <Button
                        size="xs"
                        variant={a.primary ? "default" : "outline"}
                        disabled={starting}
                        onClick={() => startAction(a.action)}
                      >
                        Run
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              After discovering, use “Grade new” on the board to score what came
              in through your OpenAI-compatible endpoint.
            </p>
          </TabsContent>

          {/* ------------------------------- Jobs ------------------------------- */}
          <TabsContent value="jobs" className="min-h-0 pt-3">
            {runs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
                <ListChecks className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No background jobs yet.
                </p>
                <Button size="sm" variant="outline" onClick={() => setTab("find")}>
                  Start one from “Find jobs”
                </Button>
              </div>
            ) : (
              <div className="grid min-h-0 gap-3 sm:grid-cols-[240px_1fr]">
                <div className="flex max-h-80 flex-col gap-1 overflow-y-auto sm:max-h-[52vh]">
                  {runs.map((r) => {
                    const active = r.id === selectedRunId;
                    return (
                      <button
                        key={r.id}
                        onClick={() => selectRun(r.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition",
                          active
                            ? "bg-muted ring-1 ring-foreground/10"
                            : "hover:bg-muted/60",
                        )}
                      >
                        <RunStatusIcon run={r} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {r.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {r.running
                              ? `running · ${elapsedText(r.startedAt, null, now)}`
                              : r.exitCode === 0
                                ? `done · ${elapsedText(r.startedAt, r.finishedAt, now)}`
                                : `failed · ${elapsedText(r.startedAt, r.finishedAt, now)}`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex min-h-0 flex-col gap-2">
                  {run ? (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        <RunStatusIcon run={run} />
                        <span className="font-medium">{run.label}</span>
                        <span className="text-muted-foreground">
                          {run.running
                            ? `running · ${elapsedText(run.startedAt, null, now)}`
                            : `exit ${run.exitCode} · ${elapsedText(run.startedAt, run.finishedAt, now)}`}
                        </span>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        {run.running ? (
                          <div className="progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
                        ) : (
                          <div
                            className={cn(
                              "h-full w-full rounded-full",
                              run.exitCode === 0
                                ? "bg-emerald-500"
                                : "bg-destructive",
                            )}
                          />
                        )}
                      </div>

                      <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-muted/40">
                        <pre
                          ref={logRef}
                          className="max-h-[46vh] overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap"
                        >
                          {run.lines.join("\n") || "…"}
                        </pre>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Select a job to see its log.
                    </p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ------------------------------ Market ------------------------------ */}
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
