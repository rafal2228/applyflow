import { getJob, saveRank, ungradedJobs } from "@/lib/db";
import { gradeJob, graderInfo } from "@/lib/grader";
import type { JobRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Is the LLM endpoint wired up? The UI uses this to enable/disable grading. */
export async function GET() {
  return Response.json(graderInfo());
}

export async function POST(req: Request) {
  const info = graderInfo();
  if (!info.configured) {
    return Response.json(
      { error: "LLM endpoint is not configured. Set OPENAI_* in applyflow/.env.local." },
      { status: 503 },
    );
  }

  let body: { id?: string; all?: boolean; limit?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body means grade the queue */
  }

  const jobs: JobRow[] = body.id
    ? [getJob(body.id)].filter((j): j is JobRow => j !== null)
    : ungradedJobs(Math.min(body.limit ?? 25, 50));

  if (!jobs.length) return Response.json({ graded: [], errors: [] });

  const graded: { id: string; grade: string; score: number }[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const job of jobs) {
    try {
      const result = await gradeJob(job);
      saveRank(job.id, result);
      graded.push({ id: job.id, grade: result.grade, score: result.score });
    } catch (e) {
      errors.push({ id: job.id, error: (e as Error).message });
    }
  }

  return Response.json({ graded, errors });
}
