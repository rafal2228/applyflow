import { getRun } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  return Response.json({ run });
}
