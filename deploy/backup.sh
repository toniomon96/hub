#!/usr/bin/env bash
# deploy/backup.sh — called by hub-backup.timer nightly.
# 1. Snapshot SQLite to /tmp (atomic, doesn't block writers).
# 2. Tar up the Obsidian vault (in case git repo is gone).
# 3. rclone copy both to r2:hub-backups/YYYY-MM-DD/
# 4. Prune local tmp. R2 lifecycle rule handles retention on the bucket side.
set -euo pipefail

DATE="$(date -u +%F)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DB_PATH="${HUB_DB_PATH:-/var/lib/hub/data/hub.db}"
VAULT_PATH="${OBSIDIAN_VAULT_PATH:-/var/lib/hub/vault}"
REMOTE="${HUB_BACKUP_REMOTE:-r2:hub-backups}"

if [[ -f "$DB_PATH" ]]; then
  sqlite3 "$DB_PATH" ".backup '$TMP/hub.db'"
  echo "sqlite snapshot: $(du -h "$TMP/hub.db" | cut -f1)"
else
  echo "warn: $DB_PATH not found, skipping DB backup"
fi

if [[ -d "$VAULT_PATH" ]]; then
  tar -C "$(dirname "$VAULT_PATH")" -czf "$TMP/vault.tar.gz" "$(basename "$VAULT_PATH")"
  echo "vault archive: $(du -h "$TMP/vault.tar.gz" | cut -f1)"
fi

rclone copy "$TMP" "$REMOTE/$DATE/" --progress --stats-one-line
echo "backup ok → $REMOTE/$DATE/"
