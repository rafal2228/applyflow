import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPLICATIONS_DIR } from "./paths";
import { getJob, markTailored, updateCoverLetter } from "./db";
import { candidateContext } from "./candidate";
import { chatJson } from "./llm";
import { truncate } from "./util";
import type { JobRow } from "./types";

interface TailoredCv {
  headline: string;
  summary: string;
  selectedSkills: string[];
  experience: { company: string; title: string; period: string; bullets: string[] }[];
  coverLetter: string;
  matchNotes?: string;
}

/** Same slug the pipeline's tailor uses, so artifacts are shared. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function applicationDir(job: JobRow): string {
  return resolve(APPLICATIONS_DIR, `${slugify(job.company)}-${slugify(job.title)}`);
}

function buildPrompt(job: JobRow, lang: string): string {
  const langLabel = lang === "pl" ? "Polish" : "English";
  return `Tailor this candidate's CV and write a cover letter for ONE specific job.

STRICT RULES:
- Use ONLY facts present in the candidate data below. DO NOT invent employers, titles, dates, metrics, or skills.
- You may SELECT, REORDER, and lightly REPHRASE existing experience to foreground what this job needs.
- Lead with the skills/experience that match the job's requirements (helps ATS keyword match).
- Write in ${langLabel}.

CANDIDATE DATA (source of truth):
${candidateContext()}

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "?"} (remote=${job.remote})
Description:
${truncate(job.description.replace(/\s+/g, " "), 4000)}

Return ONLY this JSON:
{
  "headline": "short professional headline tuned to the role",
  "summary": "2-3 sentence summary positioning the candidate for THIS job",
  "selectedSkills": ["most relevant skills first, ~12 max"],
  "experience": [
    {"company":"...","title":"...","period":"...","bullets":["selected/rephrased highlights, most relevant first"]}
  ],
  "coverLetter": "150-220 word cover letter, ${langLabel}, specific to this company/role",
  "matchNotes": "one line on why this candidate fits (or the main gap)"
}`;
}

function buildCoverLetterPrompt(job: JobRow, lang: string): string {
  const langLabel = lang === "pl" ? "Polish" : "English";
  return `Write a dedicated cover letter for ONE specific job.

STRICT RULES:
- Use ONLY facts present in the candidate data below. DO NOT invent employers, titles, dates, metrics, or skills.
- Address this exact company/role; reference concrete requirements from the description.
- Sound human and specific, never generic. No placeholders like "[Company]".
- 150-220 words, 3-4 short paragraphs. Plain prose (Markdown is fine, no headings).
- Write in ${langLabel}.

CANDIDATE DATA (source of truth):
${candidateContext()}

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "?"} (remote=${job.remote})
Description:
${truncate(job.description.replace(/\s+/g, " "), 4000)}

Return ONLY this JSON:
{
  "coverLetter": "the full cover letter text, ${langLabel}"
}`;
}

function renderCvMarkdown(job: JobRow, cv: TailoredCv): string {
  const exp = cv.experience
    .map(
      (e) =>
        `### ${e.title} — ${e.company}\n*${e.period}*\n\n${e.bullets.map((b) => `- ${b}`).join("\n")}`,
    )
    .join("\n\n");
  return `# ${cv.headline}

${cv.summary}

**Tailored for:** ${job.title} @ ${job.company} — ${job.url}

## Skills
${cv.selectedSkills.join(" · ")}

## Experience
${exp}
`;
}

export interface ApplicationFiles {
  dir: string;
  lang: string;
  cv: string | null;
  coverLetter: string | null;
  job: string | null;
  matchNotes: string | null;
}

/** Generate a tailored CV + cover letter via the LLM; write shared artifacts. */
export async function tailorJob(id: string, lang = "en"): Promise<ApplicationFiles> {
  const job = getJob(id);
  if (!job) throw new Error(`No job with id ${id}`);

  const { data: cv } = await chatJson<TailoredCv>(buildPrompt(job, lang), {
    timeoutMs: 240_000,
    system: "You tailor CVs and write cover letters. Reply with JSON only.",
  });

  const dir = applicationDir(job);
  mkdirSync(dir, { recursive: true });
  const suffix = lang === "en" ? "" : `.${lang}`;
  writeFileSync(resolve(dir, `cv${suffix}.md`), renderCvMarkdown(job, cv));
  writeFileSync(resolve(dir, `cover-letter${suffix}.md`), cv.coverLetter + "\n");
  writeFileSync(resolve(dir, `tailored${suffix}.json`), JSON.stringify(cv, null, 2));
  writeFileSync(
    resolve(dir, "job.md"),
    `# ${job.title} @ ${job.company}\n\n${job.url}\n\nLocation: ${job.location ?? "?"} (remote=${job.remote})\nGrade: ${job.grade ?? "?"} (${job.score ?? "?"}) — ${job.rankReason ?? ""}\n\n---\n\n${job.description}\n`,
  );

  if (cv.coverLetter) updateCoverLetter(job.id, cv.coverLetter.trim());
  markTailored(job.id);
  return readApplicationFiles(dir, lang);
}

/**
 * Write a dedicated cover letter for one job and persist it onto the offer.
 * The text is stored on the job row so the drawer can edit/copy it directly.
 */
export async function writeCoverLetter(id: string, lang = "en"): Promise<string> {
  const job = getJob(id);
  if (!job) throw new Error(`No job with id ${id}`);

  const { data } = await chatJson<{ coverLetter: string }>(
    buildCoverLetterPrompt(job, lang),
    {
      timeoutMs: 240_000,
      system: "You write tailored cover letters. Reply with JSON only.",
    },
  );

  const coverLetter = (data.coverLetter ?? "").trim();
  if (!coverLetter) throw new Error("The model returned an empty cover letter.");

  updateCoverLetter(id, coverLetter);
  return coverLetter;
}

/** Read already-generated artifacts for a job (if the pipeline/UI made them). */
export function readApplication(job: JobRow, lang = "en"): ApplicationFiles | null {
  const dir = applicationDir(job);
  if (!existsSync(dir)) return null;
  return readApplicationFiles(dir, lang);
}

function readApplicationFiles(dir: string, lang: string): ApplicationFiles {
  const suffix = lang === "en" ? "" : `.${lang}`;
  const read = (name: string): string | null => {
    const p = resolve(dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const jsonRaw = read(`tailored${suffix}.json`);
  let matchNotes: string | null = null;
  if (jsonRaw) {
    try {
      matchNotes = (JSON.parse(jsonRaw) as TailoredCv).matchNotes ?? null;
    } catch {
      /* ignore */
    }
  }
  return {
    dir,
    lang,
    cv: read(`cv${suffix}.md`),
    coverLetter: read(`cover-letter${suffix}.md`),
    job: read("job.md"),
    matchNotes,
  };
}
