import { getJob } from "@/lib/db";
import { llmInfo } from "@/lib/llm";
import { readApplication, tailorJob } from "@/lib/tailor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });
  const job = getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  const lang = new URL(req.url).searchParams.get("lang") ?? "en";
  return Response.json({ application: readApplication(job, lang) });
}

export async function POST(req: Request) {
  if (!llmInfo().configured) {
    return Response.json(
      { error: "LLM endpoint is not configured (set OPENAI_* in .env.local)." },
      { status: 503 },
    );
  }
  let body: { id?: string; lang?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* handled below */
  }
  if (!body.id) return Response.json({ error: "Missing id" }, { status: 400 });
  try {
    const application = await tailorJob(body.id, body.lang ?? "en");
    return Response.json({ application });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
