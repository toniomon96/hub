#!/usr/bin/env bash
# deploy/setup-vps.sh — idempotent bootstrap for a fresh Ubuntu 24.04 VPS.
# Run as root. Takes one arg: the git URL of this repo.
#
# Usage:
#   bash setup-vps.sh https://github.com/toniomon96/hub.git
set -euo pipefail

REPO_URL="${1:-https://github.com/toniomon96/hub.git}"
HUB_USER="hub"
HUB_HOME="/var/lib/hub"
REPO_DIR="${HUB_HOME}/hub"
NODE_VERSION="20"

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "must run as root"; exit 1; }

log "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg lsb-release ufw git build-essential sqlite3 rsync unzip jq

log "Firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
# 80/443 are not strictly required (cloudflared dials out) but handy for future Caddy.
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Create hub user + data dirs"
if ! id -u "$HUB_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$HUB_USER"
fi
mkdir -p "$HUB_HOME" "$HUB_HOME/data" "$HUB_HOME/logs" "$HUB_HOME/vault"
chown -R "$HUB_USER:$HUB_USER" "$HUB_HOME"

log "Install Node ${NODE_VERSION} (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_VERSION}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
node --version
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version

log "Install cloudflared"
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared
fi

log "Install rclone"
if ! command -v rclone >/dev/null; then
  curl -fsSL https://rclone.org/install.sh | bash
fi

log "Install Ollama"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama

log "Pull phi4-mini (the only model the router uses at MVP)"
sudo -u "$HUB_USER" ollama pull phi4-mini || ollama pull phi4-mini

log "Clone repo as hub user"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  sudo -u "$HUB_USER" git clone "$REPO_URL" "$REPO_DIR"
else
  sudo -u "$HUB_USER" git -C "$REPO_DIR" pull --ff-only
fi

log "pnpm install + build"
cd "$REPO_DIR"
sudo -u "$HUB_USER" pnpm install --frozen-lockfile
sudo -u "$HUB_USER" pnpm build

log "Install systemd units"
install -m 0644 "$REPO_DIR/deploy/systemd/hub.service"             /etc/systemd/system/hub.service
install -m 0644 "$REPO_DIR/deploy/systemd/hub-backup.service"      /etc/systemd/system/hub-backup.service
install -m 0644 "$REPO_DIR/deploy/systemd/hub-backup.timer"        /etc/systemd/system/hub-backup.timer
install -m 0644 "$REPO_DIR/deploy/systemd/hub-vault-sync.service"  /etc/systemd/system/hub-vault-sync.service
install -m 0644 "$REPO_DIR/deploy/systemd/hub-vault-sync.timer"    /etc/systemd/system/hub-vault-sync.timer
systemctl daemon-reload

log "Next steps (manual — see deploy/README.md):"
cat <<EOF

  1. sudo -u $HUB_USER cp $REPO_DIR/deploy/env.template $REPO_DIR/.env
  2. sudo -u $HUB_USER \$EDITOR $REPO_DIR/.env  # paste rotated secrets
  3. sudo -u $HUB_USER pnpm --dir $REPO_DIR hub migrate
  4. sudo -u $HUB_USER pnpm --dir $REPO_DIR hub doctor
  5. Configure cloudflared:     see deploy/README.md §7
  6. Configure rclone for R2:   rclone config   (see deploy/README.md §8)
  7. systemctl enable --now hub hub-backup.timer hub-vault-sync.timer
  8. systemctl status hub

EOF

log "Done."
