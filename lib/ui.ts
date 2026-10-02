import type { Grade, JobStatus } from "./types";

/** Solid colour classes for a fit grade badge / avatar. */
export function gradeClass(grade: Grade | null): string {
  switch (grade) {
    case "A":
      return "bg-emerald-600 text-white";
    case "B":
      return "bg-teal-600 text-white";
    case "C":
      return "bg-amber-600 text-white";
    case "D":
      return "bg-orange-600 text-white";
    case "E":
      return "bg-red-600 text-white";
    case "F":
      return "bg-neutral-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Small dot colour per column status. */
export function statusDotClass(status: JobStatus): string {
  switch (status) {
    case "new":
      return "bg-slate-400";
    case "shortlisted":
      return "bg-indigo-500";
    case "applied":
      return "bg-blue-500";
    case "interview":
      return "bg-violet-500";
    case "offer":
      return "bg-emerald-500";
    case "rejected":
      return "bg-red-500";
    case "skipped":
      return "bg-neutral-400";
    case "expired":
      return "bg-neutral-300";
  }
}

export function shortDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
