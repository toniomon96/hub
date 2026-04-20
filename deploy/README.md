# Hub — VPS Deployment Runbook

Target: **Hetzner CX22 / Ubuntu 24.04 LTS / US East (Ashburn)** — €4.19/mo, 4 GB RAM, 2 vCPU, 40 GB NVMe.

Outcome: `https://hub.bambamhub.com` is served from the VPS 24/7. Laptop keeps its Obsidian vault (git-synced), and the iPhone Shortcut keeps working unchanged.

---

## 0. Before you start (on your laptop)

1. Make sure the latest main is pushed: `git push origin main`.
2. Rotate these secrets (you'll paste them into the VPS `.env` in step 3):
   - `ANTHROPIC_API_KEY` — Anthropic Console → API Keys → Rotate
   - `HUB_WEBHOOK_SECRET` — `openssl rand -hex 32`
   - `HUB_UI_TOKEN` — `openssl rand -hex 32`
3. Grab a Cloudflare R2 token + bucket (for nightly SQLite backups) — [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2).
4. Grab your existing Cloudflare tunnel credentials JSON from `C:\Users\<you>\.cloudflared\<tunnel-uuid>.json` — you'll copy it to the VPS and retire the laptop's tunnel service in step 9.

---

## 1. Provision the VPS

Hetzner Cloud console → **New Project → New Server**:

- Location: **Ashburn, VA (ash)**
- Image: **Ubuntu 24.04**
- Type: **CX22** (shared vCPU, 4 GB RAM, 40 GB disk)
- Networking: IPv4 + IPv6
- SSH keys: paste your existing public key; **do not set a root password**
- Firewalls: attach a firewall that allows **22/tcp, 80/tcp, 443/tcp** inbound only (or run the UFW step below)
- Name: `hub-prod`
- Create.

When it boots:

```bash
ssh root@<ip>
```

---

## 2. Run the bootstrap script

Copy `deploy/setup-vps.sh` up and run it as root. It installs Node 20, pnpm, git, cloudflared, rclone, ufw, and Ollama + phi4-mini; creates the `hub` user and `/var/lib/hub` directory; clones the repo; and installs the systemd units.

```bash
# on laptop
scp deploy/setup-vps.sh root@<ip>:/root/
ssh root@<ip> "bash /root/setup-vps.sh https://github.com/toniomon96/hub.git"
```

What the script does not do (you do these by hand, below): populate `.env`, authenticate `cloudflared`, configure `rclone`, push your vault up.

---

## 3. Populate `.env` on the VPS

```bash
ssh hub@<ip>
cd /var/lib/hub/hub
cp deploy/env.template .env
$EDITOR .env
```

Paste in the rotated secrets from step 0. **Set `HUB_HOST=0.0.0.0`** (so cloudflared can reach it on localhost), keep `HUB_PORT=4567`. Leave OAuth / MCP vars empty for now — the brief falls back to a local-only summary when they're missing.

---

## 4. Initialize the database (fresh start)

Per the deployment plan, we reset SQLite rather than copying the laptop DB. The Obsidian vault is the durable record.

```bash
cd /var/lib/hub/hub
pnpm install --frozen-lockfile
pnpm build
pnpm hub migrate
pnpm hub doctor
```

Doctor should report: env OK, DB OK, migrations applied. Anthropic/Ollama reachability may fail until step 5 — that's fine.

---

## 5. Start Ollama + pull the one local model we use

The setup script already did this, but to verify:

```bash
systemctl status ollama
ollama list   # should include phi4-mini
```

If the model isn't there: `ollama pull phi4-mini`. We deliberately **do not** pull qwen3:7b — the router's privacy path isn't triggered often enough to justify the 5 GB download on a 4 GB box, and the router silently degrades to `phi4-mini` when the private model is missing. Revisit when the CX31 upgrade is worth €8/mo.

---

## 6. Set up the Obsidian vault (git-synced)

On the VPS:

```bash
sudo -u hub mkdir -p /var/lib/hub/vault
cd /var/lib/hub/vault
# option A: clone your existing vault repo
git clone git@github.com:<you>/obsidian-vault.git .
# option B: start empty
git init && git branch -m main
# seed a Daily/ folder so the brief has somewhere to write
mkdir -p Daily && touch Daily/.gitkeep
git add . && git commit -m "init vault"
# if you haven't created the GitHub repo yet: gh repo create --private ...
git remote add origin git@github.com:<you>/obsidian-vault.git && git push -u origin main
```

In the VPS `.env`, set `OBSIDIAN_VAULT_PATH=/var/lib/hub/vault`.

The `hub-vault-sync.timer` unit pulls from `origin/main` every 60 seconds, so briefs the VPS writes will show up on your laptop (which has Obsidian Git plugin set to pull on launch + every 10 minutes).

On your **laptop**, clone the same repo into the folder Obsidian opens:

```powershell
cd C:\Users\tonimontez\Obsidian
git clone git@github.com:<you>/obsidian-vault.git vault
# install the Obsidian Git community plugin; set it to auto-pull + auto-commit
```

---

## 7. Cloudflare Tunnel — re-home to the VPS

```bash
ssh hub@<ip>
sudo mkdir -p /etc/cloudflared
sudo cp /home/hub/hub/deploy/cloudflared-config.example.yml /etc/cloudflared/config.yml
sudo $EDITOR /etc/cloudflared/config.yml   # set the tunnel UUID to your existing one
# copy your tunnel credentials JSON from laptop:
#   scp C:\Users\tonimontez\.cloudflared\<uuid>.json hub@<ip>:/tmp/
sudo mv /tmp/<uuid>.json /etc/cloudflared/
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Verify from your phone that `https://hub.bambamhub.com` still answers (it will initially still hit the laptop if the laptop's tunnel is still running — that's fine, we cut over in step 9).

---

## 8. Configure rclone for R2 backups

```bash
ssh hub@<ip>
rclone config
# n) new remote → name: r2 → storage: 5 (S3) → provider: Cloudflare
# paste the R2 access key + secret from step 0
# endpoint: https://<account-id>.r2.cloudflarestorage.com
# region: auto
rclone mkdir r2:hub-backups
rclone ls r2:hub-backups   # should be empty, no error
```

The `hub-backup.timer` unit runs nightly at 03:30 local time and uploads `hub.db` + a tarball of `vault/`.

---

## 9. Cutover — retire the laptop

On the **laptop**:

```powershell
# stop + disable the scheduled task so Windows doesn't auto-start the old server
schtasks /End /TN "Hub Server"
schtasks /Change /TN "Hub Server" /DISABLE
# stop + disable cloudflared (laptop copy)
Stop-Service cloudflared
Set-Service cloudflared -StartupType Disabled
```

Confirm `https://hub.bambamhub.com/health` now reports `version: 0.3.0` from the VPS — check `journalctl -u hub -f` on the VPS to see the request hit it.

Laptop is now a dev machine only. Keep the repo, delete nothing.

---

## 10. Smoke test from the phone

1. iOS Shortcut → capture "buy milk" → should 202 in under a second.
2. Open `https://hub.bambamhub.com` → log in → Dashboard shows the new capture.
3. Within 60 seconds, open Obsidian on laptop → `Inbox/<today>.md` contains the item (via vault git sync).

---

## Ongoing ops

| Task | Where | How |
|---|---|---|
| Deploy a new version | VPS | `cd /var/lib/hub/hub && git pull && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart hub` |
| Read logs | VPS | `journalctl -u hub -f` |
| Check health | anywhere | `curl https://hub.bambamhub.com/health` |
| Restore DB | VPS | `rclone copy r2:hub-backups/<date>/hub.db /var/lib/hub/data/` → `sudo systemctl restart hub` |
| Rotate UI token | VPS | edit `.env` → `sudo systemctl restart hub` (all browser cookies instantly invalid) |

See `SECURITY.md` for the incident-response one-pager.
