#!/usr/bin/env bash
# deploy/vault-sync.sh — called by hub-vault-sync.timer every minute.
# Pulls the latest vault content from origin/main so briefs the laptop
# writes show up on the VPS, and vice versa. Ff-only to avoid merge drama.
set -euo pipefail

VAULT_PATH="${OBSIDIAN_VAULT_PATH:-/var/lib/hub/vault}"
cd "$VAULT_PATH"

# Bail quietly if not a git repo (e.g. fresh VPS before step 6).
[[ -d .git ]] || exit 0

# Commit anything the agent wrote locally so we can pull without conflicts.
if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git -c user.name='hub-vps' -c user.email='hub@localhost' commit -m "chore(vault): auto-commit from vps $(date -u -Iseconds)" || true
fi

git fetch --quiet origin main 2>/dev/null || exit 0

# Ff-merge if we can; if diverged, don't try to auto-resolve — surface in journal.
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")"
BASE="$(git merge-base HEAD origin/main 2>/dev/null || echo "$LOCAL")"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
elif [[ "$LOCAL" == "$BASE" ]]; then
  git merge --ff-only origin/main
  echo "vault ff-merged $REMOTE"
elif [[ "$REMOTE" == "$BASE" ]]; then
  git push origin main 2>/dev/null || echo "warn: push failed"
else
  echo "warn: vault diverged, manual intervention needed"
  exit 1
fi
