"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  GitMerge,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { statusDotClass } from "@/lib/ui";
import {
  BACKLOG_STATUSES,
  OPEN_STATUSES,
  STATUS_LABELS,
  type GradeRunState,
  type JobRow,
  type JobStatus,
} from "@/lib/types";
import {
  DEFAULT_FILTERS,
  applyBoardFilters,
  type BoardFiltersState,
} from "@/lib/filters";
import BoardFilters from "./BoardFilters";
import JobCard from "./JobCard";
import JobDrawer from "./JobDrawer";
import NewOfferModal from "./NewOfferModal";
import ToolsPanel from "./ToolsPanel";

interface GraderProps {
  configured: boolean;
  model?: string;
  endpoint?: string;
}

export default function Board({
  initialJobs,
  grader,
}: {
  initialJobs: JobRow[];
  grader: GraderProps;
}) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<BoardFiltersState>({ ...DEFAULT_FILTERS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [gradingIds, setGradingIds] = useState<Set<string>>(new Set());
  const [gradeRun, setGradeRun] = useState<GradeRunState | null>(null);
  const [dragOver, setDragOver] = useState<JobStatus | null>(null);
  const [runningCount, setRunningCount] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (res.ok) setJobs((await res.json()).jobs as JobRow[]);
  }, []);

  // Surface background jobs in the header while they run.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/pipeline", { cache: "no-store" });
        if (res.ok && alive) {
          const data = (await res.json()) as { runs: { running: boolean }[] };
          setRunningCount(data.runs.filter((r) => r.running).length);
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Track the background grading run and refresh when it finishes.
  useEffect(() => {
    let alive = true;
    let wasRunning = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/grade", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { run?: GradeRunState | null };
        const run = data.run ?? null;
        setGradeRun(run);
        const running = !!run?.running;
        if (wasRunning && !running) {
          void refresh();
          if (run?.cancelled)
            toast.message(`Grading stopped — ${run.done} graded`);
          else if (run && run.failed > 0)
            toast.error(`Grading finished with ${run.failed} error(s)`);
          else if (run) toast.success(`Graded ${run.done} offer(s)`);
        }
        wasRunning = running;
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refresh]);

  const ungraded = useMemo(
    () =>
      jobs.filter(
        (j) => !j.grade && (j.status === "new" || j.status === "shortlisted"),
      ).length,
    [jobs],
  );

  const visible = useMemo(
    () => applyBoardFilters(jobs, filters, query),
    [jobs, filters, query],
  );

  const columns: JobStatus[] = OPEN_STATUSES;
  const backlogItems = useMemo(
    () => visible.filter((j) => BACKLOG_STATUSES.includes(j.status)),
    [visible],
  );

  async function moveJob(id: string, next: JobStatus) {
    const prev = jobs;
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: next } : j)));
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
    } catch (e) {
      setJobs(prev);
      toast.error((e as Error).message);
    }
  }

  async function saveNotes(id: string, notes: string) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, notes } : j)));
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (!res.ok) toast.error("Could not save notes");
  }

  async function saveCoverLetter(id: string, coverLetter: string) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, coverLetter } : j)));
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetter }),
    });
    if (!res.ok) toast.error("Could not save cover letter");
  }

  async function gradeOne(id: string) {
    setGradingIds((s) => new Set(s).add(id));
    const t = toast.loading("Grading…");
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed");
      if (data.errors?.length) throw new Error(data.errors[0].error);
      await refresh();
      toast.success(`Graded ${data.graded[0]?.grade ?? ""}`, { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setGradingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function gradeAction(action: "start" | "pause" | "resume" | "cancel") {
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed");
      setGradeRun(data.run as GradeRunState);
      if (action === "start") toast.message("Grading scheduled");
      if (action === "cancel") toast.message("Grading stopped");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const total = jobs.length;

  return (
    <div className="flex h-svh flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">ApplyFlow</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {total} tracked
          </span>
        </div>

        <Input
          className="h-8 w-full max-w-56 sm:ml-2"
          placeholder="Search title, company, tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <BoardFilters filters={filters} onChange={setFilters} jobs={jobs} />

        <div className="ml-auto flex items-center gap-2">
          {runningCount > 0 && (
            <Button variant="outline" onClick={() => setShowTools(true)}>
              <Loader2 className="animate-spin" />
              {runningCount} running
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowTools(true)}>
            <Settings2 />
            Tools
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/digests" />}
          >
            <FileText />
            Digests
          </Button>
          {gradeRun && gradeRun.running ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5">
              {gradeRun.paused ? (
                <Pause className="size-4 text-muted-foreground" />
              ) : (
                <Loader2 className="size-4 animate-spin text-primary" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium tabular-nums">
                  {gradeRun.paused ? "Grading paused" : "Grading"}{" "}
                  {gradeRun.done}/{gradeRun.total}
                  <span className="text-muted-foreground">
                    {" "}
                    · {gradeRun.remaining} left
                    {gradeRun.failed ? ` · ${gradeRun.failed} failed` : ""}
                  </span>
                </div>
                <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${
                        gradeRun.total
                          ? Math.round((gradeRun.done / gradeRun.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => gradeAction(gradeRun.paused ? "resume" : "pause")}
              >
                {gradeRun.paused ? <Play /> : <Pause />}
                {gradeRun.paused ? "Resume" : "Pause"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                title="Restart and include newly added jobs"
                onClick={() => gradeAction("start")}
              >
                <RotateCcw />
                Restart
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                title="Stop grading"
                onClick={() => gradeAction("cancel")}
              >
                <X />
                Stop
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => gradeAction("start")}
              disabled={!grader.configured || ungraded === 0}
              title={grader.configured ? undefined : "Configure OPENAI_* to grade"}
            >
              <Sparkles />
              Grade new{ungraded ? ` (${ungraded})` : ""}
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}>
            <Plus />
            New offer
          </Button>
        </div>
      </header>

      {!grader.configured && (
        <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <strong>Auto-grading off.</strong> Set <code>OPENAI_BASE_URL</code> and{" "}
          <code>OPENAI_API_KEY</code> in <code>.env.local</code> to grade offers
          automatically via your OpenAI-compatible endpoint.
        </div>
      )}

      <main className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 pt-3">
        {columns.map((status) => {
          const items = visible.filter((j) => j.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/job-id");
                if (id) moveJob(id, status);
              }}
              className={cn(
                "flex min-h-0 w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-2 ring-1 ring-foreground/5 transition",
                dragOver === status && "ring-2 ring-primary/60",
              )}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span
                  className={cn("size-2 rounded-full", statusDotClass(status))}
                />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {STATUS_LABELS[status]}
                </h2>
                <Badge variant="secondary" className="ml-auto">
                  {items.length}
                </Badge>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Drop a job here
                  </div>
                ) : (
                  items.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onOpen={setSelectedId}
                      onDragStateChange={() => setDragOver(null)}
                      onGrade={gradeOne}
                      grading={gradingIds.has(job.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}

        <section
          data-status="backlog"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOver("skipped");
          }}
          onDragLeave={() => setDragOver((s) => (s === "skipped" ? null : s))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const id = e.dataTransfer.getData("text/job-id");
            if (id) moveJob(id, "skipped");
          }}
          className={cn(
            "flex min-h-0 w-72 shrink-0 flex-col rounded-xl bg-muted/40 p-2 ring-1 ring-foreground/5 transition",
            dragOver === "skipped" && "ring-2 ring-primary/60",
          )}
        >
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="size-2 rounded-full bg-neutral-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Backlog
            </h2>
            <Badge variant="secondary" className="ml-auto">
              {backlogItems.length}
            </Badge>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
            {backlogItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                Rejected, skipped &amp; expired offers land here
              </div>
            ) : (
              backlogItems.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  backlog
                  onOpen={setSelectedId}
                  onDragStateChange={() => setDragOver(null)}
                  onGrade={gradeOne}
                  onRestore={(id) => moveJob(id, "shortlisted")}
                  grading={gradingIds.has(job.id)}
                />
              ))
            )}
          </div>
        </section>
      </main>

      {selected && (
        <JobDrawer
          key={selected.id}
          job={selected}
          onClose={() => setSelectedId(null)}
          onMove={moveJob}
          onSaveNotes={saveNotes}
          onSaveCoverLetter={saveCoverLetter}
          onGrade={gradeOne}
          grading={gradingIds.has(selected.id)}
          graderReady={grader.configured}
        />
      )}

      <NewOfferModal
        open={showNew}
        onOpenChange={setShowNew}
        onCreated={refresh}
      />
      <ToolsPanel
        open={showTools}
        onOpenChange={setShowTools}
        onChanged={refresh}
      />
    </div>
  );
}
