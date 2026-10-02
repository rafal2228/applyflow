"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Settings2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { statusDotClass } from "@/lib/ui";
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  STATUS_LABELS,
  type JobRow,
  type JobStatus,
} from "@/lib/types";
import JobCard from "./JobCard";
import JobDrawer from "./JobDrawer";
import NewOfferModal from "./NewOfferModal";
import ToolsPanel from "./ToolsPanel";
import DigestDialog from "./DigestDialog";

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
  const [showClosed, setShowClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showDigest, setShowDigest] = useState(false);
  const [gradingIds, setGradingIds] = useState<Set<string>>(new Set());
  const [gradingAll, setGradingAll] = useState(false);
  const [dragOver, setDragOver] = useState<JobStatus | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (res.ok) setJobs((await res.json()).jobs as JobRow[]);
  }, []);

  const ungraded = useMemo(
    () =>
      jobs.filter(
        (j) => !j.grade && (j.status === "new" || j.status === "shortlisted"),
      ).length,
    [jobs],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      `${j.title} ${j.company} ${j.location ?? ""} ${j.tags.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [jobs, query]);

  const columns: JobStatus[] = showClosed
    ? [...OPEN_STATUSES, ...CLOSED_STATUSES]
    : OPEN_STATUSES;

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

  async function gradeAll() {
    setGradingAll(true);
    const t = toast.loading(`Grading ${ungraded} new offer(s)…`);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, limit: 25 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed");
      await refresh();
      toast.success(
        `Graded ${data.graded.length}${data.errors.length ? `, ${data.errors.length} failed` : ""}`,
        { id: t },
      );
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setGradingAll(false);
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

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={showClosed}
            onCheckedChange={(c) => setShowClosed(c === true)}
          />
          Closed
        </label>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowTools(true)}>
            <Settings2 />
            Tools
          </Button>
          <Button variant="outline" onClick={() => setShowDigest(true)}>
            <FileText />
            Digest
          </Button>
          <Button
            variant="outline"
            onClick={gradeAll}
            disabled={!grader.configured || gradingAll || ungraded === 0}
            title={grader.configured ? undefined : "Configure OPENAI_* to grade"}
          >
            <Sparkles />
            Grade new{ungraded ? ` (${ungraded})` : ""}
          </Button>
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
      </main>

      {selected && (
        <JobDrawer
          key={selected.id}
          job={selected}
          onClose={() => setSelectedId(null)}
          onMove={moveJob}
          onSaveNotes={saveNotes}
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
      <DigestDialog open={showDigest} onOpenChange={setShowDigest} />
    </div>
  );
}
