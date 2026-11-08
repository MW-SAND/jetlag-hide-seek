# Homeserver integration (Jetson Nano)

Everything needed to add **jetlag-hide-seek** to `~/homeserver`, following
`DESIGN.md`. Apply it through a PR on the homeserver repo: a push to `master`
goes live within a minute, so merge only after the
[acceptance checklist](ACCEPTANCE.md) is green on a branch.

## Files in this folder

| File | Goes to | Purpose |
|---|---|---|
| `docker-compose.snippet.yml` | `services:` of `~/homeserver/docker-compose.yml` | The service entry (pinned image, no host ports, `homeserver` network) |
| `env.example.snippet` | append to `~/homeserver/.env.example` | Optional tunables (no secrets) |
| `jetlag-backup.sh` | `~/homeserver/scripts/jetlag-backup.sh` (`chmod +x`) | Backup / verify / restore / NAS file-name matching |
| `test/compat-test.sh` | — | CI test of the helper against sqlite3 3.22 (`ubuntu:18.04`) |
| `ACCEPTANCE.md` | — | On-device checks before and after go-live |

## Service sheet ("what the service author must tell us")

| | |
|---|---|
| Name / source | `jetlag-hide-seek` — <https://github.com/MW-SAND/jetlag-hide-seek> |
| Image | `ghcr.io/mw-sand/jetlag-hide-seek:<version>@sha256:<digest>` (multi-arch, arm64 + amd64) |
| Current location | GitHub Pages + Supabase (retired after cut-over, no data migrated) |
| Data | `/mnt/backup/jetlag/jetlag.db` (+ `-wal`/`-shm` while running). Expected < 50 MB |
| Database | SQLite (inside the app container, no separate DB container) |
| Ports / protocols | `8080/tcp` HTTP inside the `homeserver` network; long-lived SSE responses on `/api/games/*/events`. No host ports |
| Public domain | `jetlag.3mgroup.eu` (NPM + Let's Encrypt) |
| Expected RAM | ~21 MiB idle, ~24 MiB with 30 connected players (measured on amd64); `mem_limit: 160m`. Record the Jetson numbers in ACCEPTANCE.md |
| Root-owned files | **None** — runs as uid/gid 1000 (`jetson`), so no ACL entry is needed |
| Secrets | None |
| Single instance | Yes: realtime fan-out is in memory. Run one active copy per DB (active/standby OK) |
| Start/stop | Starts in ~1 s; `SIGTERM` drains and checkpoints in < 10 s (`stop_grace_period: 30s`) |

## Setup (one time, on the Jetson)

```bash
# 1. Data folder on the USB drive, owned by jetson, with the mount marker.
sudo mkdir -p /mnt/backup/jetlag
sudo chown 1000:1000 /mnt/backup/jetlag
touch /mnt/backup/jetlag/.jetlag-volume

# 2. Check docker-compose supports file format 2.4 (needs >= 1.21).
docker-compose version
```

If `docker-compose` is older than 1.21, delete the `start_period` line from the
health check (format 2.3+) and use the file's existing `version:`.

The container refuses to start when `.jetlag-volume` is missing (for example if
the drive isn't mounted at boot); `restart: unless-stopped` keeps retrying, so
it comes up by itself once the drive is mounted.

## Nginx Proxy Manager

Add a proxy host:

| Field | Value |
|---|---|
| Domain | `jetlag.3mgroup.eu` |
| Scheme / host / port | `http` / `jetlag` / `8080` |
| Block common exploits | on |
| Websockets support | not needed (realtime uses SSE over normal HTTP) |
| SSL | Let's Encrypt, Force SSL, HTTP/2, HSTS |

The app sends `X-Accel-Buffering: no` on its event streams, so no custom
Nginx config is required.

## DNS and port forwarding

- Ports 80/443 are already forwarded from the FRITZ!Box to NPM; nothing new.
- `jetlag.3mgroup.eu` currently points at GitHub Pages (`CNAME` to
  `mw-sand.github.io`). At cut-over, change it to the home address (the same
  record type/target the other public services use). Test first with a
  temporary `jetlag-beta.3mgroup.eu` record and NPM host.
- Pi-hole: no local DNS entry needed unless the other services have one.

## Backups

The helper makes an online, consistent copy with
`sqlite3 jetlag.db ".backup …"` (safe while the app runs), checks
`PRAGMA integrity_check`, and optionally encrypts with `age`. It never needs
`sudo`: all files belong to uid 1000.

Add one line to each script (adapt variable names to the ones they already use):

```bash
# backup.sh — writes jetlag-YYYYMMDD-HHMMSS.db.age into the staging dir.
# (Leave AGE_RECIPIENTS_FILE unset if backup.sh already encrypts every new artifact.)
AGE_RECIPIENTS_FILE="<age recipients file>" ~/homeserver/scripts/jetlag-backup.sh backup "<staging dir>"

# verify-backup.sh — validates both plain and .age artifacts.
AGE_IDENTITY_FILE="<age identity>" ~/homeserver/scripts/jetlag-backup.sh verify "<artifact>"

# restore-from-nas.sh — recognise the artifact names (plain and .age):
#   jetlag-YYYYMMDD[-HHMMSS].db[.age]   e.g. jetlag-20261108-031500.db.age
if ~/homeserver/scripts/jetlag-backup.sh matches "$file"; then …; fi

# restore.sh — stops the container, replaces the DB, removes stale -wal/-shm,
# keeps the marker and starts it again.
AGE_IDENTITY_FILE="<age identity>" ~/homeserver/scripts/jetlag-backup.sh restore "<artifact>"
```

The DB is small, so it goes into the normal backup archive (not the large-media
path). There is no binary data directory to exclude. Off-site copies keep
working as before (pull only).

## README fragments for the homeserver repo

**Services table**

| Service | URL | Container | Data | Notes |
|---|---|---|---|---|
| Jet Lag Hide & Seek | https://jetlag.3mgroup.eu | `jetlag:8080` | `/mnt/backup/jetlag/jetlag.db` (SQLite) | Multiplayer map generator; no secrets |

**Directory structure**

```
/mnt/backup/jetlag/
├── .jetlag-volume     # mount marker; the container won't start without it
├── jetlag.db          # SQLite database (uid 1000)
├── jetlag.db-wal      # present while running
└── jetlag.db-shm      # present while running
```

**Setup step:** see "Setup" above. **NPM host:** see "Nginx Proxy Manager"
above. **Permissions:** nothing to add to the ACL block (no root-owned files).

## Updating

1. Tag a release in this repo (`git tag v1.0.1 && git push --tags`).
2. Copy the `image: …@sha256:…` line from the workflow summary into the
   homeserver compose file via a PR. The cron pull + `docker-compose up -d`
   does the rest. Schema migrations run automatically and atomically on start.

## Retiring the old setup (after one stable week)

- Disable GitHub Pages on `MW-SAND/JetLagHideSeek` and add a README pointer.
- Pause/delete the Supabase project.
- Stop the keep-alive on the Pi:
  `sudo systemctl disable --now supabase-keepalive.service`.
