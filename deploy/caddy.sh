#!/usr/bin/env bash
# Run on the server as root: writes /etc/caddy/Caddyfile from the template next
# to this script for DOMAIN, keeps every other site already in the file (such
# as bot.mdyrbz.com, added by the Bot Hub deploy), validates and reloads Caddy.
# On a failed validation the previous file is restored.
#
#   caddy.sh DOMAIN [EMAIL]
set -euo pipefail
DOMAIN="${1:?usage: caddy.sh DOMAIN [EMAIL]}"
EMAIL="${2:-}"
TEMPLATE="$(dirname "$0")/Caddyfile"
CONF=/etc/caddy/Caddyfile
NEW=$(mktemp)

if [[ -n "$EMAIL" ]]; then
  sed -e "s/{{DOMAIN}}/$DOMAIN/g" -e "s/{{EMAIL}}/$EMAIL/g" "$TEMPLATE" > "$NEW"
else
  # an ACME account works without a contact address; Caddy renews either way
  sed -e "s/{{DOMAIN}}/$DOMAIN/g" -e "/email {{EMAIL}}/d" "$TEMPLATE" > "$NEW"
fi

# top-level site blocks of the current file other than the global options,
# DOMAIN and www.DOMAIN
if [[ -f "$CONF" ]]; then
  awk -v d="$DOMAIN" '
    depth == 0 && /\{[[:space:]]*$/ {
      head = $0; sub(/[[:space:]]*\{[[:space:]]*$/, "", head); gsub(/^[[:space:]]+/, "", head)
      keep = head != "" && head != d && head != "www." d
      block = ""
    }
    {
      if (depth > 0 || /\{[[:space:]]*$/) block = block $0 "\n"
      n = gsub(/\{/, "{"); m = gsub(/\}/, "}"); depth += n - m
      if (depth == 0 && block != "") { if (keep) printf "\n%s", block; block = ""; keep = 0 }
    }
  ' "$CONF" >> "$NEW"
  cp "$CONF" "$CONF.bak"
fi

install -m 644 "$NEW" "$CONF"
rm -f "$NEW"
if ! caddy validate --config "$CONF" --adapter caddyfile >/dev/null 2>&1; then
  caddy validate --config "$CONF" --adapter caddyfile 2>&1 | tail -5 >&2
  [[ -f "$CONF.bak" ]] && cp "$CONF.bak" "$CONF"
  echo "Caddy config invalid; restored the previous one" >&2
  exit 1
fi
systemctl enable --now caddy >/dev/null
systemctl reload caddy
echo "caddy: $DOMAIN (+ $(grep -cE '^[^#[:space:]].*\{$' "$CONF") site blocks in total)"
