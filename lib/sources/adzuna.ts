import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson } from "../util";
import { config, env } from "../config";

interface AdzunaResult {
  id: string;
  redirect_url: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
}

function isRemote(r: AdzunaResult): boolean {
  const hay =
    `${r.title} ${r.location?.display_name ?? ""} ${r.description ?? ""}`.toLowerCase();
  return /\bremote\b|\bzdaln/.test(hay); // EN + PL "zdalna"
}

/** Adzuna — aggregator API (needs free app_id/app_key). Skipped if absent. */
export const adzuna: Source = {
  name: "adzuna",
  enabled: () => !!env.adzunaAppId && !!env.adzunaAppKey,
  async fetch() {
    const out = [];
    for (const country of config.adzuna.countries) {
      for (const query of config.adzuna.queries) {
        const url =
          `https://api.adzuna.com/v1/api/jobs/${country}/search/1` +
          `?app_id=${env.adzunaAppId}&app_key=${env.adzunaAppKey}` +
          `&results_per_page=${config.adzuna.maxPerQuery}` +
          `&what=${encodeURIComponent(query)}` +
          `&content-type=application/json`;
        let data: { results?: AdzunaResult[] };
        try {
          data = await fetchJson(url);
        } catch {
          continue;
        }
        for (const r of data.results ?? []) {
          const remote = isRemote(r);
          const salary =
            r.salary_min || r.salary_max
              ? `${Math.round(r.salary_min ?? 0)}–${Math.round(r.salary_max ?? 0)}`
              : null;
          out.push(
            mkJob("adzuna", {
              sourceId: `${country}:${r.id}`,
              url: r.redirect_url,
              title: r.title,
              company: r.company?.display_name || "Unknown",
              location: r.location?.display_name || country.toUpperCase(),
              remote,
              geo: country.toUpperCase(),
              description: r.description || "",
              salaryText: salary,
              postedAt: r.created || null,
              raw: r,
            }),
          );
        }
      }
    }
    return out;
  },
};
