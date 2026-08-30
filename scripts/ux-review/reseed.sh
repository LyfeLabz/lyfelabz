#!/usr/bin/env bash
#
# Sprint 28.5F - Re-seed the UX review dataset against ALREADY-RUNNING
# emulators, without restarting them. Because every write in
# ux-review-seed.js uses a fixed document id (full overwrite) and every
# Auth user is delete-then-import, this restores the exact original
# dataset: any state the reviewer changed by hand (a closed assignment, a
# freshly-added late recipient, a completed live attempt on what-is-life)
# is reset to the seeded baseline.
#
# Use this when you want a clean slate but do not want to wait for a full
# rebuild + restart. If the emulators are NOT running, use
# scripts/ux-review/start.sh instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

if ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: the Firestore emulator (port 8080) is not running." >&2
  echo "       Start the environment first:  bash scripts/ux-review/start.sh" >&2
  exit 1
fi

echo "==> Re-seeding the UX review dataset (fixed ids; full overwrite)"
node "$REPO/platform/functions/ux-review-seed.js"
echo "==> Done. The dataset is back to its seeded baseline."
