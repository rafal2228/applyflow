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

/**
 * Dates are rendered during SSR and then hydrated on the client. An `undefined`
 * locale resolves differently in Node (usually en-US) and in the browser (the
 * user's locale), which produces mismatched HTML. Pin one locale so both sides
 * format identically.
 */
const DATE_LOCALE = "en-GB";

const shortDateFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function shortDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : shortDateFmt.format(d);
}

export function dateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}
