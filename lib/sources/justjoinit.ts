import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson } from "../util";

/* justjoin.it offer shape varies; read defensively. */
interface JjOffer {
  slug?: string;
  title?: string;
  companyName?: string;
  city?: string;
  remote?: boolean;
  workplaceType?: string; // "remote" | "partly_remote" | "office"
  requiredSkills?: (string | { name: string })[];
  publishedAt?: string;
  employmentTypes?: { type?: string; from?: number; to?: number; currency?: string }[];
}

function skills(o: JjOffer): string[] {
  return (o.requiredSkills ?? [])
    .map((s) => (typeof s === "string" ? s : s?.name))
    .filter((x): x is string => !!x);
}

function salary(o: JjOffer): string | null {
  const e = (o.employmentTypes ?? []).find((x) => x.from || x.to);
  if (!e) return null;
  return `${e.from ?? "?"}–${e.to ?? "?"} ${e.currency ?? "PLN"} (${e.type ?? ""})`.trim();
}

/** justjoin.it — Poland's biggest IT board. Public v2 offers endpoint. */
export const justjoinit: Source = {
  name: "justjoinit",
  async fetch() {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      let data: { data?: JjOffer[] } | JjOffer[];
      try {
        data = await fetchJson(
          `https://api.justjoin.it/v2/user-panel/offers?orderBy=DESC&sortBy=published&perPage=100&page=${page}`,
          { headers: { Version: "2" } },
        );
      } catch {
        break;
      }
      const offers: JjOffer[] = Array.isArray(data) ? data : (data.data ?? []);
      if (!offers.length) break;
      for (const o of offers) {
        if (!o.slug || !o.title) continue;
        const remote = o.remote === true || o.workplaceType === "remote";
        out.push(
          mkJob("justjoinit", {
            sourceId: o.slug,
            url: `https://justjoin.it/job-offer/${o.slug}`,
            title: o.title,
            company: o.companyName || "Unknown",
            location: remote ? "Remote (PL)" : o.city || "Poland",
            remote,
            geo: "PL",
            description: skills(o).join(", "),
            tags: skills(o),
            salaryText: salary(o),
            postedAt: o.publishedAt ?? null,
            raw: o,
          }),
        );
      }
    }
    return out;
  },
};
