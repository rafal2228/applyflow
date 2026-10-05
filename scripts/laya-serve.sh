#!/usr/bin/env bash
# Start the local Laya decision server for ApplyFlow's duplicate review.
#
# Uses `uv` (https://docs.astral.sh/uv/) to manage Python and the Laya
# environment. If `uv` cannot find a suitable interpreter it will download a
# Python >= 3.10 automatically — no system-Python setup required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it with:" >&2
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  echo "then re-run: npm run laya:serve" >&2
  exit 1
fi

export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"
export LAYA_PRELOAD="${LAYA_PRELOAD:-1}"

echo "Starting laya-serve (device=$LAYA_DEVICE, preload=$LAYA_PRELOAD) on 0.0.0.0:8000…" >&2
exec uv run --project "$ROOT/laya" laya-serve
