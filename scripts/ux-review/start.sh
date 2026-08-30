#!/usr/bin/env bash
#
# Sprint 28.5F - Human acceptance (UX review) launcher. Emulator only.
#
# One command to build the app, start the local Firebase emulators, and
# seed the deterministic UX review dataset. Leaves the emulators running in
# the foreground so the reviewer can click through the local site. Press
# Ctrl+C to stop everything cleanly.
#
# This touches nothing outside the local machine: no production Firebase, no
# deploy, no Google Classroom, no OAuth. See
# docs/platform/SPRINT_28_5_HUMAN_ACCEPTANCE_WALKTHROUGH.md.

set -euo pipefail

# Resolve the repository root from this script's location so the command
# works regardless of the current directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIREBASE_DIR="$REPO/platform/firebase"
FIREBASE_BIN="$FIREBASE_DIR/node_modules/.bin/firebase"

echo "==> LyfeLabz UX review environment"
echo "    Repo: $REPO"

if [ ! -x "$FIREBASE_BIN" ]; then
  echo "ERROR: local firebase CLI not found at $FIREBASE_BIN" >&2
  echo "       Run: npm --prefix platform/firebase install" >&2
  exit 1
fi

# Refuse to start on top of an already-running emulator so we never seed a
# surprise state. The reviewer should stop the old one first (Ctrl+C in its
# window, or: bash scripts/ux-review/stop.sh).
for PORT in 8080 9099 5001 5000; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: port $PORT is already in use (an emulator is probably still running)." >&2
    echo "       Stop it first:  bash scripts/ux-review/stop.sh" >&2
    exit 1
  fi
done

echo "==> Building Cloud Functions (needed for callables + the seed)"
npm --prefix "$REPO/platform/functions" run build

echo "==> Building the authenticated app bundle + assessment runtime"
npm --prefix "$REPO/app" run build
npm --prefix "$REPO/app" run build:runtime

echo "==> Starting Firebase emulators (auth, firestore, functions, hosting)"
cd "$FIREBASE_DIR"
"$FIREBASE_BIN" emulators:start \
  --project lyfelabz-prod \
  --only auth,firestore,functions,hosting &
EMU_PID=$!

# Ensure the emulators are torn down when this script exits for any reason.
cleanup() {
  echo ""
  echo "==> Stopping emulators"
  kill "$EMU_PID" >/dev/null 2>&1 || true
  wait "$EMU_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "==> Waiting for the Auth and Firestore emulators to come up"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:8080/" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:9099/" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "${READY:-0}" != "1" ]; then
  echo "ERROR: emulators did not become ready in time." >&2
  exit 1
fi

echo "==> Seeding the deterministic UX review dataset"
node "$REPO/platform/functions/ux-review-seed.js"

echo ""
echo "============================================================"
echo "  LyfeLabz UX review environment is READY."
echo ""
echo "  Open:        http://127.0.0.1:5000/app/"
echo "  Sign in:     Continue with Google -> UX Review Teacher"
echo "               (later: UX Review Student)"
echo "  Emulator UI: http://127.0.0.1:4000/"
echo ""
echo "  Walkthrough: docs/platform/SPRINT_28_5_HUMAN_ACCEPTANCE_WALKTHROUGH.md"
echo ""
echo "  Press Ctrl+C in this window to stop everything."
echo "============================================================"
echo ""

# Keep the emulators in the foreground until the reviewer stops them.
wait "$EMU_PID"
