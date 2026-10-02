import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { truncate } from "./util";
import { PROFILE_DIR } from "./paths";

function safeRead(path: string, max = 12000): string {
  try {
    return truncate(readFileSync(path, "utf8"), max);
  } catch {
    return "";
  }
}

let _cache: string | null = null;

/**
 * Candidate context for grading/tailoring: this repo's own CV + targeting brief
 * (profile/CV.md and profile/BRIEF.md by default).
 */
export function candidateContext(): string {
  if (_cache) return _cache;
  const cvPath = resolve(
    process.env.CV_PATH?.trim() || resolve(PROFILE_DIR, "CV.md"),
  );
  const briefPath = resolve(
    process.env.BRIEF_PATH?.trim() || resolve(PROFILE_DIR, "BRIEF.md"),
  );

  const cv = safeRead(cvPath, 14000);
  const brief = safeRead(briefPath, 6000);

  const parts: string[] = [];
  if (cv) parts.push(`## CANDIDATE CV\n${cv}`);
  if (brief) parts.push(`## CANDIDATE PREFERENCES (brief — authoritative)\n${brief}`);
  if (!parts.length)
    parts.push(
      "(No profile/CV.md or profile/BRIEF.md found — grading with title/description only.)",
    );
  _cache = parts.join("\n\n");
  return _cache;
}
