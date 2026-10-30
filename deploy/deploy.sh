#!/usr/bin/env bash
# Run from your machine (needs ssh access to the VPS as root or a sudo user).
#
#   deploy/deploy.sh setup   <ssh-host> <domain> [email]   # once: Caddy, HTTPS, PostgreSQL, user, service, firewall
#   deploy/deploy.sh release <ssh-host> [--with-env] [--import-data]
#
# release cross-compiles the Go binary for the server's CPU, builds the site and
# the admin page for the domain root, uploads both and restarts `lifelog serve`.
# Re-run after code changes.
#   --with-env     copies the settings in the local .env into the server's database
#                  (overwriting what the admin page has for those keys)
#   --import-data  loads the repo's data/*.json into the database: once, when moving
#                  from the JSON files; afterwards the database is the source of truth
set -euo pipefail
cd "$(dirname "$0")/.."

CMD="${1:-}"
HOST="${2:?usage: deploy.sh setup|release <ssh-host> ...}"

# root logins on minimal images often have no sudo
if [[ "$(ssh "$HOST" id -u)" == "0" ]]; then
  SUDO=""; RSYNC_PATH="rsync"; AS_LIFELOG="runuser -u lifelog --"
else
  SUDO="sudo"; RSYNC_PATH="sudo rsync"; AS_LIFELOG="sudo -u lifelog"
fi
remote() { ssh "$HOST" "$SUDO bash -c '$*'"; }

case "$CMD" in
setup)
  DOMAIN="${3:?usage: deploy.sh setup <ssh-host> <domain> [email]}"
  EMAIL="${4:-}"
  ssh "$HOST" "command -v rsync >/dev/null || ($SUDO apt-get update -qq && $SUDO apt-get install -y -qq rsync >/dev/null)"
  rsync -az --delete deploy/ "$HOST":/tmp/lifelog-deploy/
  ssh "$HOST" "cd /tmp/lifelog-deploy && $SUDO bash install.sh '$DOMAIN' '$EMAIL'"
  ;;

release)
  WITH_ENV=""; IMPORT_DATA=""
  for arg in "${@:3}"; do
    case "$arg" in
      --with-env) WITH_ENV=1 ;;
      --import-data) IMPORT_DATA=1 ;;
      *) echo "unknown option $arg" >&2; exit 2 ;;
    esac
  done
  case "$(ssh "$HOST" uname -m)" in
    x86_64) GOARCH=amd64 ;;
    aarch64 | arm64) GOARCH=arm64 ;;
    *) echo "unsupported server CPU" >&2; exit 1 ;;
  esac
  echo "==> build (linux/$GOARCH)"
  mkdir -p build
  GOOS=linux GOARCH=$GOARCH CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o build/lifelog ./cmd/lifelog
  # served at the domain root; the Mapbox token is set in the admin page (data.json carries it)
  (cd web && VITE_BASE=/ npm run build --silent)

  echo "==> upload"
  rsync -az --delete --exclude 'data.json*' --exclude 'routes.enc' --exclude .next --rsync-path="$RSYNC_PATH" web/dist/ "$HOST":/opt/lifelog/www/
  rsync -az --rsync-path="$RSYNC_PATH" build/lifelog deploy/compress.sh "$HOST":/opt/lifelog/bin/
  remote "install -d -o lifelog -g lifelog /opt/lifelog/www/.next && chown -R lifelog:lifelog /opt/lifelog/www /opt/lifelog/bin && chmod 755 /opt/lifelog/bin/*"
  echo "==> precompress site files"
  ssh "$HOST" "$AS_LIFELOG /opt/lifelog/bin/compress.sh --site /opt/lifelog/www/assets && $AS_LIFELOG /opt/lifelog/bin/compress.sh /opt/lifelog/www/index.html /opt/lifelog/www/admin/index.html"

  if [[ -n "$WITH_ENV" ]]; then
    echo "==> settings from .env -> database"
    # API tokens only (no login passwords or phone numbers), through a file only lifelog can read
    grep -E '^[A-Z_][A-Z0-9_]*=[^ #]' .env | grep -vE '^(GARMIN_EMAIL|GARMIN_PASSWORD|JOYRUN_PHONE|DATABASE_URL|LIFELOG_ADMIN_PASSWORD)=' |
      ssh "$HOST" "$SUDO install -m 600 -o lifelog -g lifelog /dev/stdin /opt/lifelog/settings.env"
    ssh "$HOST" "cd /opt/lifelog/repo && $AS_LIFELOG /opt/lifelog/bin/lifelog db import -dir '' -env /opt/lifelog/settings.env; $SUDO rm -f /opt/lifelog/settings.env"
  fi
  if [[ -n "$IMPORT_DATA" ]]; then
    echo "==> data/*.json -> database"
    ssh "$HOST" "cd /opt/lifelog/repo && $AS_LIFELOG git pull -q --rebase --autostash && $AS_LIFELOG /opt/lifelog/bin/lifelog db import -dir data"
  fi

  echo "==> restart lifelog serve"
  remote "systemctl restart lifelog.service; sleep 2; systemctl is-active lifelog.service; journalctl -u lifelog.service -n 10 --no-pager"
  ;;

*)
  echo "usage: deploy.sh setup <ssh-host> <domain> [email] | release <ssh-host> [--with-env] [--import-data]" >&2
  exit 2
  ;;
esac
