import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson, fetchText } from "../util";
import type { NormalizedJob } from "../types";

/* justjoin.it shapes vary; read defensively. */
interface JjApiOffer {
  slug?: string;
  title?: string;
  companyName?: string;
  city?: string;
  remote?: boolean;
  workplaceType?: string;
  requiredSkills?: (string | { name: string })[];
  publishedAt?: string;
  employmentTypes?: { type?: string; from?: number; to?: number; currency?: string }[];
}

/** Shape embedded in the listing page's Next.js flight data. */
interface JjPageOffer {
  title?: string;
  slug?: string;
  city?: string;
  companyName?: string;
  workplaceType?: string;
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  experienceLevel?: string;
  publishedAt?: string;
  employmentTypes?: { type?: string; from?: number; to?: number; currency?: string }[];
}

function skillNames(skills: (string | { name: string })[] | undefined): string[] {
  return (skills ?? [])
    .map((s) => (typeof s === "string" ? s : s?.name))
    .filter((x): x is string => !!x);
}

function salaryText(
  types: { from?: number; to?: number; currency?: string; type?: string }[] | undefined,
): string | null {
  const e = (types ?? []).find((x) => x.from || x.to);
  if (!e) return null;
  return `${e.from ?? "?"}–${e.to ?? "?"} ${e.currency ?? "PLN"} (${e.type ?? ""})`.trim();
}

function mk(
  o: JjPageOffer | JjApiOffer,
  opts: { tags: string[]; remote: boolean },
): NormalizedJob | null {
  if (!o.slug || !o.title) return null;
  return mkJob("justjoinit", {
    sourceId: o.slug,
    url: `https://justjoin.it/job-offer/${o.slug}`,
    title: o.title,
    company: o.companyName || "Unknown",
    location: opts.remote ? "Remote (PL)" : o.city || "Poland",
    remote: opts.remote,
    geo: "PL",
    description: opts.tags.join(", "),
    tags: opts.tags,
    salaryText: salaryText(o.employmentTypes),
    postedAt: o.publishedAt ?? null,
    raw: o,
  });
}

// --- page scraping (the public API is often blocked by Cloudflare) ---

/** Find the matching closing `]` for the `[` at `start`, honouring strings. */
function matchArray(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract offer arrays from the page's `self.__next_f.push` flight payloads. */
function extractPageOffers(html: string): JjPageOffer[] {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  let flight = "";
  while ((m = re.exec(html))) {
    try {
      flight += JSON.parse(m[1]) as string;
    } catch {
      /* skip malformed chunk */
    }
  }

  const out: JjPageOffer[] = [];
  const marker = '"offers":[';
  let idx = flight.indexOf(marker);
  while (idx >= 0) {
    const start = idx + marker.length - 1;
    const end = matchArray(flight, start);
    if (end < 0) break;
    try {
      const arr = JSON.parse(flight.slice(start, end + 1)) as JjPageOffer[];
      if (Array.isArray(arr)) out.push(...arr);
    } catch {
      /* skip */
    }
    idx = flight.indexOf(marker, end);
  }
  return out;
}

async function fetchFromPages(): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    let html: string;
    try {
      html = await fetchText(
        `https://justjoin.it/job-offers/all-locations?page=${page}`,
        { timeoutMs: 30000 },
      );
    } catch {
      break;
    }
    const offers = extractPageOffers(html);
    if (!offers.length) break;
    for (const o of offers) {
      if (!o.slug || seen.has(o.slug)) continue;
      seen.add(o.slug);
      const tags = [
        ...(o.requiredSkills ?? []),
        ...(o.niceToHaveSkills ?? []),
        o.experienceLevel,
      ].filter((x): x is string => !!x);
      const remote = (o.workplaceType ?? "").toLowerCase().includes("remote");
      const job = mk(o, { tags, remote });
      if (job) out.push(job);
    }
  }
  return out;
}

// --- public API fallback ---

async function fetchFromApi(): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (let page = 1; page <= 3; page++) {
    let data: { data?: JjApiOffer[] } | JjApiOffer[];
    try {
      data = await fetchJson(
        `https://api.justjoin.it/v2/user-panel/offers?orderBy=DESC&sortBy=published&perPage=100&page=${page}`,
        { headers: { Version: "2" } },
      );
    } catch {
      break;
    }
    const offers: JjApiOffer[] = Array.isArray(data) ? data : (data.data ?? []);
    if (!offers.length) break;
    for (const o of offers) {
      const remote = o.remote === true || o.workplaceType === "remote";
      const job = mk(o, { tags: skillNames(o.requiredSkills), remote });
      if (job) out.push(job);
    }
  }
  return out;
}

/** justjoin.it — Poland's biggest IT board. Scrapes the listing page (the API
 * is frequently Cloudflare-blocked), falling back to the public v2 endpoint. */
export const justjoinit: Source = {
  name: "justjoinit",
  async fetch() {
    const fromPages = await fetchFromPages();
    if (fromPages.length) return fromPages;
    try {
      return await fetchFromApi();
    } catch {
      return [];
    }
  },
};
