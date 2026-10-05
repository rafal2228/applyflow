# Local Laya decision server

ApplyFlow uses [Laya](https://huggingface.co/convaiinnovations/laya) — a
non-autoregressive "System 1" decision model — to judge whether two offers are
the same role. It is a tiny, fast, on-prem, Apache-2.0 model, so duplicate
finding costs nothing in API calls and never leaves your machine.

Laya is not a generative model: it answers typed questions with calibrated
probabilities and cannot write text. ApplyFlow therefore uses it only for the
duplicate decision (`same role?`) and keeps generative grading/digesting on your
existing OpenAI-compatible endpoint.

## Requirements

- [`uv`](https://docs.astral.sh/uv/) — install with:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- That's it. `uv` provisions Python (≥ 3.10) and the dependencies for you, so a
  system Python install is not needed. The English checkpoint (~808 MB) is
  downloaded on first use.

## Start it

From the repo root:

```bash
npm run laya:serve
```

Or run `uv` directly:

```bash
uv run --project laya laya-serve           # http://0.0.0.0:8000
LAYA_DEVICE=cuda uv run --project laya laya-serve
```

`uv run` creates `laya/.venv`, installs `laya[serve]` from
[`laya/pyproject.toml`](pyproject.toml) and starts the server. `laya-serve`
exposes `POST /v1/systemone` — the same request/response shape the Jev API
uses. ApplyFlow posts to `{LAYA_BASE_URL}/v1/systemone`.

## Point ApplyFlow at it

In `.env.local`:

```bash
LAYA_BASE_URL=http://127.0.0.1:8000
# LAYA_API_KEY=            # only if you started laya-serve with this set
```

Leave `LAYA_BASE_URL` unset to have ApplyFlow fall back to `OPENAI_*` for
duplicate decisions. With neither configured, candidate pairs are still found by
fingerprint and queued for manual review.

## GPU

```bash
LAYA_DEVICE=cuda npm run laya:serve
```

On Apple Silicon Laya runs on the CPU or via MPS depending on the build; the CPU
path is typically a couple of hundred milliseconds per decision, which is plenty
for an on-demand duplicate scan.

## Managing the environment

```bash
uv sync --project laya        # (re)create .venv from pyproject.toml
uv lock --project laya        # refresh the lockfile after changing deps
```
