import { resolveDuplicatePair } from "@/lib/db";
import { duplicateCounts } from "@/lib/duplicates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Confirm a duplicate (drop the newer, link it) or dismiss it (keep both). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* handled below */
  }

  const action = body.action === "mark" ? "mark" : body.action === "keep" ? "keep" : null;
  if (!action) {
    return Response.json(
      { error: 'Expected action "mark" (duplicate) or "keep" (not a duplicate).' },
      { status: 400 },
    );
  }

  const review = resolveDuplicatePair(id, action);
  if (!review) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ review, counts: duplicateCounts() });
}
