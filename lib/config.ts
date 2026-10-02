import type { NormalizedJob } from "./types";

/** Discovery credentials (loaded from .env.local by Next.js). */
export const env = {
  adzunaAppId: process.env.ADZUNA_APP_ID || "",
  adzunaAppKey: process.env.ADZUNA_APP_KEY || "",
};

/** Discovery knobs: which roles/boards we pull and keep. */
export const config = {
  // Titles we care about (leadership + senior IC). Used for query-based sources
  // and post-fetch focus filtering.
  titleKeywords: [
    "engineering manager",
    "team lead",
    "tech lead",
    "technical lead",
    "lead engineer",
    "lead software",
    "frontend lead",
    "head of engineering",
    "head of frontend",
    "vp of engineering",
    "director of engineering",
    "staff engineer",
    "staff software",
    "principal engineer",
    "principal software",
    "senior software engineer",
    "senior frontend",
    "senior full stack",
    "senior fullstack",
    "senior full-stack",
    "senior react",
    "senior typescript",
  ],
  // Stack signals that, combined with a seniority hint, count as a match.
  stackKeywords: [
    "typescript",
    "javascript",
    "react",
    "next.js",
    "nextjs",
    "node",
    "nest",
    "angular",
    "web3",
    "ethereum",
    "solidity",
    "blockchain",
    "frontend",
    "full stack",
    "fullstack",
    "full-stack",
  ],
  seniorityKeywords: ["senior", "lead", "staff", "principal", "head", "manager"],
  // Hard title excludes (wrong discipline/level even if keyword overlaps).
  excludeTitleKeywords: [
    "junior",
    "intern",
    "internship",
    "graduate",
    "apprentice",
    "support engineer",
    "sales",
    "recruiter",
    "account executive",
    "designer",
    "data entry",
    "qa manual",
  ],
  adzuna: {
    countries: ["pl", "gb", "us", "de"],
    queries: [
      "engineering manager",
      "team lead frontend",
      "senior software engineer react",
      "staff engineer typescript",
    ],
    maxPerQuery: 50,
  },
  ats: { maxPerCompany: 60 },
  // Market-monitoring keywords (counts tracked daily, PL vs global-remote).
  monitorKeywords: [
    "react",
    "typescript",
    "next.js",
    "node",
    "kubernetes",
    "web3",
    "solidity",
    "engineering manager",
  ],
  // Active jobs not re-seen in discovery for this many days are auto-expired.
  expireDays: 14,
};

const lc = (s: string | null | undefined) => (s || "").toLowerCase();

/** Does this posting match our focused role scope? */
export function isFocusMatch(job: NormalizedJob): boolean {
  const title = lc(job.title);
  if (config.excludeTitleKeywords.some((k) => title.includes(k))) return false;
  if (config.titleKeywords.some((k) => title.includes(k))) return true;
  const hasSeniority = config.seniorityKeywords.some((k) => title.includes(k));
  if (!hasSeniority) return false;
  const hay = `${title} ${lc(job.description)} ${lc(job.tags.join(" "))}`;
  return config.stackKeywords.some((k) => hay.includes(k));
}

/** Remote-eligible (global remote + Poland-remote; no on-site/hybrid). */
export function isRemoteEligible(job: NormalizedJob): boolean {
  if (job.remote) return true;
  const hay = `${lc(job.location)} ${lc(job.title)}`;
  return /\bremote\b/.test(hay);
}

/** Combined ingestion filter. */
export function passesIngestionFilter(job: NormalizedJob): boolean {
  return isRemoteEligible(job) && isFocusMatch(job);
}
