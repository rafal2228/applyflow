import { getJob, saveRank } from "@/lib/db";
import { gradeJob } from "@/lib/grader";
import { llmInfo } from "@/lib/llm";
import {
  cancelGradeRun,
  getGradeRun,
  pauseGradeRun,
  resumeGradeRun,
  startGradeRun,
} from "@/lib/grade-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** LLM config + current grading-run progress (for the UI). */
export async function GET() {
  return Response.json({ ...llmInfo(), run: getGradeRun() });
}

export async function POST(req: Request) {
  const info = llmInfo();
  if (!info.configured) {
    return Response.json(
      { error: "LLM endpoint is not configured. Set OPENAI_* in applyflow/.env.local." },
      { status: 503 },
    );
  }

  let body: { id?: string; action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body → default action */
  }

  // Grade one job immediately (per-card / drawer button).
  if (body.id && !body.action) {
    const job = getJob(body.id);
    if (!job) return Response.json({ error: "Not found" }, { status: 404 });
    try {
      const result = await gradeJob(job);
      saveRank(job.id, result);
      return Response.json({
        graded: [{ id: job.id, grade: result.grade, score: result.score }],
        errors: [],
      });
    } catch (e) {
      return Response.json({
        graded: [],
        errors: [{ id: job.id, error: (e as Error).message }],
      });
    }
  }

  // Batch grading run controls.
  const action = body.action ?? "start";
  if (action === "start") return Response.json({ run: startGradeRun() });
  if (action === "pause") return Response.json({ run: pauseGradeRun() });
  if (action === "resume") return Response.json({ run: resumeGradeRun() });
  if (action === "cancel") return Response.json({ run: cancelGradeRun() });
  return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
