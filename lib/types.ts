/** Shared types — safe to import from client components (no Node builtins). */

export type JobStatus =
  | "new"
  | "shortlisted"
  | "applied"
  | "interview"
  | "rejected"
  | "offer"
  | "skipped"
  | "expired";

export type Grade = "A" | "B" | "C" | "D" | "E" | "F";

export interface JobRow {
  id: string;
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  geo: string | null;
  description: string;
  tags: string[];
  salaryText: string | null;
  postedAt: string | null;
  discoveredAt: string;
  dedupKey: string;
  status: JobStatus;
  grade: Grade | null;
  score: number | null;
  rankReason: string | null;
  rankPros: string[];
  rankCons: string[];
  rankModel: string | null;
  rankedAt: string | null;
  appliedAt: string | null;
  followUpAt: string | null;
  lastSeenAt: string | null;
  tailored: boolean;
  notes: string | null;
}

/** A posting after normalisation into one schema (used by discovery). */
export interface NormalizedJob {
  id: string;
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  geo: string | null;
  description: string;
  tags: string[];
  salaryText: string | null;
  postedAt: string | null;
  discoveredAt: string;
  dedupKey: string;
  raw: unknown;
}

export interface RankResult {
  grade: Grade;
  score: number;
  reason: string;
  pros: string[];
  cons: string[];
  model: string;
  rankedAt: string;
}

export interface NewJobInput {
  title: string;
  company: string;
  url?: string;
  location?: string;
  remote?: boolean;
  salaryText?: string;
  description?: string;
  tags?: string[];
  status?: JobStatus;
}

export const STATUSES: JobStatus[] = [
  "new",
  "shortlisted",
  "applied",
  "interview",
  "offer",
  "rejected",
  "skipped",
  "expired",
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "Inbox",
  shortlisted: "Shortlisted",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  skipped: "Skipped",
  expired: "Expired",
};

/** Columns that stay visible by default; the rest sit behind "Show closed". */
export const OPEN_STATUSES: JobStatus[] = [
  "new",
  "shortlisted",
  "applied",
  "interview",
  "offer",
];

export const CLOSED_STATUSES: JobStatus[] = [
  "rejected",
  "skipped",
  "expired",
];
