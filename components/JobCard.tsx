"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { gradeClass } from "@/lib/ui";
import type { JobRow } from "@/lib/types";

export default function JobCard({
  job,
  onOpen,
  onDragStateChange,
  onGrade,
  grading,
}: {
  job: JobRow;
  onOpen: (id: string) => void;
  onDragStateChange: (dragging: boolean) => void;
  onGrade: (id: string) => void;
  grading: boolean;
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
        "shrink-0 cursor-grab gap-2 px-3 py-3 transition hover:ring-foreground/20 hover:shadow-sm",
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
      </div>

      {job.rankReason && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {job.rankReason}
        </p>
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
    </Card>
  );
}
