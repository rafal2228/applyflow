import { buildDigest, getDigest, listDigests } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** `GET /api/digest` → history; `GET /api/digest?day=YYYY-MM-DD` → one digest. */
export async function GET(req: Request) {
  const day = new URL(req.url).searchParams.get("day");
  if (day) {
    const digest = getDigest(day);
    if (!digest) return Response.json({ error: "No such digest" }, { status: 404 });
    return Response.json({ digest });
  }
  return Response.json({ digests: listDigests() });
}

/** Generate (or refresh) today's digest. */
export async function POST() {
  try {
    return Response.json({ digest: buildDigest() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
