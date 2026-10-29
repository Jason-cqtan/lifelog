#!/usr/bin/env bash
# Daily (08:00) job on the VPS (lifelog-sync.timer): pull, sync every source, export
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

# export, write the compressed copies, then swap everything in
mkdir -p "$HOME_DIR/www/.next"
"$HOME_DIR/bin/lifelog" export -out "$HOME_DIR/www/.next/data.json" && {
  "$HOME_DIR/bin/compress.sh" "$HOME_DIR/www/.next/data.json"
  # the sealed routes first: a data.json must never point at routes it can't open
  if [[ -f "$HOME_DIR/www/.next/routes.enc" ]]; then
    mv -f "$HOME_DIR/www/.next/routes.enc" "$HOME_DIR/www/routes.enc"
  else
    rm -f "$HOME_DIR/www/routes.enc"
  fi
  for ext in .br .zst .gz ""; do mv -f "$HOME_DIR/www/.next/data.json$ext" "$HOME_DIR/www/data.json$ext"; done
}

git add data
if ! git diff --cached --quiet; then
  git commit -q -m "sync: $(date -u +%Y-%m-%dT%H:%MZ) (vps)"
  # someone else may have pushed meanwhile; data files are keyed records, so a rebase almost always applies
  git push -q || { git pull -q --rebase && git push -q; } || echo "git push failed"
fi

exit $sync_status
