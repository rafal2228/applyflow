import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson } from "../util";

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location: string;
  description: string;
  tags: string[];
  salary: string;
  publication_date: string;
}

/** Remotive — free public remote-jobs API. https://remotive.com/api/remote-jobs */
export const remotive: Source = {
  name: "remotive",
  async fetch() {
    const data = await fetchJson<{ jobs: RemotiveJob[] }>(
      "https://remotive.com/api/remote-jobs?category=software-dev&limit=200",
    );
    return (data.jobs ?? []).map((j) =>
      mkJob("remotive", {
        sourceId: String(j.id),
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || "Remote",
        remote: true,
        geo: "global",
        descriptionHtml: j.description,
        tags: j.tags,
        salaryText: j.salary || null,
        postedAt: j.publication_date || null,
        raw: j,
      }),
    );
  },
};
