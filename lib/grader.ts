import type { Grade, JobRow, RankResult } from "./types";
import { candidateContext } from "./candidate";
import { chatJson, llmInfo } from "./llm";
import { nowIso, truncate } from "./util";

export { llmInfo as graderInfo };

const VALID: Grade[] = ["A", "B", "C", "D", "E", "F"];

const RUBRIC = `Grade each job's fit for THIS candidate, A (excellent) to F (no fit):
- A: strong on role+seniority+remote+stack, no dealbreakers
- B: good match, minor gaps
- C: plausible but notable gaps
- D/E: weak fit
- F: irrelevant, wrong discipline/level, or a dealbreaker is present

ROLE TYPE — CRITICAL: Engineering-leadership roles (Engineering Manager, Team Lead, Head of
Eng) and senior individual-contributor roles (Senior / Staff / Principal Frontend, Backend,
or Full-stack Engineer) are EQUALLY desirable. They compete on the SAME scale.
- Do NOT down-grade an IC role for lacking management / team-lead scope. Never list it as a con.
- A strong Senior/Staff IC role and a strong EM role with the same stack/remote/comp fit must
  receive the SAME grade.

Weigh ONLY: remote eligibility, seniority (Senior/Staff/Principal or EM/Lead — all good),
stack (TypeScript/React/Next/Node/Backend/web3/infra), and the brief's dealbreakers
(on-site/hybrid/relocation, junior/intern, non-engineering).`;

function buildPrompt(job: JobRow): string {
  return `You are screening one job posting for a candidate.

${candidateContext()}

${RUBRIC}

Return ONLY a JSON object, no prose:
{"grade":"A|B|C|D|E|F","score":<0-100>,"reason":"<one line>","pros":["..."],"cons":["..."]}

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "?"} | remote=${job.remote} | geo=${job.geo ?? "?"}
${job.salaryText ? `Salary: ${job.salaryText}\n` : ""}Description: ${truncate(job.description.replace(/\s+/g, " "), 3000)}`;
}

interface RawGrade {
  grade?: string;
  score?: number;
  reason?: string;
  pros?: string[];
  cons?: string[];
}

/** Grade one job through the OpenAI-compatible endpoint. */
export async function gradeJob(job: JobRow): Promise<RankResult> {
  const { data, model } = await chatJson<RawGrade>(buildPrompt(job), {
    system: "You are a precise job-fit grader. Reply with JSON only.",
  });

  const grade = (VALID.includes(data.grade as Grade) ? data.grade : "C") as Grade;
  return {
    grade,
    score: Math.max(0, Math.min(100, Math.round(data.score ?? 0))),
    reason: data.reason ?? "",
    pros: Array.isArray(data.pros) ? data.pros : [],
    cons: Array.isArray(data.cons) ? data.cons : [],
    model,
    rankedAt: nowIso(),
  };
}
