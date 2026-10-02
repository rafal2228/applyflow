import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson } from "../util";

interface RemoteOkJob {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  description?: string;
  location?: string;
  tags?: string[];
  url?: string;
  apply_url?: string;
  date?: string;
  salary_min?: number;
  salary_max?: number;
}

/** RemoteOK — free public API. First array element is a legal notice (skipped). */
export const remoteok: Source = {
  name: "remoteok",
  async fetch() {
    const data = await fetchJson<RemoteOkJob[]>("https://remoteok.com/api");
    const jobs = (Array.isArray(data) ? data : []).filter((j) => j.id);
    return jobs.map((j) => {
      const salary =
        j.salary_min && j.salary_max
          ? `$${j.salary_min}–$${j.salary_max}`
          : null;
      return mkJob("remoteok", {
        sourceId: String(j.id),
        url: j.url || `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
        title: j.position || "Untitled",
        company: j.company || "Unknown",
        location: j.location || "Remote",
        remote: true,
        geo: "global",
        descriptionHtml: j.description || "",
        tags: j.tags ?? [],
        salaryText: salary,
        postedAt: j.date || null,
        raw: j,
      });
    });
  },
};
