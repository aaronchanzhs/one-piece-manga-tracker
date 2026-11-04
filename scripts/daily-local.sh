#!/bin/bash
# Daily price update run from your own computer, then pushed to GitHub.
#
# Why this exists: Yuyu-tei blocks GitHub's servers (HTTP 403), so the GitHub
# Actions run can only refresh English prices. Running here, from a home
# connection, refreshes Japanese prices too. The push redeploys the site.
#
# Run by hand:   scripts/daily-local.sh
# Scheduled by:  ~/Library/LaunchAgents/com.onepiece.manga-tracker.plist (see README)

set -euo pipefail
cd "$(dirname "$0")/.."

NODE="${NODE:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  echo "node not found; set NODE=/path/to/node" >&2
  exit 1
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z') ==="

# Pick up the GitHub bot's commits first so the push never conflicts.
git pull --rebase --autostash -q

"$NODE" scripts/update.mjs

git add public/data
if git diff --cached --quiet; then
  echo "No price changes to commit."
else
  git commit -q -m "Update prices $(date -u +%F) (local)"
  git push -q
  echo "Pushed $(git rev-parse --short HEAD)."
fi
