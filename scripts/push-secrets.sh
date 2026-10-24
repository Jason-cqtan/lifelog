#!/usr/bin/env bash
# Copies every non-empty entry of .env into the GitHub repo's Actions settings:
# region/timezone flags become Variables, everything else becomes Secrets.
# Values are piped straight to gh and never printed.
set -euo pipefail

env_file="${1:-.env}"
variables=" GARMIN_CN COROS_CN LIFELOG_TZ VITE_BASE VITE_MAPBOX_TOKEN VITE_MAP_GCJ02 "
skip=" GH_USERNAME GARMIN_EMAIL GARMIN_PASSWORD " # username comes from the repo owner; passwords never leave this machine

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%% #*}"                     # inline comment
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']$//")"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  [[ -z "$value" || "$skip" == *" $key "* ]] && continue
  if [[ "$key" == VITE_MAPBOX_TOKEN && "$value" == sk.* ]]; then
    echo "refusing VITE_MAPBOX_TOKEN: it is a secret sk.* token and would be public in the page; use a pk.* token" >&2
    continue
  fi
  if [[ "$variables" == *" $key "* ]]; then
    gh variable set "$key" --body "$value" >/dev/null
    echo "variable  $key"
  else
    printf '%s' "$value" | gh secret set "$key" >/dev/null
    echo "secret    $key"
  fi
done < "$env_file"
