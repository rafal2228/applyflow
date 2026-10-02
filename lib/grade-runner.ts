import { getJob, saveRank, ungradedJobs } from "./db";
import { gradeJob } from "./grader";
import { nowIso } from "./util";
import type { GradeRunState } from "./types";

/**
 * Background grading queue. Schedules *all* currently-ungraded jobs and works
 * through them one at a time, with pause/resume. State lives on globalThis so
 * the start/pause/resume and poll routes share it.
 */
interface Store {
  ids: string[];
  index: number;
  running: boolean;
  paused: boolean;
  generation: number;
  startedAt: string | null;
  finishedAt: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  lastGrade: string | null;
  errors: { id: string; error: string }[];
}

const g = globalThis as unknown as { __applyflowGrade?: Store };

function store(): Store {
  if (!g.__applyflowGrade) {
    g.__applyflowGrade = {
      ids: [],
      index: 0,
      running: false,
      paused: false,
      generation: 0,
      startedAt: null,
      finishedAt: null,
      currentTitle: null,
      currentCompany: null,
      lastGrade: null,
      errors: [],
    };
  }
  return g.__applyflowGrade;
}

export function getGradeRun(): GradeRunState {
  const s = store();
  return {
    total: s.ids.length,
    done: s.index,
    failed: s.errors.length,
    remaining: Math.max(0, s.ids.length - s.index),
    running: s.running,
    paused: s.paused,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    currentTitle: s.currentTitle,
    currentCompany: s.currentCompany,
    lastGrade: s.lastGrade,
    errors: s.errors.slice(-20),
  };
}

/** Queue every currently-ungraded job and start processing. */
export function startGradeRun(): GradeRunState {
  const s = store();
  const jobs = ungradedJobs(1_000_000);
  s.ids = jobs.map((j) => j.id);
  s.index = 0;
  s.running = true;
  s.paused = false;
  s.startedAt = nowIso();
  s.finishedAt = null;
  s.currentTitle = null;
  s.currentCompany = null;
  s.lastGrade = null;
  s.errors = [];
  s.generation++;
  void runLoop(s, s.generation);
  return getGradeRun();
}

export function pauseGradeRun(): GradeRunState {
  const s = store();
  if (s.running) s.paused = true;
  return getGradeRun();
}

export function resumeGradeRun(): GradeRunState {
  const s = store();
  if (s.running && s.paused) {
    s.paused = false;
    s.generation++;
    void runLoop(s, s.generation);
  }
  return getGradeRun();
}

async function runLoop(s: Store, gen: number): Promise<void> {
  while (
    s.running &&
    !s.paused &&
    s.generation === gen &&
    s.index < s.ids.length
  ) {
    const id = s.ids[s.index];
    const job = getJob(id);
    if (!job || job.grade) {
      s.index++;
      continue;
    }
    s.currentTitle = job.title;
    s.currentCompany = job.company;
    try {
      const result = await gradeJob(job);
      saveRank(job.id, result);
      s.lastGrade = result.grade;
    } catch (e) {
      s.errors.push({ id, error: (e as Error).message });
    }
    s.index++;
  }

  if (s.generation !== gen) return; // superseded by a newer run/resume

  s.currentTitle = null;
  s.currentCompany = null;
  if (s.index >= s.ids.length) {
    s.running = false;
    s.paused = false;
    s.finishedAt = nowIso();
  }
}
