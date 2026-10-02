"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { gradeClass, shortDate } from "@/lib/ui";
import {
  STATUSES,
  STATUS_LABELS,
  type JobRow,
  type JobStatus,
} from "@/lib/types";
import type { ApplicationFiles } from "@/lib/tailor";

const STATUS_OPTIONS = STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

export default function JobDrawer({
  job,
  onClose,
  onMove,
  onSaveNotes,
  onGrade,
  grading,
  graderReady,
}: {
  job: JobRow;
  onClose: () => void;
  onMove: (id: string, status: JobStatus) => void;
  onSaveNotes: (id: string, notes: string) => void;
  onGrade: (id: string) => void;
  grading: boolean;
  graderReady: boolean;
}) {
  const [notes, setNotes] = useState(job.notes ?? "");
  const [application, setApplication] = useState<ApplicationFiles | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [lang, setLang] = useState("en");

  useEffect(() => {
    let alive = true;
    fetch(`/api/tailor?id=${encodeURIComponent(job.id)}&lang=${lang}`)
      .then((r) => r.json())
      .then((d) => alive && setApplication(d.application ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [job.id, lang]);

  async function runTailor() {
    setTailoring(true);
    const t = toast.loading("Tailoring CV + cover letter…");
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tailoring failed");
      setApplication(data.application);
      toast.success("Tailored CV + cover letter ready", { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setTailoring(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <div className="flex items-start gap-3 pr-8">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold",
                gradeClass(job.grade),
              )}
            >
              {job.grade ?? "·"}
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="leading-snug">{job.title}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {job.company}
                {job.location ? ` · ${job.location}` : ""}
                {job.remote ? " · Remote" : ""}
                {job.score != null ? ` · score ${job.score}` : ""}
              </p>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{STATUS_LABELS[job.status]}</Badge>
              <Badge variant="outline">via {job.source}</Badge>
              {job.salaryText && <Badge variant="outline">{job.salaryText}</Badge>}
              {job.url && (
                <Button
                  size="xs"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a href={job.url} target="_blank" rel="noreferrer">
                      Open posting
                      <ExternalLink />
                    </a>
                  }
                />
              )}
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Status
              </span>
              <Select
                items={STATUS_OPTIONS}
                value={job.status}
                onValueChange={(v) => onMove(job.id, v as JobStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {job.grade ? `Grade ${job.grade}` : "Fit grade"}
                </span>
                <Button
                  size="xs"
                  variant={job.grade ? "outline" : "default"}
                  disabled={grading || !graderReady}
                  onClick={() => onGrade(job.id)}
                >
                  <Sparkles />
                  {grading ? "Grading…" : job.grade ? "Re-grade" : "Grade"}
                </Button>
              </div>
              {job.rankReason ? (
                <p className="text-sm text-muted-foreground">{job.rankReason}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {graderReady
                    ? "Not graded yet."
                    : "Configure OPENAI_* in .env.local to grade."}
                </p>
              )}
              {job.rankPros.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {job.rankPros.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {job.rankCons.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {job.rankCons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </div>

            <Separator />

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tailored application
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    items={[
                      { value: "en", label: "EN" },
                      { value: "pl", label: "PL" },
                    ]}
                    value={lang}
                    onValueChange={(v) => setLang(v as string)}
                  >
                    <SelectTrigger size="sm" className="w-16">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">EN</SelectItem>
                      <SelectItem value="pl">PL</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={tailoring || !graderReady}
                    onClick={runTailor}
                  >
                    <FileText />
                    {tailoring ? "Tailoring…" : "Tailor"}
                  </Button>
                </div>
              </div>

              {application?.cv ? (
                <div className="grid gap-3">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      CV ({lang.toUpperCase()})
                    </div>
                    <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                      {application.cv}
                    </pre>
                  </div>
                  {application.coverLetter && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        Cover letter
                      </div>
                      <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                        {application.coverLetter}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No tailored CV yet — generate one from your profile + CV.
                </p>
              )}
            </div>

            <Separator />

            <div className="grid gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </span>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Recruiter, referral, next step…"
              />
              <div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    onSaveNotes(job.id, notes);
                    toast.success("Notes saved");
                  }}
                >
                  Save notes
                </Button>
              </div>
            </div>

            <Separator />

            <p className="text-xs text-muted-foreground">
              Discovered {shortDate(job.discoveredAt)}
              {job.appliedAt ? ` · Applied ${shortDate(job.appliedAt)}` : ""}
              {job.followUpAt ? ` · Follow up ${shortDate(job.followUpAt)}` : ""}
              {job.rankedAt ? ` · Graded ${shortDate(job.rankedAt)}` : ""}
            </p>
            {job.description && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </div>
                <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {job.description}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
