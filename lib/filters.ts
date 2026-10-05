import type { Grade, JobRow, JobStatus } from "./types";

/**
 * Statuses that represent work already done. A possible-duplicate flag must
 * never hide these: an applied/interview/offer card vanishing from the board
 * is indistinguishable from data loss.
 */
const ACTIONED_STATUSES: JobStatus[] = ["applied", "interview", "offer"];

/** Comprehensive board filters (client-side, over the loaded jobs). */
export interface BoardFiltersState {
  salary: boolean;
  location: boolean;
  remote: boolean;
  applyLink: boolean;
  tailored: boolean;
  followUpDue: boolean;
  graded: "all" | "graded" | "ungraded";
  minGrade: "all" | Grade;
  geo: string; // "all" or a concrete geo value
  recentDays: "any" | "7" | "14" | "30";
  sources: string[]; // empty = all
  /** Hide un-actioned offers waiting in the duplicate review queue (off by default). */
  hideDuplicates: boolean;
}

export const DEFAULT_FILTERS: BoardFiltersState = {
  salary: false,
  location: false,
  remote: false,
  applyLink: false,
  tailored: false,
  followUpDue: false,
  graded: "all",
  minGrade: "all",
  geo: "all",
  recentDays: "any",
  sources: [],
  hideDuplicates: false,
};

const GRADE_ORDER = "ABCDEF";

/** 0 = A (best) … 5 = F, 99 = ungraded. */
export function gradeIndex(grade: Grade | null): number {
  const i = grade ? GRADE_ORDER.indexOf(grade) : -1;
  return i < 0 ? 99 : i;
}

export function countActiveFilters(f: BoardFiltersState): number {
  let n = 0;
  if (f.salary) n++;
  if (f.location) n++;
  if (f.remote) n++;
  if (f.applyLink) n++;
  if (f.tailored) n++;
  if (f.followUpDue) n++;
  if (f.graded !== "all") n++;
  if (f.minGrade !== "all") n++;
  if (f.geo !== "all") n++;
  if (f.recentDays !== "any") n++;
  if (f.sources.length) n++;
  if (f.hideDuplicates) n++;
  return n;
}

export function applyBoardFilters(
  jobs: JobRow[],
  filters: BoardFiltersState,
  query: string,
): JobRow[] {
  const q = query.trim().toLowerCase();
  const now = Date.now();
  return jobs.filter((j) => {
    if (q) {
      const hay =
        `${j.title} ${j.company} ${j.location ?? ""} ${j.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.salary && !j.salaryText) return false;
    if (filters.location && !j.location) return false;
    if (filters.remote && !j.remote) return false;
    if (filters.applyLink && !j.url) return false;
    if (filters.tailored && !j.tailored) return false;
    if (filters.followUpDue) {
      if (j.status !== "applied" || !j.followUpAt || Date.parse(j.followUpAt) > now)
        return false;
    }
    if (filters.graded === "graded" && !j.grade) return false;
    if (filters.graded === "ungraded" && j.grade) return false;
    if (filters.minGrade !== "all") {
      if (!j.grade) return false;
      if (gradeIndex(j.grade) > gradeIndex(filters.minGrade)) return false;
    }
    if (filters.geo !== "all" && (j.geo ?? "") !== filters.geo) return false;
    if (filters.recentDays !== "any") {
      const days = (now - Date.parse(j.discoveredAt)) / 86400000;
      if (days > Number(filters.recentDays)) return false;
    }
    if (filters.sources.length && !filters.sources.includes(j.source)) return false;
    if (
      filters.hideDuplicates &&
      j.dupReview &&
      !ACTIONED_STATUSES.includes(j.status)
    )
      return false;
    return true;
  });
}
