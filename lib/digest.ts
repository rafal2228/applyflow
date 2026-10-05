import {
  counts,
  dueFollowUps,
  getDigest as getDigestRow,
  listDigests as listDigestRows,
  listJobs,
  saveDigest,
  snapshotTrend,
} from "./db";
import { MONITOR_KEYWORDS, snapshotMarket } from "./market";
import { todayStr } from "./util";
import type { JobRow } from "./types";

const MIN_GRADE = (process.env.DIGEST_MIN_GRADE || "B").toUpperCase();
const ORDER = "ABCDEF";

function gradeIndex(grade: string | null): number {
  const i = grade ? ORDER.indexOf(grade) : -1;
  return i < 0 ? 99 : i;
}

function minIndex(): number {
  const i = ORDER.indexOf(MIN_GRADE);
  return i < 0 ? 1 : i;
}

function jobLine(j: JobRow): string {
  const bits = [
    j.location ?? "",
    j.salaryText ?? "",
    j.tailored ? "tailored" : "",
  ].filter(Boolean);
  return `- **${j.grade} (${j.score})** [${j.title} @ ${j.company}](${j.url})${
    bits.length ? ` — ${bits.join(" · ")}` : ""
  }${j.rankReason ? `\n  - ${j.rankReason}` : ""}`;
}

function trendArrow(keyword: string, scope: string): string {
  const t = snapshotTrend(keyword, scope) as { day: string; count: number }[];
  if (t.length === 0) return "–";
  const today = t[0].count;
  const prev = t[1]?.count;
  if (prev === undefined) return `${today}`;
  const d = today - prev;
  const arrow = d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "·";
  return `${today} (${arrow})`;
}

export interface DigestRecord {
  day: string;
  markdown: string;
  updatedAt: string | null;
}

/** Build today's digest from the local DB and persist it (upsert by day). */
export function buildDigest(): DigestRecord {
  const day = todayStr();
  snapshotMarket();

  const c = counts();
  const followUps = dueFollowUps();
  const max = minIndex();
  const jobs = listJobs().filter(
    (j) =>
      j.grade &&
      gradeIndex(j.grade) <= max &&
      (j.status === "shortlisted" || j.status === "new"),
  );

  const byGrade: Record<string, JobRow[]> = {};
  for (const j of jobs) (byGrade[j.grade!] ??= []).push(j);

  const lines: string[] = [
    `# Job digest — ${day}`,
    ``,
    `**Pipeline:** ${c.total ?? 0} tracked · ${c.shortlisted ?? 0} shortlisted · ${c.parked ?? 0} parked · ${c.applied ?? 0} applied · ${c.interview ?? 0} interview · ${c.offer ?? 0} offer`,
    ``,
  ];

  if (followUps.length) {
    lines.push(`## Follow-ups due (${followUps.length})`);
    for (const j of followUps)
      lines.push(
        `- [${j.title} @ ${j.company}](${j.url}) — applied ${j.appliedAt?.slice(0, 10)}`,
      );
    lines.push("");
  }

  lines.push(`## Shortlist (grade ≥ ${MIN_GRADE})`);
  if (!jobs.length) {
    lines.push("_No new ranked jobs at or above threshold. Run discovery, then grade._");
  } else {
    for (const g of ORDER) {
      if (!byGrade[g]?.length) continue;
      lines.push(`\n### Grade ${g} (${byGrade[g].length})`);
      for (const j of byGrade[g]) lines.push(jobLine(j));
    }
  }

  lines.push(``, `## Market (matching postings)`, ``);
  lines.push(`| Keyword | Poland | Global remote |`, `|---|---|---|`);
  for (const k of MONITOR_KEYWORDS) {
    lines.push(`| ${k} | ${trendArrow(k, "PL")} | ${trendArrow(k, "remote-global")} |`);
  }
  lines.push(``, `_Generated ${new Date().toISOString()}._`);

  const markdown = lines.join("\n");
  saveDigest(day, markdown);
  return { day, markdown, updatedAt: new Date().toISOString() };
}

export interface DigestListItem {
  day: string;
  updatedAt: string;
  preview: string;
}

/** One-line preview from raw markdown, skipping the title. */
function previewOf(raw: string): string {
  const cleaned = raw
    .split("\n")
    .map((l) =>
      l
        .replace(/^#+\s*/, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`>|#-]/g, "")
        .trim(),
    )
    .filter(Boolean);
  const body = cleaned.filter((l) => !/^job digest/i.test(l));
  return (body[0] ?? cleaned[0] ?? "").slice(0, 160);
}

export function listDigests(): DigestListItem[] {
  return listDigestRows().map((d) => ({
    day: d.day,
    updatedAt: d.updatedAt,
    preview: previewOf(d.preview),
  }));
}

export function getDigest(day: string): DigestRecord | null {
  const r = getDigestRow(day);
  return r ? { day: r.day, markdown: r.markdown, updatedAt: r.updatedAt } : null;
}
