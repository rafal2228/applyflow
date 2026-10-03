"use client";

import { useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dateTime, gradeClass, shortDate } from "@/lib/ui";
import { STATUS_LABELS, type JobRow } from "@/lib/types";

export default function JobCard({
  job,
  onOpen,
  onDragStateChange,
  onGrade,
  grading,
  backlog = false,
  onRestore,
}: {
  job: JobRow;
  onOpen: (id: string) => void;
  onDragStateChange: (dragging: boolean) => void;
  onGrade: (id: string) => void;
  grading: boolean;
  backlog?: boolean;
  onRestore?: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <Card
      size="sm"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/job-id", job.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
        onDragStateChange(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragStateChange(false);
      }}
      onClick={() => onOpen(job.id)}
      className={cn(
        "shrink-0 cursor-grab gap-2 px-3 py-3 transition hover:border-foreground/25 hover:shadow-sm",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold",
            gradeClass(job.grade),
          )}
        >
          {job.grade ?? "·"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium leading-snug">
            {job.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {job.company}
          </div>
        </div>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open posting"
            title="Open posting"
            className="-mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {job.remote && <Badge variant="secondary">Remote</Badge>}
        {job.location && (
          <Badge variant="outline" className="max-w-full truncate">
            {job.location}
          </Badge>
        )}
        {job.salaryText && (
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700"
          >
            {job.salaryText}
          </Badge>
        )}
        {job.tailored && <Badge variant="secondary">Tailored</Badge>}
        {job.coverLetter && <Badge variant="secondary">Cover letter</Badge>}
        {job.appliedAt && (
          <Badge variant="outline" title={`Applied ${dateTime(job.appliedAt)}`}>
            Applied {shortDate(job.appliedAt)}
          </Badge>
        )}
        {backlog && <Badge variant="outline">{STATUS_LABELS[job.status]}</Badge>}
      </div>

      {job.rankReason && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {job.rankReason}
        </p>
      )}

      {(!job.grade || backlog) && (
        <div className="flex flex-wrap gap-1.5">
          {backlog && onRestore && (
            <Button
              size="xs"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(job.id);
              }}
            >
              <RotateCcw />
              Restore
            </Button>
          )}
          {!job.grade && (
            <Button
              size="xs"
              variant="outline"
              disabled={grading}
              onClick={(e) => {
                e.stopPropagation();
                onGrade(job.id);
              }}
            >
              {grading ? "Grading…" : "Grade"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
