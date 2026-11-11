# Acceptance checklist (on the Jetson)

Run these before merging the homeserver PR, and keep the filled-in numbers in
the PR description. Commands assume `~/homeserver` and the compose entry from
[docker-compose.snippet.yml](docker-compose.snippet.yml).

## 0. Runtime canary (old kernel / old Docker)

The Jetson runs Ubuntu 18.04 (kernel 4.9) with an old Docker. Very new base
images can fail there, so check the exact image first — before touching the
compose file:

```bash
uname -r; docker version --format '{{.Server.Version}}'; docker-compose version --short
mkdir -p /tmp/jl-canary && touch /tmp/jl-canary/.jetlag-volume
docker run --rm -d --name jl-canary --user 1000:1000 --read-only --tmpfs /tmp \
  -v /tmp/jl-canary:/data -p 127.0.0.1:18080:8080 -e COOKIE_SECURE=false \
  ghcr.io/mw-sand/jetlag-hide-seek:<version>
sleep 15
curl -s http://127.0.0.1:18080/healthz          # → {"ok":true,"version":"<version>"}
docker inspect --format '{{.State.Health.Status}}' jl-canary   # → healthy
docker stats --no-stream jl-canary
docker stop jl-canary
```

| Check | Result |
|---|---|
| Kernel / Docker / docker-compose versions | |
| `/healthz` ok, health `healthy` | |
| `docker stats` memory (idle) | |

If the container exits immediately with `Operation not permitted` errors, the
host's Docker/libseccomp is too old for the Alpine base. Update Docker
(`sudo apt-get install docker.io`/NVIDIA's package) or report back so the image
can switch base.

## 1. Memory before / after

```bash
docker stats --no-stream   # before adding the service: note total used
free -m
```

| | Before | After (idle) | After (30 players) |
|---|---|---|---|
| `free -m` used | | | |
| `docker stats jetlag` | — | | |

30 players: from a laptop on the LAN (Node 24), with NPM host in place:
`node scripts/load-sse.mjs https://jetlag.3mgroup.eu 30 50`
→ expect `0 missing`; record p95 latency: ______

## 2. Startup guard (USB drive missing)

```bash
docker-compose stop jetlag
mv /mnt/backup/jetlag/.jetlag-volume /mnt/backup/jetlag/.jetlag-volume.off
docker-compose up -d jetlag; sleep 10
docker logs --tail 3 jetlag        # → "Data marker … not found … Refusing to start"
docker ps -a --filter name=jetlag  # → Restarting
mv /mnt/backup/jetlag/.jetlag-volume.off /mnt/backup/jetlag/.jetlag-volume
sleep 60; docker ps --filter name=jetlag   # → Up (healthy), without manual action
```

- [ ] refuses to start without the marker
- [ ] comes back by itself when the marker is back

## 3. Reboot and power loss

- [ ] `sudo reboot` → after boot, `jetlag` is `Up (healthy)` and an existing game still loads
- [ ] Pull the power plug during an active game (players connected), boot →
      `sqlite3 /mnt/backup/jetlag/jetlag.db 'PRAGMA integrity_check;'` prints `ok`,
      the game still loads

## 4. Files and permissions

```bash
ls -ln /mnt/backup/jetlag      # every file owned by 1000:1000
```

- [ ] no root-owned files (so no ACL entry needed)

## 5. Backup → verify → NAS restore → restore drill

```bash
~/homeserver/backup.sh                       # as jetson, no sudo
ls <staging>/jetlag-*.db.age
~/homeserver/verify-backup.sh                # reports the jetlag artifact as ok
~/homeserver/restore-from-nas.sh …           # lists/recognises jetlag-*.db.age
~/homeserver/restore.sh …                    # single-command restore
```

- [ ] backup created and encrypted (`.db.age`)
- [ ] verify passes; a deliberately truncated copy fails
- [ ] NAS restore recognises `jetlag-YYYYMMDD-HHMMSS.db.age`
- [ ] after restore the app is healthy and shows the restored game

## 6. Public access and play test

- [ ] `https://jetlag-beta.3mgroup.eu` (temporary NPM host) loads on a phone over 4G
- [ ] Two phones: create → join (invite link) → pick area → start → ask → answer → end;
      live updates arrive within a second; refresh mid-game reconnects automatically
- [ ] "My location" and "Invite players" work (they need the https address)
- [ ] Map data comes through the server cache:
      `curl -s -o /dev/null -D - "https://jetlag.3mgroup.eu/api/overpass?data=%5Bout%3Ajson%5D%3Bnode(1)%3Bout%3B" | grep -i x-cache`
      → `MISS` the first time, `HIT` the second; `du -sh /mnt/backup/jetlag/cache` stays under the budget
- [ ] Switch `jetlag.3mgroup.eu` DNS, remove the beta host
- [ ] Stop the GitHub Pages deploy; after a stable week retire Supabase and the Pi keep-alive
