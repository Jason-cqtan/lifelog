#!/usr/bin/env bash
# One-time server setup for lifelog on Debian 12 / Ubuntu 22.04+ (run as root).
#
#   sudo bash install.sh <domain> [email]   # email: optional, for Let's Encrypt expiry notices
#
# Installs Caddy (HTTPS via Let's Encrypt, renewed automatically) and
# PostgreSQL, creates the `lifelog` user (database role of the same name, peer
# auth over the local socket: no password) with an SSH deploy key for the
# GitHub repo, the `lifelog serve` service (admin API + scheduled sync) and the
# firewall rules. Run it again after adding the deploy key to GitHub: it then
# clones the repo. Safe to re-run.
set -euo pipefail

DOMAIN="${1:?usage: install.sh <domain> [email]}"
EMAIL="${2:-}"
REPO="git@github.com:Jason-cqtan/lifelog.git"
HOME_DIR=/opt/lifelog

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

echo "==> packages"
apt-get update -qq
apt-get install -y -qq git curl debian-keyring debian-archive-keyring apt-transport-https gnupg ufw rsync brotli zstd postgresql openssl >/dev/null
if ! command -v caddy >/dev/null; then
  # official Caddy apt repository (https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

echo "==> user and folders"
id lifelog >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash lifelog
install -d -o lifelog -g lifelog "$HOME_DIR/bin" "$HOME_DIR/www" "$HOME_DIR/www/.next" "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"
# Caddy only needs to read the site
chmod 755 "$HOME_DIR" "$HOME_DIR/www"

if [[ ! -f "$HOME_DIR/.ssh/id_ed25519" ]]; then
  sudo -u lifelog ssh-keygen -q -t ed25519 -N "" -C "lifelog@$DOMAIN" -f "$HOME_DIR/.ssh/id_ed25519"
fi
sudo -u lifelog sh -c "ssh-keyscan -t ed25519 github.com >> $HOME_DIR/.ssh/known_hosts 2>/dev/null; sort -u -o $HOME_DIR/.ssh/known_hosts $HOME_DIR/.ssh/known_hosts"

echo "==> database"
systemctl enable --now postgresql >/dev/null
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'lifelog'" | grep -q 1 ||
  runuser -u postgres -- createuser lifelog
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'lifelog'" | grep -q 1 ||
  runuser -u postgres -- createdb -O lifelog lifelog
# .env keeps only what can't live in the database; everything else is set in the admin page
touch "$HOME_DIR/.env"
chown lifelog:lifelog "$HOME_DIR/.env"
chmod 600 "$HOME_DIR/.env"
grep -q '^DATABASE_URL=' "$HOME_DIR/.env" || echo 'DATABASE_URL=postgres:///lifelog?host=/var/run/postgresql' >> "$HOME_DIR/.env"
if ! grep -q '^LIFELOG_ADMIN_PASSWORD=' "$HOME_DIR/.env"; then
  ADMIN_PW="$(openssl rand -base64 18)"
  echo "LIFELOG_ADMIN_PASSWORD=$ADMIN_PW" >> "$HOME_DIR/.env"
  echo "!! admin page password (change it in the admin page): $ADMIN_PW"
fi

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
  # lifelog reads ./.env itself (comments allowed); .env is gitignored
  sudo -u lifelog ln -sf "$HOME_DIR/.env" "$HOME_DIR/repo/.env"
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

echo "==> lifelog service"
# the old timer + sync.sh setup; `lifelog serve` schedules syncs itself now
if [[ -f /etc/systemd/system/lifelog-sync.timer ]]; then
  systemctl disable --now lifelog-sync.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/lifelog-sync.timer /etc/systemd/system/lifelog-sync.service "$HOME_DIR/bin/sync.sh"
fi
install -m 755 "$(dirname "$0")/compress.sh" "$HOME_DIR/bin/"
install -m 644 "$(dirname "$0")/lifelog.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable lifelog.service >/dev/null
# it starts once deploy.sh has copied the binary
[[ -x "$HOME_DIR/bin/lifelog" ]] && systemctl restart lifelog.service

echo "==> network tuning (BBR etc.; the route to mainland China is long and lossy)"
install -m 644 "$(dirname "$0")/99-lifelog-net.conf" /etc/sysctl.d/
echo tcp_bbr > /etc/modules-load.d/bbr.conf
modprobe tcp_bbr
sysctl -q --system >/dev/null
tc qdisc replace dev "$(ip route show default | awk '{print $5; exit}')" root fq

echo "==> swap (1 GB boxes share RAM with the cloud vendor's agents)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness = 10' > /etc/sysctl.d/98-lifelog-swap.conf
sysctl -q -p /etc/sysctl.d/98-lifelog-swap.conf

echo "==> firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null # HTTP/3
ufw --force enable >/dev/null

echo "done. Next: run deploy/deploy.sh from your machine."
