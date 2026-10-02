import { importFromUrl } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pull and parse an offer from a posting URL. */
export async function POST(req: Request) {
  let body: { url?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* handled below */
  }
  const url = body.url?.trim();
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

  try {
    return Response.json({ offer: await importFromUrl(url) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
