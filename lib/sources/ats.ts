import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Source } from "./source";
import { mkJob } from "./source";
import type { RawJob } from "./source";
import { fetchJson, htmlToText, log } from "../util";
import { config } from "../config";
import { SEED_COMPANIES } from "./ats-companies";
import type { AtsCompany } from "./ats-companies";

const here = dirname(fileURLToPath(import.meta.url));

function companies(): AtsCompany[] {
  const extra = resolve(here, "seed-companies.json");
  if (existsSync(extra)) {
    try {
      const arr = JSON.parse(readFileSync(extra, "utf8")) as AtsCompany[];
      return [...SEED_COMPANIES, ...arr];
    } catch {
      /* ignore malformed override */
    }
  }
  return SEED_COMPANIES;
}

async function greenhouse(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<{
    jobs?: {
      id: number;
      title: string;
      location?: { name?: string };
      absolute_url: string;
      content?: string;
      updated_at?: string;
    }[];
  }>(`https://boards-api.greenhouse.io/v1/boards/${c.token}/jobs?content=true`);
  return (data.jobs ?? []).slice(0, config.ats.maxPerCompany).map((j) => ({
    sourceId: `${c.token}:${j.id}`,
    url: j.absolute_url,
    title: j.title,
    company: c.name,
    location: j.location?.name ?? null,
    remote: /remote/i.test(j.location?.name ?? ""),
    descriptionHtml: j.content ?? "",
    postedAt: j.updated_at ?? null,
    raw: j,
  }));
}

async function lever(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<
    {
      id: string;
      text: string;
      categories?: { location?: string; team?: string; commitment?: string };
      hostedUrl: string;
      descriptionPlain?: string;
      createdAt?: number;
      workplaceType?: string;
    }[]
  >(`https://api.lever.co/v0/postings/${c.token}?mode=json`);
  return (Array.isArray(data) ? data : [])
    .slice(0, config.ats.maxPerCompany)
    .map((j) => ({
      sourceId: `${c.token}:${j.id}`,
      url: j.hostedUrl,
      title: j.text,
      company: c.name,
      location: j.categories?.location ?? null,
      remote:
        j.workplaceType === "remote" ||
        /remote/i.test(j.categories?.location ?? ""),
      description: j.descriptionPlain ?? "",
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      raw: j,
    }));
}

async function ashby(c: AtsCompany): Promise<RawJob[]> {
  const data = await fetchJson<{
    jobs?: {
      id?: string;
      title: string;
      location?: string;
      employmentType?: string;
      jobUrl?: string;
      applyUrl?: string;
      descriptionPlain?: string;
      isRemote?: boolean;
      publishedAt?: string;
    }[];
  }>(
    `https://api.ashbyhq.com/posting-api/job-board/${c.token}?includeCompensation=true`,
  );
  return (data.jobs ?? []).slice(0, config.ats.maxPerCompany).map((j, i) => ({
    sourceId: `${c.token}:${j.id ?? i}`,
    url: j.jobUrl || j.applyUrl || `https://jobs.ashbyhq.com/${c.token}`,
    title: j.title,
    company: c.name,
    location: j.location ?? null,
    remote: j.isRemote === true || /remote/i.test(j.location ?? ""),
    description: j.descriptionPlain ?? "",
    postedAt: j.publishedAt ?? null,
    raw: j,
  }));
}

const FETCHERS: Record<AtsCompany["provider"], (c: AtsCompany) => Promise<RawJob[]>> = {
  greenhouse,
  lever,
  ashby,
};

/** Poll each seed company's ATS board. Per-company failures are skipped. */
export const ats: Source = {
  name: "ats",
  async fetch() {
    const out = [];
    let okCompanies = 0;
    for (const c of companies()) {
      try {
        const raws = await FETCHERS[c.provider](c);
        if (raws.length) okCompanies++;
        for (const r of raws) {
          if (r.descriptionHtml && !r.description)
            r.description = htmlToText(r.descriptionHtml);
          out.push(mkJob(`ats:${c.provider}`, r));
        }
      } catch (e) {
        log("ats", `skip ${c.name} (${c.provider}/${c.token}): ${(e as Error).message}`);
      }
    }
    log("ats", `${okCompanies} companies returned jobs`);
    return out;
  },
};
