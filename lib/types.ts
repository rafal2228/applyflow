/** Shared types — safe to import from client components (no Node builtins). */

export type JobStatus =
  | "new"
  | "shortlisted"
  | "parked"
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
  sourceUrl: string | null;
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
  coverLetter: string | null;
  /** Canonical job id once a human confirms this offer is a duplicate. */
  duplicateOf: string | null;
  /** True while this offer has at least one unresolved duplicate candidate. */
  dupReview: boolean;
}

/** A posting after normalisation into one schema (used by discovery). */
export interface NormalizedJob {
  id: string;
  source: string;
  sourceId: string;
  url: string;
  sourceUrl: string;
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

/** Progress of a background grading run. */
export interface GradeRunState {
  total: number;
  done: number;
  failed: number;
  remaining: number;
  running: boolean;
  paused: boolean;
  cancelled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  lastGrade: string | null;
  errors: { id: string; error: string }[];
}

/** An offer parsed from a posting URL (best-effort). */
export interface ImportedOffer {
  url: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryText: string | null;
  description: string;
  tags: string[];
  postedAt: string | null;
  source: string;
}

export type DuplicateStatus = "pending" | "confirmed" | "dismissed";

/** How a candidate pair was judged by the decision engine. */
export type DuplicateDecision = "exact" | "same" | "different" | null;

/** One candidate duplicate pair awaiting (or after) human review. */
export interface DuplicateReview {
  id: string;
  /** The newer / incoming offer. */
  job: JobRow;
  /** The older offer it may duplicate. */
  candidate: JobRow;
  /** Estimated similarity 0–1 from the fingerprint. */
  score: number;
  /** Number of LSH bands the two share (candidate strength). */
  sharedBands: number;
  /** Which engine made the decision (laya / llm), if any. */
  engine: string | null;
  decision: DuplicateDecision;
  confidence: number | null;
  reason: string | null;
  status: DuplicateStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface NewJobInput {
  title: string;
  company: string;
  url: string;
  /** The URL the offer was loaded/imported from (defaults to `url`). */
  sourceUrl?: string;
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
  "parked",
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
  parked: "Parked",
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
  "parked",
  "applied",
  "interview",
  "offer",
];

/** Statuses that live in the shared Backlog rather than a main column. */
export const BACKLOG_STATUSES: JobStatus[] = [
  "rejected",
  "skipped",
  "expired",
];

export const BACKLOG_STATUS_LABELS: Record<string, string> = {
  rejected: "Rejected",
  skipped: "Skipped",
  expired: "Expired",
};
