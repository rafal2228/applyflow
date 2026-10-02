import { createJob, listJobs } from "@/lib/db";
import type { NewJobInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ jobs: listJobs() });
}

export async function POST(req: Request) {
  let input: NewJobInput;
  try {
    input = (await req.json()) as NewJobInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!input.title?.trim() || !input.company?.trim()) {
    return Response.json(
      { error: "Both `title` and `company` are required." },
      { status: 400 },
    );
  }

  const result = createJob(input);
  if (!result.ok) {
    return Response.json(
      { error: "This role is already on your board.", existing: result.existing },
      { status: 409 },
    );
  }
  return Response.json({ job: result.job }, { status: 201 });
}
