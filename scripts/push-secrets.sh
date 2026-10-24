#!/usr/bin/env bash
# Copies every non-empty entry of .env into the GitHub repo's Actions settings:
# region/timezone flags become Variables, everything else becomes Secrets.
# Values are piped straight to gh and never printed.
set -euo pipefail

env_file="${1:-.env}"
variables=" GARMIN_CN COROS_CN LIFELOG_TZ VITE_BASE "
skip=" GH_USERNAME GARMIN_EMAIL GARMIN_PASSWORD " # username comes from the repo owner; passwords never leave this machine

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%% #*}"                     # inline comment
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']$//")"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  [[ -z "$value" || "$skip" == *" $key "* ]] && continue
  if [[ "$variables" == *" $key "* ]]; then
    gh variable set "$key" --body "$value" >/dev/null
    echo "variable  $key"
  else
    printf '%s' "$value" | gh secret set "$key" >/dev/null
    echo "secret    $key"
  fi
done < "$env_file"
