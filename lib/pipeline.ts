import { config } from "./config";
import { discover, SOURCES } from "./discovery";
import { buildDigest } from "./digest";
import { snapshotMarket } from "./market";
import { expireStale } from "./db";
import {
  decisionEngineAvailable,
  rebuildDuplicateCandidates,
  scanPendingDuplicates,
} from "./duplicates";
import { nowIso } from "./util";

export { SOURCES };

/** Background tasks the UI can trigger. */
export type TaskAction =
  | "discover"
  | "daily"
  | "expire"
  | "digest"
  | "monitor"
  | "duplicates";

export const ACTIONS: TaskAction[] = [
  "discover",
  "daily",
  "expire",
  "digest",
  "monitor",
  "duplicates",
];

const LABELS: Record<TaskAction, string> = {
  discover: "Discover jobs",
  daily: "Daily run (discover → expire → digest)",
  expire: "Expire stale jobs",
  digest: "Write digest",
  monitor: "Market snapshot",
  duplicates: "Find duplicates (fingerprint → AI)",
};

export interface RunState {
  id: string;
  action: TaskAction;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  running: boolean;
  lines: string[];
}

export type RunSummary = Omit<RunState, "lines"> & { tail: string[] };

// Next.js loads each route in its own module instance; keep the run registry on
// globalThis so the POST (start) and GET (poll) routes see the same runs.
interface Store {
  runs: Map<string, RunState>;
  order: string[];
}
const g = globalThis as unknown as { __applyflowRuns?: Store };

function store(): Store {
  if (!g.__applyflowRuns) g.__applyflowRuns = { runs: new Map(), order: [] };
  return g.__applyflowRuns;
}

const MAX_RUNS = 20;
const MAX_LINES = 4000;

/** Start a task and begin capturing its output in the background. */
export function startRun(action: TaskAction, sources?: string[]): RunState {
  const s = store();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const run: RunState = {
    id,
    action,
    label: LABELS[action],
    startedAt: nowIso(),
    finishedAt: null,
    exitCode: null,
    running: true,
    lines: [],
  };
  s.runs.set(id, run);
  s.order.unshift(id);
  for (const dropped of s.order.splice(MAX_RUNS)) s.runs.delete(dropped);

  void execute(run, action, sources);
  return run;
}

export function getRun(id: string): RunState | null {
  return store().runs.get(id) ?? null;
}

export function listRuns(): RunSummary[] {
  const s = store();
  return s.order
    .map((id) => s.runs.get(id))
    .filter((r): r is RunState => !!r)
    .map((r) => {
      const { lines, ...rest } = r;
      return { ...rest, tail: lines.slice(-6) };
    });
}

async function execute(
  run: RunState,
  action: TaskAction,
  sources?: string[],
): Promise<void> {
  const log = (m: string) => push(run, m);
  try {
    switch (action) {
      case "discover":
        await doDiscover(log, sources);
        break;
      case "daily":
        await doDiscover(log, sources);
        doExpire(log);
        doDigest(log);
        break;
      case "expire":
        doExpire(log);
        break;
      case "digest":
        doDigest(log);
        break;
      case "monitor":
        doMonitor(log);
        break;
      case "duplicates":
        await doDuplicates(log);
        break;
    }
    run.exitCode = 0;
    push(run, "✓ done");
  } catch (e) {
    run.exitCode = 1;
    push(run, `✗ ${(e as Error).message}`);
  } finally {
    run.running = false;
    run.finishedAt = nowIso();
  }
}

async function doDiscover(
  log: (m: string) => void,
  sources?: string[],
): Promise<void> {
  log(`discover: ${sources?.length ? sources.join(", ") : "all sources"}`);
  const s = await discover(sources, log);
  log(`discovered +${s.totalInserted} new`);
}

function doExpire(log: (m: string) => void): void {
  const stale = expireStale(config.expireDays);
  log(
    stale.length
      ? `expired ${stale.length} job(s) not seen in ${config.expireDays} days`
      : `no jobs stale for ${config.expireDays} days`,
  );
}

function doDigest(log: (m: string) => void): void {
  const digest = buildDigest();
  log(`digest saved for ${digest.day}`);
}

function doMonitor(log: (m: string) => void): void {
  const { day, counts } = snapshotMarket();
  log(`snapshot ${day}: ${counts.length} keywords`);
  for (const c of counts) log(`  ${c.keyword}: PL ${c.pl} · global ${c.remoteGlobal}`);
}

async function doDuplicates(log: (m: string) => void): Promise<void> {
  const rebuilt = rebuildDuplicateCandidates();
  log(
    `fingerprinted ${rebuilt.indexed} job(s), ${rebuilt.candidates} candidate pair(s)`,
  );
  if (!decisionEngineAvailable()) {
    log("no decision engine configured — pairs left pending for manual review");
    return;
  }
  const scan = await scanPendingDuplicates(50);
  log(
    `AI scan: ${scan.scanned} judged (${scan.same} same, ${scan.different} different)` +
      (scan.skipped ? `, ${scan.skipped} skipped` : ""),
  );
  for (const err of scan.errors) log(`  ! ${err}`);
}

function push(run: RunState, line: string): void {
  run.lines.push(line);
  if (run.lines.length > MAX_LINES)
    run.lines.splice(0, run.lines.length - MAX_LINES);
}
