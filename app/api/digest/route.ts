import { buildDigest, readDigest } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const digest = readDigest();
  if (!digest) return Response.json({ error: "No digest yet" }, { status: 404 });
  return Response.json(digest);
}

/** Regenerate the digest from the local DB, then return it. */
export async function POST() {
  try {
    buildDigest();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  const digest = readDigest();
  if (!digest) return Response.json({ error: "No digest produced" }, { status: 500 });
  return Response.json(digest);
}
