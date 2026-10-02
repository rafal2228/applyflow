import Board from "@/components/Board";
import { listJobs } from "@/lib/db";
import { graderInfo } from "@/lib/grader";

export const dynamic = "force-dynamic";

export default function Page() {
  const jobs = listJobs();
  const grader = graderInfo();
  return <Board initialJobs={jobs} grader={grader} />;
}
