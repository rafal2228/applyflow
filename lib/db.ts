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
  cover_letter TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(dedup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_grade ON jobs(grade);

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

/** Insert a discovered job, skipping ids we have and cross-source dedup hits. */
export function upsertJob(job: NormalizedJob): UpsertResult {
  const d = db();
  const now = nowIso();
  if (d.prepare("SELECT 1 FROM jobs WHERE id = ?").get(job.id)) {
    d.prepare("UPDATE jobs SET last_seen_at = ? WHERE id = ?").run(now, job.id);
    return "exists";
  }
  if (d.prepare("SELECT 1 FROM jobs WHERE dedup_key = ?").get(job.dedupKey)) {
    d.prepare("UPDATE jobs SET last_seen_at = ? WHERE dedup_key = ?").run(
      now,
      job.dedupKey,
    );
    return "duplicate";
  }
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
