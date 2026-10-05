import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  DuplicateDecision,
  DuplicateReview,
  DuplicateStatus,
  Grade,
  JobRow,
  JobStatus,
  NewJobInput,
  NormalizedJob,
  RankResult,
} from "./types";
import type { Fingerprint } from "./fingerprint";
import { dedupKey, jobId, nowIso, sha1 } from "./util";
import { DB_PATH } from "./paths";

// Next to the database: a marker that proves ApplyFlow has run here before, and
// rolling pre-migration snapshots.
const DATA_DIR = dirname(DB_PATH);
const INIT_MARKER = join(DATA_DIR, ".applyflow-initialized");
const BACKUP_DIR = join(DATA_DIR, "backups");
const MAX_BACKUPS = 5;

/**
 * ApplyFlow's local SQLite store. Everything the app does (discovery, grading,
 * tailoring, the board) reads and writes this one database.
 *
 * The connection is stashed on `globalThis` because Next.js loads each route
 * in its own module instance — a module-level singleton would be duplicated.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  geo TEXT,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  salary_text TEXT,
  posted_at TEXT,
  discovered_at TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  raw TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  grade TEXT,
  score INTEGER,
  rank_reason TEXT,
  rank_pros TEXT NOT NULL DEFAULT '[]',
  rank_cons TEXT NOT NULL DEFAULT '[]',
  rank_model TEXT,
  ranked_at TEXT,
  applied_at TEXT,
  follow_up_at TEXT,
  last_seen_at TEXT,
  tailored INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  cover_letter TEXT,
  duplicate_of TEXT,
  dup_review INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(dedup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_grade ON jobs(grade);

CREATE TABLE IF NOT EXISTS job_fingerprints (
  job_id TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  mask TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_fingerprints_mask ON job_fingerprints(mask);

CREATE TABLE IF NOT EXISTS job_bands (
  job_id TEXT NOT NULL,
  band TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_bands_band ON job_bands(band);
CREATE INDEX IF NOT EXISTS idx_job_bands_job ON job_bands(job_id);

CREATE TABLE IF NOT EXISTS job_duplicates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  shared_bands INTEGER NOT NULL DEFAULT 0,
  engine TEXT,
  decision TEXT,
  confidence REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_duplicates_pair
  ON job_duplicates(job_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_job_duplicates_status ON job_duplicates(status);

CREATE TABLE IF NOT EXISTS market_snapshots (
  day TEXT NOT NULL,
  keyword TEXT NOT NULL,
  scope TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, keyword, scope)
);

CREATE TABLE IF NOT EXISTS digests (
  day TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const g = globalThis as unknown as { __applyflowDb?: DatabaseSync };

/**
 * Reconcile columns on an already-open connection. Runs on every `db()` call so
 * a connection opened before a schema change heals itself — a long-lived
 * Next.js dev server survives hot-reloads, so a module-level schema-version flag
 * can otherwise drift out of sync with the live connection.
 */
function ensureColumns(d: DatabaseSync): void {
  const cols = (d.prepare("PRAGMA table_info(jobs)").all() as Row[]).map(
    (r) => r.name as string,
  );
  if (!cols.includes("source_url")) {
    d.exec("ALTER TABLE jobs ADD COLUMN source_url TEXT");
    d.exec("UPDATE jobs SET source_url = url WHERE source_url IS NULL");
  }
  if (!cols.includes("cover_letter")) {
    d.exec("ALTER TABLE jobs ADD COLUMN cover_letter TEXT");
  }
  if (!cols.includes("duplicate_of")) {
    d.exec("ALTER TABLE jobs ADD COLUMN duplicate_of TEXT");
  }
  if (!cols.includes("dup_review")) {
    d.exec("ALTER TABLE jobs ADD COLUMN dup_review INTEGER NOT NULL DEFAULT 0");
    d.exec("CREATE INDEX IF NOT EXISTS idx_jobs_dup_review ON jobs(dup_review)");
  }
}

/** Create tables/indexes if missing, then reconcile columns. */
function migrate(d: DatabaseSync): void {
  d.exec(SCHEMA);
  ensureColumns(d);
  // Created here too so a fresh database gets it (ensureColumns only runs the
  // ALTER path on databases created before the column existed).
  d.exec("CREATE INDEX IF NOT EXISTS idx_jobs_dup_review ON jobs(dup_review)");
}

/**
 * Snapshot the database (and its WAL) before schema reconciliation, keeping the
 * newest `MAX_BACKUPS` sets. Best-effort: a failed backup must never stop the app.
 */
function backupDatabase(): void {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = `${DB_PATH}${suffix}`;
      if (existsSync(src)) {
        copyFileSync(
          src,
          join(BACKUP_DIR, `${basename(DB_PATH)}.${stamp}.bak${suffix}`),
        );
      }
    }
    const sets = readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".bak"))
      .sort()
      .reverse();
    for (const stale of sets.slice(MAX_BACKUPS)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = join(BACKUP_DIR, `${stale}${suffix}`);
        if (existsSync(p)) unlinkSync(p);
      }
    }
  } catch (e) {
    console.warn(`[applyflow] database backup failed: ${(e as Error).message}`);
  }
}

/** Record that ApplyFlow has successfully opened a database here. */
function markInitialized(): void {
  try {
    writeFileSync(INIT_MARKER, new Date().toISOString());
  } catch {
    /* best-effort */
  }
}

function db(): DatabaseSync {
  const cached = g.__applyflowDb;
  if (cached) {
    // Re-run migrations on the live connection too: a long-lived Next.js dev
    // server keeps the same connection across hot-reloads, so tables added by a
    // schema change must be reconciled here as well.
    migrate(cached);
    return cached;
  }

  const existed = existsSync(DB_PATH);
  // A missing database is only a genuine first run if ApplyFlow has never run
  // in this directory. If it has, the file was deleted/replaced — starting from
  // empty here would look like success while silently hiding the lost state.
  if (!existed && existsSync(INIT_MARKER)) {
    throw new Error(
      `[applyflow] Refusing to start: ${DB_PATH} is missing but this data ` +
        `directory holds an initialized database marker. Creating an empty ` +
        `database would mask the loss. Restore the file (pre-migration ` +
        `snapshots live in ${BACKUP_DIR}) or set JOBS_DB_PATH to a new location.`,
    );
  }

  if (!existed) mkdirSync(DATA_DIR, { recursive: true });
  if (existed) backupDatabase();
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL;");
  migrate(d);
  g.__applyflowDb = d;
  markInitialized();
  if (!existed) console.warn(`[applyflow] created new jobs.db at ${DB_PATH}`);
  return d;
}

function rowToJob(r: Row): JobRow {
  return {
    id: r.id as string,
    source: r.source as string,
    sourceId: r.source_id as string,
    url: r.url as string,
    sourceUrl: (r.source_url as string) ?? null,
    title: r.title as string,
    company: r.company as string,
    location: (r.location as string) ?? null,
    remote: !!r.remote,
    geo: (r.geo as string) ?? null,
    description: (r.description as string) ?? "",
    tags: JSON.parse((r.tags as string) || "[]"),
    salaryText: (r.salary_text as string) ?? null,
    postedAt: (r.posted_at as string) ?? null,
    discoveredAt: r.discovered_at as string,
    dedupKey: r.dedup_key as string,
    status: r.status as JobStatus,
    grade: (r.grade as Grade) ?? null,
    score: (r.score as number) ?? null,
    rankReason: (r.rank_reason as string) ?? null,
    rankPros: JSON.parse((r.rank_pros as string) || "[]"),
    rankCons: JSON.parse((r.rank_cons as string) || "[]"),
    rankModel: (r.rank_model as string) ?? null,
    rankedAt: (r.ranked_at as string) ?? null,
    appliedAt: (r.applied_at as string) ?? null,
    followUpAt: (r.follow_up_at as string) ?? null,
    lastSeenAt: (r.last_seen_at as string) ?? null,
    tailored: !!r.tailored,
    notes: (r.notes as string) ?? null,
    coverLetter: (r.cover_letter as string) ?? null,
    duplicateOf: (r.duplicate_of as string) ?? null,
    dupReview: !!r.dup_review,
  };
}

/** All jobs, best-graded first — the board sorts into columns client-side. */
export function listJobs(): JobRow[] {
  const rows = db()
    .prepare(
      `SELECT * FROM jobs
       ORDER BY (grade IS NULL), grade ASC, score DESC, discovered_at DESC`,
    )
    .all() as Row[];
  return rows.map(rowToJob);
}

export function getJob(id: string): JobRow | null {
  const r = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? rowToJob(r) : null;
}

export function counts(): Record<string, number> {
  const rows = db()
    .prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status")
    .all() as Row[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status as string] = r.n as number;
  out.total = (
    db().prepare("SELECT COUNT(*) n FROM jobs").get() as Row
  ).n as number;
  return out;
}

/** Move a card between columns. "applied" also sets the +7-day follow-up. */
export function setStatus(id: string, status: JobStatus): JobRow | null {
  const d = db();
  if (status === "applied") {
    const followUp = new Date(Date.now() + 7 * 86400000).toISOString();
    d.prepare(
      "UPDATE jobs SET status=?, applied_at=COALESCE(applied_at, ?), follow_up_at=? WHERE id=?",
    ).run(status, nowIso(), followUp, id);
  } else {
    d.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id);
  }
  return getJob(id);
}

export function updateNotes(id: string, notes: string): JobRow | null {
  db().prepare("UPDATE jobs SET notes=? WHERE id=?").run(notes, id);
  return getJob(id);
}

export function updateCoverLetter(id: string, coverLetter: string): JobRow | null {
  db()
    .prepare("UPDATE jobs SET cover_letter=? WHERE id=?")
    .run(coverLetter, id);
  return getJob(id);
}

/** Persist an LLM grade onto a job. */
export function saveRank(id: string, r: RankResult): void {
  db()
    .prepare(
      `UPDATE jobs SET grade=?, score=?, rank_reason=?, rank_pros=?, rank_cons=?,
         rank_model=?, ranked_at=?,
         status = CASE WHEN status='new' THEN 'shortlisted' ELSE status END
       WHERE id=?`,
    )
    .run(
      r.grade,
      r.score,
      r.reason,
      JSON.stringify(r.pros),
      JSON.stringify(r.cons),
      r.model,
      r.rankedAt,
      id,
    );
}

/** Jobs with no grade yet, newest first — the "grade new offers" queue. */
export function ungradedJobs(limit = 25): JobRow[] {
  const rows = db()
    .prepare(
      "SELECT * FROM jobs WHERE grade IS NULL AND status IN ('new','shortlisted') ORDER BY discovered_at DESC LIMIT ?",
    )
    .all(limit) as Row[];
  return rows.map(rowToJob);
}

export type CreateResult =
  | { ok: true; job: JobRow }
  | { ok: false; reason: "duplicate"; existing: JobRow };

/** Add a job manually — "track a new offer" from the board. */
export function createJob(input: NewJobInput): CreateResult {
  const d = db();
  const title = input.title.trim();
  const company = input.company.trim();
  const url = input.url.trim();
  const sourceUrl = (input.sourceUrl ?? input.url).trim() || null;
  const key = dedupKey(company, title);

  const dupe = d.prepare("SELECT * FROM jobs WHERE dedup_key = ?").get(key) as
    | Row
    | undefined;
  if (dupe) return { ok: false, reason: "duplicate", existing: rowToJob(dupe) };

  const sourceId = url || `${company}|${title}|${nowIso()}`;
  const id = jobId("manual", sourceId);
  const now = nowIso();
  const status: JobStatus = input.status ?? "shortlisted";

  d.prepare(
    `INSERT INTO jobs (id, source, source_id, url, source_url, title, company,
       location, remote, description, tags, salary_text, discovered_at,
       dedup_key, raw, status, last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    "manual",
    sourceId,
    url,
    sourceUrl,
    title,
    company,
    (input.location ?? "").trim() || null,
    input.remote ? 1 : 0,
    (input.description ?? "").trim(),
    JSON.stringify(input.tags ?? []),
    (input.salaryText ?? "").trim() || null,
    now,
    key,
    JSON.stringify({ manual: true }),
    status,
    now,
  );
  // Stamp first-applied time (+follow-up) when created straight into Applied.
  if (status === "applied") setStatus(id, "applied");
  return { ok: true, job: getJob(id)! };
}

export function markTailored(id: string): void {
  db().prepare("UPDATE jobs SET tailored=1 WHERE id=?").run(id);
}

// --- market snapshots (mirrors the pipeline's monitor stage) ---

export function countMatching(
  keyword: string,
  scope: "PL" | "remote-global",
): number {
  const kw = `%${keyword.toLowerCase()}%`;
  const where =
    scope === "PL"
      ? "geo = 'PL'"
      : "(geo IS NULL OR geo <> 'PL') AND remote = 1";
  const row = db()
    .prepare(
      `SELECT COUNT(*) n FROM jobs
       WHERE ${where}
         AND (lower(title) LIKE ? OR lower(tags) LIKE ? OR lower(description) LIKE ?)`,
    )
    .get(kw, kw, kw) as Row;
  return row.n as number;
}

export function saveSnapshot(
  day: string,
  keyword: string,
  scope: string,
  count: number,
): void {
  db()
    .prepare(
      "INSERT OR REPLACE INTO market_snapshots (day, keyword, scope, count) VALUES (?,?,?,?)",
    )
    .run(day, keyword, scope, count);
}

export function snapshotTrend(
  keyword: string,
  scope: string,
): { day: string; count: number }[] {
  return db()
    .prepare(
      "SELECT day, count FROM market_snapshots WHERE keyword=? AND scope=? ORDER BY day DESC LIMIT 30",
    )
    .all(keyword, scope) as { day: string; count: number }[];
}

// --- discovery / maintenance ---

export type UpsertResult = "inserted" | "duplicate" | "exists";

/**
 * Insert a discovered job. Re-seen ids just bump `last_seen_at`; a cross-source
 * exact key match is still inserted and pushed to the duplicate review queue
 * rather than dropped.
 */
export function upsertJob(job: NormalizedJob): UpsertResult {
  const d = db();
  const now = nowIso();
  if (d.prepare("SELECT 1 FROM jobs WHERE id = ?").get(job.id)) {
    d.prepare("UPDATE jobs SET last_seen_at = ? WHERE id = ?").run(now, job.id);
    return "exists";
  }
  // A same board re-listing the same role (e.g. one posting per region) is a
  // repost, not a cross-source duplicate: drop it like before and just bump the
  // original. Only a genuinely cross-source match goes to the review queue.
  const matches = d
    .prepare("SELECT id, source FROM jobs WHERE dedup_key = ? AND id <> ?")
    .all(job.dedupKey, job.id) as Row[];
  const sameSource = matches.find((m) => m.source === job.source);
  if (sameSource) {
    d.prepare("UPDATE jobs SET last_seen_at = ? WHERE id = ?").run(
      now,
      sameSource.id as string,
    );
    return "duplicate";
  }
  const crossSource = matches[0];
  d.prepare(
    `INSERT INTO jobs (id, source, source_id, url, source_url, title, company,
       location, remote, geo, description, tags, salary_text, posted_at,
       discovered_at, dedup_key, raw, last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    job.id,
    job.source,
    job.sourceId,
    job.url,
    job.sourceUrl ?? job.url,
    job.title,
    job.company,
    job.location,
    job.remote ? 1 : 0,
    job.geo,
    job.description,
    JSON.stringify(job.tags),
    job.salaryText,
    job.postedAt,
    job.discoveredAt,
    job.dedupKey,
    JSON.stringify(job.raw),
    job.discoveredAt,
  );

  if (crossSource) {
    saveDuplicateCandidate({
      jobId: job.id,
      candidateId: crossSource.id as string,
      score: 1,
      engine: "exact",
      decision: "exact",
      confidence: 1,
      reason: "Identical normalised company + title (cross-source)",
    });
    return "duplicate";
  }
  return "inserted";
}

export function dueFollowUps(): JobRow[] {
  const rows = db()
    .prepare(
      "SELECT * FROM jobs WHERE status='applied' AND follow_up_at IS NOT NULL AND follow_up_at <= ? ORDER BY follow_up_at",
    )
    .all(nowIso()) as Row[];
  return rows.map(rowToJob);
}

/**
 * Jobs not seen in any discovery run for `days` days, still sitting in an active
 * status (`new`/`shortlisted`). Acted-on statuses are left alone.
 */
export function staleJobs(days: number): JobRow[] {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db()
    .prepare(
      `SELECT * FROM jobs
       WHERE status IN ('new','shortlisted')
         AND COALESCE(last_seen_at, discovered_at) < ?
       ORDER BY COALESCE(last_seen_at, discovered_at)`,
    )
    .all(cutoff) as Row[];
  return rows.map(rowToJob);
}

/** Mark stale (no-longer-available) active jobs as `expired`. */
export function expireStale(days: number): JobRow[] {
  const stale = staleJobs(days);
  if (stale.length) {
    const d = db();
    const upd = d.prepare("UPDATE jobs SET status = 'expired' WHERE id = ?");
    for (const j of stale) upd.run(j.id);
  }
  return stale;
}

// --- duplicate fingerprints + review queue ---

/** Upsert a job's MinHash signature / bands / SimHash mask. */
export function saveFingerprint(jobIdValue: string, fp: Fingerprint): void {
  const d = db();
  d.prepare(
    `INSERT INTO job_fingerprints (job_id, signature, mask, updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(job_id) DO UPDATE SET
       signature=excluded.signature, mask=excluded.mask, updated_at=excluded.updated_at`,
  ).run(jobIdValue, JSON.stringify(fp.signature), fp.mask, nowIso());
  d.prepare("DELETE FROM job_bands WHERE job_id = ?").run(jobIdValue);
  const ins = d.prepare("INSERT INTO job_bands (job_id, band) VALUES (?,?)");
  for (const band of fp.bands) ins.run(jobIdValue, band);
}

export function getFingerprint(
  jobIdValue: string,
): { signature: number[]; mask: string } | null {
  const r = db()
    .prepare("SELECT signature, mask FROM job_fingerprints WHERE job_id=?")
    .get(jobIdValue) as Row | undefined;
  if (!r) return null;
  return {
    signature: JSON.parse(r.signature as string) as number[],
    mask: r.mask as string,
  };
}

export interface CandidateFingerprint {
  jobId: string;
  signature: number[];
  mask: string;
  sharedBands: number;
}

/**
 * Candidate jobs that collide on at least one LSH band — the "bloom filter"
 * narrowing step. They still need an exact similarity check before review.
 */
export function candidateFingerprints(
  bands: string[],
  excludeId: string,
  limit = 50,
): CandidateFingerprint[] {
  if (!bands.length) return [];
  const d = db();
  const placeholders = bands.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT job_id AS jobId, COUNT(DISTINCT band) AS sharedBands
       FROM job_bands
       WHERE band IN (${placeholders}) AND job_id <> ?
       GROUP BY job_id
       ORDER BY sharedBands DESC
       LIMIT ?`,
    )
    .all(...bands, excludeId, limit) as Row[];
  const out: CandidateFingerprint[] = [];
  for (const r of rows) {
    const fp = getFingerprint(r.jobId as string);
    if (!fp) continue;
    out.push({
      jobId: r.jobId as string,
      signature: fp.signature,
      mask: fp.mask,
      sharedBands: r.sharedBands as number,
    });
  }
  return out;
}

/** Stable, order-independent id for a pair of jobs. */
export function duplicatePairId(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `dup:${sha1(`${x}|${y}`).slice(0, 16)}`;
}

export interface DuplicatePairInput {
  jobId: string;
  candidateId: string;
  score: number;
  sharedBands?: number;
  engine?: string | null;
  decision?: DuplicateDecision;
  confidence?: number | null;
  reason?: string | null;
  status?: DuplicateStatus;
}

/** Record (or refresh) a candidate pair. Never clobbers a human decision. */
export function saveDuplicateCandidate(p: DuplicatePairInput): void {
  const [a, b] = p.jobId < p.candidateId ? [p.jobId, p.candidateId] : [p.candidateId, p.jobId];
  const id = duplicatePairId(a, b);
  const d = db();
  const existing = d.prepare("SELECT status FROM job_duplicates WHERE id=?").get(id) as
    | Row
    | undefined;
  if (existing) {
    d.prepare(
      `UPDATE job_duplicates SET
         score=MAX(score, ?), shared_bands=MAX(shared_bands, ?),
         engine=COALESCE(?, engine), decision=COALESCE(?, decision),
         confidence=COALESCE(?, confidence), reason=COALESCE(?, reason)
       WHERE id=?`,
    ).run(
      p.score,
      p.sharedBands ?? 0,
      p.engine ?? null,
      p.decision ?? null,
      p.confidence ?? null,
      p.reason ?? null,
      id,
    );
    return;
  }
  d.prepare(
    `INSERT INTO job_duplicates (id, job_id, candidate_id, score, shared_bands,
       engine, decision, confidence, reason, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    a,
    b,
    p.score,
    p.sharedBands ?? 0,
    p.engine ?? null,
    p.decision ?? null,
    p.confidence ?? null,
    p.reason ?? null,
    p.status ?? "pending",
    nowIso(),
  );
  d.prepare("UPDATE jobs SET dup_review=1 WHERE id IN (?,?)").run(a, b);
}

function rowToDuplicateReview(r: Row): DuplicateReview | null {
  const a = getJob(r.job_id as string);
  const b = getJob(r.candidate_id as string);
  if (!a || !b) return null;
  const aNewer = Date.parse(a.discoveredAt) >= Date.parse(b.discoveredAt);
  return {
    id: r.id as string,
    job: aNewer ? a : b,
    candidate: aNewer ? b : a,
    score: r.score as number,
    sharedBands: r.shared_bands as number,
    engine: (r.engine as string) ?? null,
    decision: (r.decision as DuplicateDecision) ?? null,
    confidence: (r.confidence as number) ?? null,
    reason: (r.reason as string) ?? null,
    status: r.status as DuplicateStatus,
    createdAt: r.created_at as string,
    decidedAt: (r.decided_at as string) ?? null,
  };
}

/**
 * Candidate pairs, newest / strongest first. Optionally filtered by review
 * status and capped with `limit` (used by the digest).
 */
export function listDuplicateReviews(
  status?: DuplicateStatus,
  limit?: number,
): DuplicateReview[] {
  const args: (string | number)[] = status ? [status] : [];
  if (limit != null) args.push(limit);
  const rows = db()
    .prepare(
      `SELECT * FROM job_duplicates
       ${status ? "WHERE status = ?" : ""}
       ORDER BY (status = 'pending') DESC, score DESC, created_at DESC
       ${limit != null ? "LIMIT ?" : ""}`,
    )
    .all(...args) as Row[];
  return rows
    .map(rowToDuplicateReview)
    .filter((r): r is DuplicateReview => !!r);
}

/** One page of candidate pairs plus the total for the status filter. */
export function listDuplicateReviewsPage(
  status: DuplicateStatus | undefined,
  limit: number,
  offset: number,
): { reviews: DuplicateReview[]; total: number } {
  const d = db();
  const where = status ? "WHERE status = ?" : "";
  const args: (string | number)[] = status ? [status] : [];
  const total = (
    d.prepare(`SELECT COUNT(*) n FROM job_duplicates ${where}`).get(...args) as Row
  ).n as number;
  const rows = d
    .prepare(
      `SELECT * FROM job_duplicates
       ${where}
       ORDER BY (status = 'pending') DESC, score DESC, created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Row[];
  return {
    reviews: rows
      .map(rowToDuplicateReview)
      .filter((r): r is DuplicateReview => !!r),
    total,
  };
}

/** Review counts per status, straight from SQL (no job hydration). */
export function duplicateReviewCounts(): {
  pending: number;
  confirmed: number;
  dismissed: number;
} {
  const rows = db()
    .prepare("SELECT status, COUNT(*) n FROM job_duplicates GROUP BY status")
    .all() as Row[];
  const out = { pending: 0, confirmed: 0, dismissed: 0 };
  for (const r of rows) {
    if (r.status === "pending") out.pending = r.n as number;
    else if (r.status === "confirmed") out.confirmed = r.n as number;
    else if (r.status === "dismissed") out.dismissed = r.n as number;
  }
  return out;
}

/**
 * Pending pairs not already judged "exact", strongest first — the AI scan input.
 * Capped so a huge queue is never hydrated in one go.
 */
export function pendingDuplicateReviews(limit: number): DuplicateReview[] {
  const rows = db()
    .prepare(
      `SELECT * FROM job_duplicates
       WHERE status='pending' AND (decision IS NULL OR decision <> 'exact')
       ORDER BY score DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows
    .map(rowToDuplicateReview)
    .filter((r): r is DuplicateReview => !!r);
}

/** Pending pair ids at/above `min` confidence for a given verdict. */
export function highConfidencePairIds(
  min: number,
  decision: "same" | "different",
): { id: string; score: number }[] {
  return db()
    .prepare(
      `SELECT id, score FROM job_duplicates
       WHERE status='pending' AND decision=? AND confidence IS NOT NULL AND confidence >= ?
       ORDER BY score DESC`,
    )
    .all(decision, min) as { id: string; score: number }[];
}

/** Pending pairs whose two sides come from different sources (real cross-posts). */
export function crossSourcePendingReviews(limit: number): DuplicateReview[] {
  const rows = db()
    .prepare(
      `SELECT d.* FROM job_duplicates d
       JOIN jobs a ON a.id = d.job_id
       JOIN jobs b ON b.id = d.candidate_id
       WHERE d.status='pending' AND a.source <> b.source
       ORDER BY d.score DESC, d.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows
    .map(rowToDuplicateReview)
    .filter((r): r is DuplicateReview => !!r);
}

/** Count of pending cross-source pairs. */
export function crossSourcePendingCount(): number {
  return (
    db()
      .prepare(
        `SELECT COUNT(*) n FROM job_duplicates d
         JOIN jobs a ON a.id = d.job_id
         JOIN jobs b ON b.id = d.candidate_id
         WHERE d.status='pending' AND a.source <> b.source`,
      )
      .get() as Row
  ).n as number;
}

export function getDuplicateReview(id: string): DuplicateReview | null {
  const r = db().prepare("SELECT * FROM job_duplicates WHERE id=?").get(id) as
    | Row
    | undefined;
  return r ? rowToDuplicateReview(r) : null;
}

/** Store the decision engine's verdict without changing review status. */
export function setDuplicateDecision(
  id: string,
  v: Pick<DuplicatePairInput, "engine" | "decision" | "confidence" | "reason">,
): void {
  db()
    .prepare(
      `UPDATE job_duplicates SET engine=?, decision=?, confidence=?, reason=?
       WHERE id=? AND status='pending'`,
    )
    .run(v.engine ?? null, v.decision ?? null, v.confidence ?? null, v.reason ?? null, id);
}

/** Recompute the `dup_review` flag for one or more jobs. */
export function refreshDupFlags(ids: string[]): void {
  const d = db();
  const pending = d.prepare(
    "SELECT 1 FROM job_duplicates WHERE status='pending' AND (job_id=? OR candidate_id=?) LIMIT 1",
  );
  const upd = d.prepare("UPDATE jobs SET dup_review=? WHERE id=?");
  for (const id of new Set(ids)) upd.run(pending.get(id, id) ? 1 : 0, id);
}

/** Confirm a pair (drop the newer, link it) or dismiss it (keep both). */
export function resolveDuplicatePair(
  id: string,
  action: "keep" | "mark",
): DuplicateReview | null {
  const d = db();
  const r = d.prepare("SELECT * FROM job_duplicates WHERE id=?").get(id) as
    | Row
    | undefined;
  if (!r) return null;
  const a = r.job_id as string;
  const b = r.candidate_id as string;

  if (action === "mark") {
    const ja = getJob(a);
    const jb = getJob(b);
    if (ja && jb) {
      const dup = Date.parse(ja.discoveredAt) >= Date.parse(jb.discoveredAt) ? ja : jb;
      const canonical = dup.id === ja.id ? jb : ja;
      d.prepare("UPDATE jobs SET duplicate_of=?, status='skipped' WHERE id=?").run(
        canonical.id,
        dup.id,
      );
    }
    d.prepare(
      "UPDATE job_duplicates SET status='confirmed', decided_at=? WHERE id=?",
    ).run(nowIso(), id);
  } else {
    d.prepare(
      "UPDATE job_duplicates SET status='dismissed', decided_at=? WHERE id=?",
    ).run(nowIso(), id);
  }

  refreshDupFlags([a, b]);
  return getDuplicateReview(id);
}

/**
 * Drop all *pending* pairs and recompute review flags. Confirmed/dismissed
 * decisions are kept, so a rescan never resurrects a pair a human already
 * dismissed (re-detection updates the row but leaves its status alone).
 */
export function clearPendingDuplicates(): number {
  const d = db();
  const removed = (
    d.prepare("SELECT COUNT(*) n FROM job_duplicates WHERE status='pending'").get() as Row
  ).n as number;
  d.prepare("DELETE FROM job_duplicates WHERE status='pending'").run();
  d.exec(
    `UPDATE jobs SET dup_review = CASE WHEN EXISTS (
       SELECT 1 FROM job_duplicates d
       WHERE d.status='pending' AND (d.job_id = jobs.id OR d.candidate_id = jobs.id)
     ) THEN 1 ELSE 0 END`,
  );
  return removed;
}

export function pendingDuplicateCount(): number {
  return (
    db().prepare("SELECT COUNT(*) n FROM job_duplicates WHERE status='pending'").get() as Row
  ).n as number;
}

// --- digests (stored in the DB, not files) ---

export interface DigestSummary {
  day: string;
  updatedAt: string;
  preview: string;
}

export function saveDigest(day: string, markdown: string): void {
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO digests (day, markdown, created_at, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(day) DO UPDATE SET markdown=excluded.markdown, updated_at=excluded.updated_at`,
    )
    .run(day, markdown, now, now);
}

export function listDigests(): DigestSummary[] {
  const rows = db()
    .prepare(
      "SELECT day, updated_at, substr(markdown, 1, 400) AS preview FROM digests ORDER BY day DESC",
    )
    .all() as Row[];
  return rows.map((r) => ({
    day: r.day as string,
    updatedAt: r.updated_at as string,
    preview: (r.preview as string) ?? "",
  }));
}

export function getDigest(day: string): {
  day: string;
  markdown: string;
  updatedAt: string;
} | null {
  const r = db()
    .prepare("SELECT day, markdown, updated_at FROM digests WHERE day=?")
    .get(day) as Row | undefined;
  return r
    ? {
        day: r.day as string,
        markdown: r.markdown as string,
        updatedAt: r.updated_at as string,
      }
    : null;
}
