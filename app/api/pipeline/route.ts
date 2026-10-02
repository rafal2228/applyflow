import {
  ACTIONS,
  listRuns,
  SOURCES,
  startRun,
  type TaskAction,
} from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function GET() {
  return Response.json({
    available: true,
    sources: SOURCES,
    actions: ACTIONS,
    runs: listRuns(),
  });
}

export async function POST(req: Request) {
  let body: { action?: string; sources?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* handled below */
  }
  if (!body.action || !ACTIONS.includes(body.action as TaskAction)) {
    return Response.json(
      { error: `Unknown action. Expected one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const run = startRun(body.action as TaskAction, body.sources);
    return Response.json({ run });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
