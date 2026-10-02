import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DIGEST_DIR } from "./paths";
import { counts, dueFollowUps, listJobs, snapshotTrend } from "./db";
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

/** Build today's digest from the local DB and write it to digest/. */
export function buildDigest(): string {
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
    `**Pipeline:** ${c.total ?? 0} tracked · ${c.shortlisted ?? 0} shortlisted · ${c.applied ?? 0} applied · ${c.interview ?? 0} interview · ${c.offer ?? 0} offer`,
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

  const md = lines.join("\n");
  mkdirSync(DIGEST_DIR, { recursive: true });
  writeFileSync(resolve(DIGEST_DIR, `${day}.md`), md);
  writeFileSync(resolve(DIGEST_DIR, "latest.md"), md);
  return md;
}

export interface DigestResult {
  markdown: string;
  path: string;
  updatedAt: string | null;
}

/** Read the latest written digest, if any. */
export function readDigest(): DigestResult | null {
  const path = resolve(DIGEST_DIR, "latest.md");
  if (!existsSync(path)) return null;
  const markdown = readFileSync(path, "utf8");
  const m = markdown.match(/_Generated ([^_]+)\._/);
  return { markdown, path, updatedAt: m?.[1] ?? null };
}
