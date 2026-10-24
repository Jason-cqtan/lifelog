#!/usr/bin/env bash
# One-time server setup for lifelog on Debian 12 / Ubuntu 22.04+ (run as root).
#
#   sudo bash install.sh <domain> [email]   # email: optional, for Let's Encrypt expiry notices
#
# Installs Caddy (HTTPS via Let's Encrypt, renewed automatically), creates the
# `lifelog` user with an SSH deploy key for the GitHub repo, the hourly sync
# timer and the firewall rules. Run it again after adding the deploy key to
# GitHub: it then clones the repo. Safe to re-run.
set -euo pipefail

DOMAIN="${1:?usage: install.sh <domain> [email]}"
EMAIL="${2:-}"
REPO="git@github.com:Jason-cqtan/lifelog.git"
HOME_DIR=/opt/lifelog

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

echo "==> packages"
apt-get update -qq
apt-get install -y -qq git curl debian-keyring debian-archive-keyring apt-transport-https gnupg ufw rsync >/dev/null
if ! command -v caddy >/dev/null; then
  # official Caddy apt repository (https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

echo "==> user and folders"
id lifelog >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash lifelog
install -d -o lifelog -g lifelog "$HOME_DIR/bin" "$HOME_DIR/www" "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"
# Caddy only needs to read the site
chmod 755 "$HOME_DIR" "$HOME_DIR/www"

if [[ ! -f "$HOME_DIR/.ssh/id_ed25519" ]]; then
  sudo -u lifelog ssh-keygen -q -t ed25519 -N "" -C "lifelog@$DOMAIN" -f "$HOME_DIR/.ssh/id_ed25519"
fi
sudo -u lifelog sh -c "ssh-keyscan -t ed25519 github.com >> $HOME_DIR/.ssh/known_hosts 2>/dev/null; sort -u -o $HOME_DIR/.ssh/known_hosts $HOME_DIR/.ssh/known_hosts"

echo "==> repository"
if [[ ! -d "$HOME_DIR/repo/.git" ]]; then
  if sudo -u lifelog git clone -q "$REPO" "$HOME_DIR/repo" 2>/dev/null; then
    echo "cloned $REPO"
  else
    echo
    echo "!! Add this deploy key to GitHub (Settings > Deploy keys, allow write access), then re-run:"
    cat "$HOME_DIR/.ssh/id_ed25519.pub"
    echo
  fi
fi
if [[ -d "$HOME_DIR/repo/.git" ]]; then
  sudo -u lifelog git -C "$HOME_DIR/repo" config user.name "lifelog-vps"
  sudo -u lifelog git -C "$HOME_DIR/repo" config user.email "lifelog@$DOMAIN"
fi

echo "==> caddy ($DOMAIN, Let's Encrypt)"
if [[ -n "$EMAIL" ]]; then
  sed -e "s/{{DOMAIN}}/$DOMAIN/g" -e "s/{{EMAIL}}/$EMAIL/g" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
else
  # an ACME account works without a contact address; Caddy renews either way
  sed -e "s/{{DOMAIN}}/$DOMAIN/g" -e "/email {{EMAIL}}/d" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null
systemctl reload caddy

echo "==> sync timer"
install -m 755 "$(dirname "$0")/sync.sh" "$HOME_DIR/bin/sync.sh"
install -m 644 "$(dirname "$0")/lifelog-sync.service" "$(dirname "$0")/lifelog-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable lifelog-sync.timer >/dev/null
# the timer starts once deploy.sh has copied the binary and .env
[[ -x "$HOME_DIR/bin/lifelog" && -f "$HOME_DIR/.env" ]] && systemctl start lifelog-sync.timer

echo "==> firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "done. Next: run deploy/deploy.sh from your machine."
