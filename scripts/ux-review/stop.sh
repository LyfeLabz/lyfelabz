#!/usr/bin/env bash
#
# Sprint 28.5F - Stop any lingering LyfeLabz UX review emulators.
#
# Normally you stop the environment by pressing Ctrl+C in the window where
# scripts/ux-review/start.sh is running. Use this helper only if that
# window was closed and the emulator ports are still held.

set -euo pipefail

echo "==> Stopping Firebase emulators"

# Free any emulator port still held by a stray process. The emulators have
# no clean "kill" subcommand, so stopping by port is the reliable path when
# the launcher window is already gone.
for PORT in 4000 4400 5000 5001 8080 9099 9199; do
  PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "    freeing port $PORT (pid $PIDS)"
    kill $PIDS >/dev/null 2>&1 || true
  fi
done

echo "==> Done."
