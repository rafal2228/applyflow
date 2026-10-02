import { getJob, setStatus, updateNotes } from "@/lib/db";
import { STATUSES, type JobStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ job });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getJob(id)) return Response.json({ error: "Not found" }, { status: 404 });

  let body: { status?: string; notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as JobStatus)) {
      return Response.json(
        { error: `Unknown status "${body.status}"` },
        { status: 400 },
      );
    }
    setStatus(id, body.status as JobStatus);
  }
  if (body.notes !== undefined) updateNotes(id, body.notes);

  return Response.json({ job: getJob(id) });
}
