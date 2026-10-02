import { fetchJson, fetchText, htmlToText, log, truncate } from "./util";
import type { ImportedOffer } from "./types";

const MAX_HTML = 500_000;

const SOURCE_NAMES: Record<string, string> = {
  "greenhouse.io": "Greenhouse",
  "lever.co": "Lever",
  "ashbyhq.com": "Ashby",
  "justjoin.it": "justjoin.it",
  "nofluffjobs.com": "NoFluffJobs",
  "remoteok.com": "RemoteOK",
  "remotive.com": "Remotive",
  "weworkremotely.com": "We Work Remotely",
  "linkedin.com": "LinkedIn",
  "indeed.com": "Indeed",
  "workday.com": "Workday",
  "myworkdayjobs.com": "Workday",
  "smartrecruiters.com": "SmartRecruiters",
  "workable.com": "Workable",
  "bamboohr.com": "BambooHR",
  "recruitee.com": "Recruitee",
};

function sourceName(host: string): string {
  const h = host.replace(/^www\./, "");
  for (const [domain, name] of Object.entries(SOURCE_NAMES)) {
    if (h === domain || h.endsWith(`.${domain}`)) return name;
  }
  return h;
}

/** Block non-http(s) and private/loopback hosts (basic SSRF guard). */
function assertFetchable(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^0\.0\.0\.0$/.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Refusing to fetch a private/local address.");
  }
  return u;
}

function empty(url: string, source: string): ImportedOffer {
  return {
    url,
    title: "",
    company: "",
    location: null,
    remote: false,
    salaryText: null,
    description: "",
    tags: [],
    postedAt: null,
    source,
  };
}

/** Greenhouse single-job JSON API. */
async function tryGreenhouse(url: string, u: URL): Promise<ImportedOffer | null> {
  if (!/(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/jobs\/(\d+)/);
  if (!m) return null;
  const token = u.pathname.split("/").filter(Boolean)[0];
  const data = await fetchJson<{
    title?: string;
    company?: { name?: string };
    location?: { name?: string };
    content?: string;
    updated_at?: string;
  }>(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${m[1]}?questions=false`,
  );
  return {
    ...empty(url, "Greenhouse"),
    title: data.title ?? "",
    company: data.company?.name ?? token,
    location: data.location?.name ?? null,
    remote: /remote/i.test(data.location?.name ?? ""),
    description: truncate(htmlToText(data.content ?? ""), 12000),
    postedAt: data.updated_at ?? null,
  };
}

/** Lever single-posting JSON API. */
async function tryLever(url: string, u: URL): Promise<ImportedOffer | null> {
  if (!/(^|\.)lever\.co$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [token, id] = parts;
  const data = await fetchJson<{
    text?: string;
    categories?: { location?: string };
    descriptionPlain?: string;
    createdAt?: number;
    workplaceType?: string;
  }>(`https://api.lever.co/v0/postings/${token}/${id}?mode=json`);
  return {
    ...empty(url, "Lever"),
    title: data.text ?? "",
    company: token,
    location: data.categories?.location ?? null,
    remote:
      data.workplaceType === "remote" ||
      /remote/i.test(data.categories?.location ?? ""),
    description: data.descriptionPlain ?? "",
    postedAt: data.createdAt ? new Date(data.createdAt).toISOString() : null,
  };
}

/** Find the schema.org JobPosting node in any JSON-LD blocks. */
function jsonLdJob(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const s of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s[1].replace(/<!--[\s\S]*?-->/g, "").trim());
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    const push = (v: unknown) => {
      if (!v) return;
      if (Array.isArray(v)) v.forEach(push);
      else if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o["@graph"]) push(o["@graph"]);
        else nodes.push(o);
      }
    };
    push(parsed);
    const job = nodes.find((n) => {
      const t = n["@type"];
      return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
    });
    if (job) return job;
  }
  return null;
}

function fromJsonLd(url: string, job: Record<string, unknown>): ImportedOffer {
  const org = job.hiringOrganization as
    | { name?: string }
    | string
    | undefined;
  const company = typeof org === "string" ? org : (org?.name ?? "");

  let location: string | null = null;
  const loc = job.jobLocation as unknown;
  if (loc) {
    const first = (Array.isArray(loc) ? loc[0] : loc) as Record<string, unknown>;
    const addr = (first.address ?? first) as Record<string, unknown>;
    const country = addr?.addressCountry as
      | { name?: string }
      | string
      | undefined;
    const parts = [
      addr?.addressLocality,
      addr?.addressRegion,
      typeof country === "string" ? country : country?.name,
    ].filter(Boolean);
    location = parts.length ? parts.join(", ") : null;
  }

  const remote =
    job.jobLocationType === "TELECOMMUTE" ||
    /remote|telecommute/i.test(JSON.stringify(job.applicantLocationRequirements ?? "")) ||
    /remote/i.test(location ?? "");

  let salaryText: string | null = null;
  const bs = job.baseSalary as Record<string, unknown> | undefined;
  if (bs) {
    const v = (bs.value ?? bs) as Record<string, unknown>;
    const currency = (bs.currency ?? v?.currency ?? "") as string;
    const min = v?.minValue ?? v?.value;
    const max = v?.maxValue;
    if (min || max) salaryText = `${min ?? "?"}–${max ?? min} ${currency}`.trim();
  }

  const emp = job.employmentType as string | string[] | undefined;
  const tags = emp ? (Array.isArray(emp) ? emp : [emp]).map(String) : [];

  return {
    url,
    title: (job.title as string) ?? "",
    company,
    location,
    remote,
    salaryText,
    description: truncate(htmlToText((job.description as string) ?? ""), 12000),
    tags,
    postedAt: (job.datePosted as string) ?? null,
    source: "schema.org",
  };
}

function meta(html: string, key: string): string | null {
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  return (html.match(a)?.[1] ?? html.match(b)?.[1])?.trim() || null;
}

function fromHtml(url: string, html: string, host: string): ImportedOffer {
  const title =
    meta(html, "og:title") ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
    "";
  const company = meta(html, "og:site_name") ?? sourceName(host);
  const description =
    meta(html, "og:description") ?? meta(html, "description") ?? "";
  const remote = /remote|zdaln/i.test(`${title} ${description}`);
  return {
    ...empty(url, sourceName(host)),
    title,
    company,
    description,
    remote,
  };
}

/** Best-effort parse of an offer from a posting URL. */
export async function importFromUrl(raw: string): Promise<ImportedOffer> {
  const u = assertFetchable(raw);

  for (const attempt of [tryGreenhouse, tryLever]) {
    try {
      const offer = await attempt(raw, u);
      if (offer?.title) return offer;
    } catch (e) {
      log("import", `${attempt.name} failed: ${(e as Error).message}`);
    }
  }

  const html = truncate(await fetchText(raw, { timeoutMs: 20000 }), MAX_HTML);
  const ld = jsonLdJob(html);
  const offer = ld ? fromJsonLd(raw, ld) : fromHtml(raw, html, u.hostname);

  if (!offer.title) {
    throw new Error(
      "Couldn't find job details on that page — add it manually instead.",
    );
  }
  return offer;
}
