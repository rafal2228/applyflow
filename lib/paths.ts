import { resolve } from "node:path";

/**
 * ApplyFlow is fully self-contained: it owns its database, its discovery
 * sources, its digest and its tailored applications. All paths are local to
 * this repo (relative to the process working directory).
 */

/** Local SQLite database (created empty on first run). */
export const DB_PATH = resolve(
  process.cwd(),
  process.env.JOBS_DB_PATH?.trim() || "data/jobs.db",
);

/** Where daily digests are written. */
export const DIGEST_DIR = resolve(process.cwd(), "digest");

/** Where tailored CVs / cover letters are written. */
export const APPLICATIONS_DIR = resolve(process.cwd(), "applications");

/** Candidate context files (CV + targeting brief). */
export const PROFILE_DIR = resolve(process.cwd(), "profile");
