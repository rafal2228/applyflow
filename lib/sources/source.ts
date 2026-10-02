import type { NormalizedJob } from "../types";
import { jobId, dedupKey, nowIso, htmlToText, truncate } from "../util";

export interface Source {
  name: string;
  /** Whether this source can run (e.g. has needed keys). Default: always. */
  enabled?: () => boolean;
  fetch: () => Promise<NormalizedJob[]>;
}

export interface RawJob {
  sourceId: string;
  url: string;
  title: string;
  company?: string;
  location?: string | null;
  remote?: boolean;
  geo?: string | null;
  description?: string;
  descriptionHtml?: string;
  tags?: string[];
  salaryText?: string | null;
  postedAt?: string | null;
  raw?: unknown;
}

/** Build a NormalizedJob from a source's raw shape. */
export function mkJob(source: string, r: RawJob): NormalizedJob {
  const description = r.description
    ? r.description
    : r.descriptionHtml
      ? htmlToText(r.descriptionHtml)
      : "";
  const company = (r.company || "Unknown").trim();
  const title = r.title.trim();
  return {
    id: jobId(source, r.sourceId),
    source,
    sourceId: r.sourceId,
    url: r.url,
    title,
    company,
    location: r.location ?? null,
    remote: r.remote ?? false,
    geo: r.geo ?? null,
    description: truncate(description, 12000),
    tags: (r.tags ?? []).filter(Boolean).map((t) => t.trim()),
    salaryText: r.salaryText ?? null,
    postedAt: r.postedAt ?? null,
    discoveredAt: nowIso(),
    dedupKey: dedupKey(company, title),
    raw: r.raw ?? {},
  };
}
