#!/usr/bin/env bash
# Run from your machine (needs ssh access to the VPS as root or a sudo user).
#
#   deploy/deploy.sh setup   <ssh-host> <domain> [email]   # once: Caddy, HTTPS, user, timer, firewall
#   deploy/deploy.sh release <ssh-host> [--with-env]       # build + upload; --with-env also copies .env
#
# release cross-compiles the Go binary for the server's CPU, builds the site for
# the domain root and uploads both, then runs one sync. Re-run after code changes.
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
  WITH_ENV="${3:-}"
  case "$(ssh "$HOST" uname -m)" in
    x86_64) GOARCH=amd64 ;;
    aarch64 | arm64) GOARCH=arm64 ;;
    *) echo "unsupported server CPU" >&2; exit 1 ;;
  esac
  echo "==> build (linux/$GOARCH)"
  mkdir -p build
  GOOS=linux GOARCH=$GOARCH CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o build/lifelog ./cmd/lifelog
  # served at the domain root; the Mapbox token comes from the local .env (VITE_* only)
  (cd web && VITE_BASE=/ npm run build --silent)

  echo "==> upload"
  rsync -az --delete --exclude 'data.json*' --exclude .next --rsync-path="$RSYNC_PATH" web/dist/ "$HOST":/opt/lifelog/www/
  rsync -az --rsync-path="$RSYNC_PATH" build/lifelog deploy/sync.sh deploy/compress.sh "$HOST":/opt/lifelog/bin/
  if [[ "$WITH_ENV" == "--with-env" ]]; then
    # API tokens only (no passwords, no empty or comment-only values); readable by lifelog alone
    grep -E '^[A-Z_][A-Z0-9_]*=[^ #]' .env | grep -vE '^(GARMIN_EMAIL|GARMIN_PASSWORD|JOYRUN_PHONE)=' |
      ssh "$HOST" "$SUDO tee /opt/lifelog/.env >/dev/null"
  fi
  remote "install -d -o lifelog -g lifelog /opt/lifelog/www/.next && chown -R lifelog:lifelog /opt/lifelog/www /opt/lifelog/bin /opt/lifelog/.env && chmod 600 /opt/lifelog/.env && chmod 755 /opt/lifelog/bin/*"
  echo "==> precompress site files"
  ssh "$HOST" "$AS_LIFELOG /opt/lifelog/bin/compress.sh --site /opt/lifelog/www/assets && $AS_LIFELOG /opt/lifelog/bin/compress.sh /opt/lifelog/www/index.html"

  echo "==> first sync"
  remote "systemctl start lifelog-sync.timer; systemctl start lifelog-sync.service; journalctl -u lifelog-sync.service -n 20 --no-pager"
  ;;

*)
  echo "usage: deploy.sh setup <ssh-host> <domain> [email] | release <ssh-host> [--with-env]" >&2
  exit 2
  ;;
esac
