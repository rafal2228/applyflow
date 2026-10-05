import { ALL_SOURCES } from "./sources/index";
import { passesIngestionFilter } from "./config";
import { upsertJob } from "./db";
import { recordDuplicateCandidates } from "./duplicates";

/** Discovery sources exposed in the UI. */
export interface SourceInfo {
  name: string;
  label: string;
}
export const SOURCES: SourceInfo[] = [
  { name: "remotive", label: "Remotive" },
  { name: "remoteok", label: "RemoteOK" },
  { name: "weworkremotely", label: "We Work Remotely" },
  { name: "hackernews", label: "Hacker News" },
  { name: "justjoinit", label: "justjoin.it" },
  { name: "nofluffjobs", label: "NoFluffJobs" },
  { name: "adzuna", label: "Adzuna" },
  { name: "ats", label: "Company ATS boards" },
];

export interface DiscoverStats {
  bySource: Record<
    string,
    { fetched: number; inserted: number; duplicate: number; filtered: number; error?: string }
  >;
  totalInserted: number;
}

/** Run sources → filter → normalise/dedup → upsert into the local DB. */
export async function discover(
  only?: string[],
  onLog?: (msg: string) => void,
): Promise<DiscoverStats> {
  const log = onLog ?? (() => {});
  const stats: DiscoverStats = { bySource: {}, totalInserted: 0 };

  const sources = ALL_SOURCES.filter(
    (s) => (!only?.length || only.includes(s.name)) && (s.enabled ? s.enabled() : true),
  );
  const skipped = ALL_SOURCES.filter(
    (s) => only?.length && only.includes(s.name) && s.enabled && !s.enabled(),
  );
  for (const s of skipped) log(`skip ${s.name} (not configured)`);

  await Promise.all(
    sources.map(async (s) => {
      const row = {
        fetched: 0,
        inserted: 0,
        duplicate: 0,
        filtered: 0,
      } as DiscoverStats["bySource"][string];
      stats.bySource[s.name] = row;
      try {
        const jobs = await s.fetch();
        row.fetched = jobs.length;
        for (const job of jobs) {
          if (!passesIngestionFilter(job)) {
            row.filtered++;
            continue;
          }
          const res = upsertJob(job);
          if (res === "inserted") row.inserted++;
          else if (res === "duplicate") row.duplicate++;
          if (res !== "exists") recordDuplicateCandidates(job.id);
        }
        log(
          `${s.name}: fetched ${row.fetched}, +${row.inserted} new, ${row.duplicate} dup, ${row.filtered} off-target`,
        );
      } catch (e) {
        row.error = (e as Error).message;
        log(`${s.name} FAILED: ${row.error}`);
      }
    }),
  );

  stats.totalInserted = Object.values(stats.bySource).reduce(
    (a, b) => a + b.inserted,
    0,
  );
  return stats;
}
