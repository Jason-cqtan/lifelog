#!/usr/bin/env bash
# Writes max-strength .br / .zst / .gz copies next to each file for Caddy's
# `precompressed` file server: on the slow route to mainland China every byte
# counts, and Caddy's on-the-fly compression uses fast, weaker levels.
#
#   compress.sh FILE...        # or: compress.sh --site DIR (all js/css/html/json/svg)
set -euo pipefail

if [[ "${1:-}" == "--site" ]]; then
  mapfile -t files < <(find "$2" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' \))
else
  files=("$@")
fi

for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  # write all three before swapping any in, so a reader never mixes versions for long
  brotli -q 11 -f -o "$f.br.tmp" "$f"
  zstd -19 -q -f -o "$f.zst.tmp" "$f"
  gzip -9 -c "$f" > "$f.gz.tmp"
  mv -f "$f.br.tmp" "$f.br"
  mv -f "$f.zst.tmp" "$f.zst"
  mv -f "$f.gz.tmp" "$f.gz"
done
