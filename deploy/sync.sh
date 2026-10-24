#!/usr/bin/env bash
# Hourly job on the VPS (lifelog-sync.timer): pull, sync every source, export
# the site's data.json, and push the data back to GitHub so GitHub Pages stays
# in step. A failing source doesn't stop the rest (same as the Actions job).
set -uo pipefail

HOME_DIR="${LIFELOG_HOME:-/opt/lifelog}"
REPO="$HOME_DIR/repo"
cd "$REPO" || exit 1
# lifelog reads ./.env itself (comments allowed); .env is gitignored
ln -sf "$HOME_DIR/.env" "$REPO/.env"

git pull -q --rebase --autostash || { echo "git pull failed"; exit 1; }

"$HOME_DIR/bin/lifelog" sync
sync_status=$?

"$HOME_DIR/bin/lifelog" export -out "$HOME_DIR/www/data.json.tmp" &&
  mv "$HOME_DIR/www/data.json.tmp" "$HOME_DIR/www/data.json"

git add data
if ! git diff --cached --quiet; then
  git commit -q -m "sync: $(date -u +%Y-%m-%dT%H:%MZ) (vps)"
  # someone else may have pushed meanwhile; data files are keyed records, so a rebase almost always applies
  git push -q || { git pull -q --rebase && git push -q; } || echo "git push failed"
fi

exit $sync_status
