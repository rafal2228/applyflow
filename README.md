# ApplyFlow

A self-contained control room for your job search: **find** roles, **grade**
them A–F, **tailor** your CV and cover letters, and **manage** it all on a
Kanban board.

The stack is deliberately small: **Next.js (App Router) + React + TypeScript +
Tailwind**, UI built from **shadcn/ui on Base UI**, storage in a local
**SQLite** file (via the built-in `node:sqlite`), and any **OpenAI-compatible**
LLM endpoint for grading and tailoring.

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

## Features

### Find jobs
- Discover from 8 sources — Remotive, RemoteOK, We Work Remotely, Hacker News,
  justjoin.it, NoFluffJobs, Adzuna (optional keys), and company ATS boards
  (Greenhouse/Lever/Ashby) — and choose which ones to run.
- One-click **Daily run** (discover → expire → digest), **Expire stale**,
  **Market snapshot**, and **Write digest**, each with a live log console.

### Grade
- **Grade new (n)** schedules **every** ungraded offer and works through them in
  the background. The header shows live progress (done/total, remaining, current
  job) plus **Pause/Resume**; per-card grading is still one click.
- Grades run A–F with a reason, pros and cons, judged against your CV and brief.
  A good grade promotes an offer from `new` to `shortlisted` automatically.

### Tailor
- From any card, **Tailor** generates a job-specific CV and cover letter (EN/PL),
  grounded only in your `profile/CV.md` and `profile/BRIEF.md`. Artifacts are
  saved under `applications/<slug>/` and viewable in the drawer.
- **Dedicated cover letter** — write a focused cover letter on demand, edit it by
  hand, and copy it in one click. It is **persisted on the offer** (not a file),
  autosaves as you type, and can be regenerated anytime. See
  [`docs/cover-letter.md`](docs/cover-letter.md).

### Manage
- **Kanban pipeline** — `Inbox · Shortlisted · Applied · Interview · Offer`, plus
  an always-visible **Backlog** column for `Rejected · Skipped · Expired`. Drag a
  card into the Backlog (or set the status in the drawer), then **Restore** it
  later to send it back to `Shortlisted`.
- **Drag & drop** cards between columns; moving to **Applied** sets a +7-day
  follow-up.
- **Add offers** by pasting a posting URL (parsed automatically from Greenhouse/
  Lever APIs, schema.org JSON-LD, or OpenGraph) or by entering them manually. The
  **loaded-from URL is saved** so you can reopen the posting, and every field
  stays editable before and after saving.
- **Digests** are a first-class in-app view at `/digests` with history: generate
  today's, browse past days, and read the shortlist and market summary rendered
  as markdown.
- **Duplicate review** — cross-posted roles are fingerprinted as they are
  ingested (MinHash + LSH bands + SimHash mask) and queued for review instead of
  being silently dropped. A local
  [Laya](https://huggingface.co/convaiinnovations/laya) decision model judges
  each candidate pair on request; you confirm or keep both. See
  [Duplicate review](#duplicate-review).
- Per-job notes and a live market table (Poland vs global remote).

## Setup

ApplyFlow requires **Node ≥ 24** (for the built-in `node:sqlite`). The database
and all output folders are created automatically on first run.

```bash
git clone <this repo> && cd applyflow
cp .env.example .env.local        # fill in OPENAI_* to enable grading/tailoring
npm install
npm run dev                       # http://localhost:3000
```

To use the local duplicate-decision engine you also need
[`uv`](https://docs.astral.sh/uv/); it provisions Python ≥ 3.10 and Laya's
dependencies for you, so no system Python is required:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # install uv
npm run laya:serve                                # http://0.0.0.0:8000
# in another terminal (or after starting it once):
#   echo 'LAYA_BASE_URL=http://127.0.0.1:8000' >> .env.local
```

`npm run laya:serve` runs `uv run --project laya laya-serve`; `uv` creates
`laya/.venv`, installs `laya[serve]`, and downloads the model checkpoint on
first use. Duplicate review works without it: fingerprints are still queued, and
the LLM fallback is used if `OPENAI_*` is set.

### Profile

Grading and tailoring read your CV and targeting brief from `profile/`:

- `profile/CV.md` — your CV.
- `profile/BRIEF.md` — target roles, remote/comp preferences, dealbreakers.

Example templates (`profile/CV.example.md`, `profile/BRIEF.example.md`) are
committed; the real files are gitignored so your personal data stays local.

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
| `LAYA_BASE_URL` | — | Local Laya server for duplicate decisions (see below). |
| `LAYA_API_KEY` | — | Optional bearer token for `laya-serve`. |
| `DUPLICATE_THRESHOLD` | `0.5` | Min fingerprint similarity to queue a pair. |
| `DUPLICATE_ACCEPT_CONFIDENCE` | `0.8` | Min AI confidence for “Accept all”. |

The LLM client only assumes a standard `POST {base}/chat/completions` API — it is
**not tied to any specific vendor or backend**.

### Duplicate review

The same role is routinely cross-posted across boards with different titles and
company spellings, so an exact key is not enough.

1. **Fingerprint** — on ingest, each offer is normalised and reduced to a MinHash
   signature, LSH bands, and a SimHash mask (title/company/location/tags).
2. **Narrow** — only offers that collide on an LSH band become *candidates*; a
   similarity threshold and a company-name gate trim them down. Nothing is
   auto-dropped — candidates are queued with both offers flagged.
3. **Decide** — *Duplicates → AI scan* asks the local Laya model whether a pair is
   the same role (falling back to `OPENAI_*` if Laya is not configured).
4. **Review** — a human clicks **Mark duplicate** (archives the newer offer and
   links it) or **Keep both**. Pending pairs appear in the digest too.
5. **Bulk accept** — *Duplicates* offers **Accept same (N)** for pairs the engine
   judged the same role at or above `DUPLICATE_ACCEPT_CONFIDENCE` (default
   **80%**) and **Dismiss different (M)** for high-confidence negative verdicts;
   each action has a confirm step.

Start the local decision server with [`uv`](https://docs.astral.sh/uv/) (it
provisions Python and the environment itself):

```bash
npm run laya:serve                 # uv run --project laya laya-serve
# then set LAYA_BASE_URL=http://127.0.0.1:8000 in .env.local
```

Laya is a non-autoregressive decision model — fast and free to self-host, but not
generative, so grading and digests still use the OpenAI-compatible endpoint. See
[`laya/README.md`](laya/README.md).

## Development

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:` …). A **commitlint** `commit-msg`
hook (via Husky) validates every message, and the hook is installed automatically
by `npm install` through the `prepare` script.

```bash
npm run typecheck            # tsc --noEmit
echo "feat: x" | npm run lint:commit   # validate a message manually
```

## Tuning discovery

Edit `lib/config.ts` to change target titles, stack keywords, exclusions, Adzuna
queries, and market keywords. Add companies to `lib/sources/ats-companies.ts`,
or drop a `seed-companies.json` array next to it to extend the ATS board list.
