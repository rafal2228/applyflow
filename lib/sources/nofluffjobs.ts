import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson } from "../util";

/* NoFluffJobs posting shape; read defensively. */
interface NfjPosting {
  id?: string;
  url?: string;
  title?: string;
  name?: string; // company
  technology?: string;
  category?: string;
  seniority?: string[];
  requiredSkills?: string[];
  location?: {
    places?: { city?: string; remote?: boolean }[];
    fullyRemote?: boolean;
  };
}

/** NoFluffJobs — Poland IT board. Public postings endpoint returns all offers. */
export const nofluffjobs: Source = {
  name: "nofluffjobs",
  async fetch() {
    let data: { postings?: NfjPosting[] } | NfjPosting[];
    try {
      data = await fetchJson("https://nofluffjobs.com/api/posting", {
        timeoutMs: 30000,
      });
    } catch {
      return [];
    }
    const postings: NfjPosting[] = Array.isArray(data)
      ? data
      : (data.postings ?? []);
    const out = [];
    for (const p of postings) {
      if (!p.id || !p.title) continue;
      const remote =
        p.location?.fullyRemote === true ||
        (p.location?.places ?? []).some((pl) => pl.remote);
      const tags = [
        ...(p.requiredSkills ?? []),
        p.technology,
        ...(p.seniority ?? []),
      ].filter((x): x is string => !!x);
      out.push(
        mkJob("nofluffjobs", {
          sourceId: p.id,
          url: p.url
            ? `https://nofluffjobs.com/job/${p.url}`
            : `https://nofluffjobs.com/job/${p.id}`,
          title: p.title,
          company: p.name || "Unknown",
          location: remote ? "Remote (PL)" : "Poland",
          remote,
          geo: "PL",
          description: tags.join(", "),
          tags,
          postedAt: null,
          raw: p,
        }),
      );
    }
    return out;
  },
};
