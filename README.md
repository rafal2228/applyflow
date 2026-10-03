# ApplyFlow

The friendly control room for your job search: a **Kanban board** plus
**finding, grading, tailoring and managing** — all in one self-contained app.

Clean stack: **Next.js (App Router) + React + TypeScript + Tailwind**, UI built
from **shadcn/ui on Base UI**, storage in a local **SQLite** file (built-in
`node:sqlite`), and any **OpenAI-compatible** LLM endpoint for grading/tailoring.

```
┌──────────────────────────── ApplyFlow ─────────────────────────────┐
│  Find: discover from 8 sources   Grade: A–F   Tailor: CV + letter  │
│  Manage: Kanban · notes · URL import · digests · market             │
└───────────────────────────────┬────────────────────────────────────┘
                                │ node:sqlite
                                ▼
                         data/jobs.db (local)
```

Everything lives inside this repo — no other project or service is required.

## What you can do

**Find jobs**
- Run discovery from 8 sources — Remotive, RemoteOK, We Work Remotely, Hacker
  News, justjoin.it, NoFluffJobs, Adzuna (optional keys), and company ATS boards
  (Greenhouse/Lever/Ashby) — and pick which ones to run.
- One-click **Daily run** (discover → expire → digest), **Expire stale**,
  **Market snapshot**, **Write digest**, with a live log console.

**Grade**
- **Grade new (n)** schedules **every** ungraded offer and works through them in
  the background — the header shows live progress (done/total, remaining, current
  job) plus **Pause/Resume**. Per-card grading is still one click.
- Grades are A–F with a reason, pros & cons, against your CV + brief; grading
  promotes `new → shortlisted` automatically.

**Tailor**
- From any card: **Tailor** generates a job-specific CV + cover letter (EN/PL),
  grounded only in your `profile/CV.md` + `profile/BRIEF.md`. Artifacts are saved
  under `applications/<slug>/` and viewable in the drawer.
- **Dedicated cover letter** — write a focused cover letter on demand, edit it by
  hand, and copy it in one click. It's **persisted on the offer** (not a file),
  autosaves as you type, and can be regenerated anytime. See
  [`docs/cover-letter.md`](docs/cover-letter.md).

**Manage**
- **Kanban pipeline** — `Inbox · Shortlisted · Applied · Interview · Offer`, plus
  an always-visible **Backlog** column that collects `Rejected · Skipped ·
  Expired` offers. Drag a card into the Backlog (or set the status in the drawer),
  then **Restore** it later and it returns to `Shortlisted`.
- **Drag & drop** cards between columns; moving to **Applied** sets a +7-day
  follow-up.
- **Add offers** by pasting a posting URL (parsed automatically from Greenhouse/
  Lever APIs, schema.org JSON-LD or OpenGraph) or by entering them manually. The
  **loaded-from URL is saved** so you can reopen the posting, and every field stays
  editable before and after saving.
- **Digests** are a first-class in-app view at `/digests` with history: generate
  today's, browse past days, and read the shortlist + market summary rendered as
  markdown.
- Per-job notes and a live market table (Poland vs global remote).

## Setup

```bash
cp .env.example .env.local        # fill in OPENAI_* to enable grading/tailoring
npm install
npm run dev                       # http://localhost:3000
```

Requires **Node ≥ 24** (for the built-in `node:sqlite`). The database and all
output folders are created automatically on first run.

### Profile

Grading and tailoring read your CV and targeting brief from `profile/`:

- `profile/CV.md` — your CV.
- `profile/BRIEF.md` — target roles, remote/comp preferences, dealbreakers.

Copies of the example templates (`profile/CV.example.md`,
`profile/BRIEF.example.md`) are committed; the real files are gitignored so your
personal data stays local.

### Configuration (`.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `JOBS_DB_PATH` | `data/jobs.db` | Local SQLite database. |
| `CV_PATH` | `profile/CV.md` | CV used as grading/tailoring context. |
| `BRIEF_PATH` | `profile/BRIEF.md` | Targeting preferences (authoritative). |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | — | Optional; enable the Adzuna source. |
| `MONITOR_KEYWORDS` | sensible defaults | Comma-separated market keywords. |
| `DIGEST_MIN_GRADE` | `B` | Minimum grade shown in the digest. |
| `OPENAI_BASE_URL` | — | Base URL of any OpenAI-compatible endpoint. |
| `OPENAI_API_KEY` | — | Bearer token for that endpoint. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model id sent to the endpoint. |

The LLM client only assumes a standard `POST {base}/chat/completions` API — it is
**not tied to any specific vendor or backend**.

## Development

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:` …). A **commitlint** `commit-msg`
hook (via Husky) validates every message; the hook is installed automatically by
`npm install` through the `prepare` script.

```bash
npm run typecheck            # tsc --noEmit
echo "feat: x" | npm run lint:commit   # validate a message manually
```

## Tuning discovery

Edit `lib/config.ts` to change target titles, stack keywords, exclusions, Adzuna
queries and market keywords. Add companies to `lib/sources/ats-companies.ts`, or
drop a `seed-companies.json` array next to it to extend the ATS board list.
