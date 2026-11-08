# Jet Lag: Hide and Seek — map generator

Interactive maps for _Jet Lag The Game: Hide and Seek_: name the questions
(radius, thermometer, matching, measuring, tentacles) and watch the map
eliminate where the hider can't be. Multiplayer games sync seekers and hiders
live.

This is a rewrite of [taibeled/JetLagHideAndSeek](https://github.com/taibeled/JetLagHideAndSeek)
(MIT) and its Supabase-based multiplayer fork, built to run as **one small
container** on a home server (NVIDIA Jetson Nano, arm64) behind Nginx Proxy
Manager at `jetlag.3mgroup.eu`.

## What changed compared to the old app

|                                      | Old (Astro + Supabase on GitHub Pages)                                             | New                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Hosting                              | GitHub Pages + Supabase free tier (+ a Pi pinging it so it doesn't pause)          | One container: static files + API + SQLite                          |
| Realtime                             | 6 overlapping Supabase `postgres_changes` channels                                 | One SSE stream per player carrying only version numbers             |
| Map computation                      | Main thread (UI freezes on heavy questions)                                        | Web Worker, memoized per question prefix, cancellable               |
| Initial load (Lighthouse, mobile 4G) | score 0.50–0.76, LCP 6.4–33 s, 588 KB JS                                           | score 0.99, LCP ≈ 2.0 s, TBT ≈ 0, **69 KB JS**                      |
| Share links                          | Pastebin via public CORS-Anywhere proxy                                            | Built-in short links (`/?s=…`), old `?hz`/`?hzc` links still work   |
| Third parties                        | Google Analytics, Clarity, Google Fonts, jsDelivr/GitHub marker images, ArcGIS CDN | Map tiles, Overpass and Photon only                                 |
| Server RAM                           | n/a                                                                                | ~21 MiB idle, ~24 MiB with 30 connected players (amd64 measurement) |

Also fixed along the way: geo-data realtime never fired, stale local data
overwrote the server on entering a game, lost writes when leaving, wrong host
detection, React hooks called conditionally (two components), random player
order on equal join times.

## Architecture

```
apps/web          Vite + React SPA (landing page prerendered into index.html)
apps/server       Node 24 http server: REST + SSE + static files, node:sqlite
packages/geo      The question → eliminated-area engine (pure TS, runs in a Worker)
packages/shared   Zod contract for every request, response and SSE event
e2e               Playwright tests against the production build
deploy/homeserver Ready-to-paste compose entry, backup helper, docs, acceptance checklist
```

- **Identity:** an opaque `HttpOnly` cookie (no accounts). Refreshing or
  re-opening a game link rejoins the same player.
- **Authorization:** the old row-level-security rules, ported to one pure
  module ([apps/server/src/authz.ts](apps/server/src/authz.ts)) and
  table-tested. The hider location is never sent to seekers.
- **Data:** one SQLite file (`/data/jetlag.db`, WAL). Games expire after 30
  days, short links after 180 days. No hostnames or IPs are stored.
- **Single instance:** realtime fan-out is in memory, so run exactly one
  active copy per database (active/standby is fine, active/active is not).

API contract: [packages/shared/src/api.ts](packages/shared/src/api.ts).
Server details and settings: [apps/server/README.md](apps/server/README.md).

## Development

Requirements: Node 24, pnpm 10.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev          # server on :8080 (data in apps/server/.data) + Vite on :5173
```

| Command                                 | What it does                                                       |
| --------------------------------------- | ------------------------------------------------------------------ |
| `pnpm test`                             | All unit + integration tests (geo engine, contract, server, web)   |
| `pnpm build`                            | Production build of web (prerender, precompress) and server bundle |
| `pnpm test:e2e`                         | Playwright against the production build (run `pnpm build` first)   |
| `pnpm lint` / `pnpm format`             | ESLint + Prettier                                                  |
| `pnpm typecheck`                        | TypeScript in every package                                        |
| `docker compose up --build`             | Run the production image locally on http://localhost:8080          |
| `node scripts/load-sse.mjs <url> 30 50` | 30 SSE clients, 50 changes: delivery + latency report              |

## How it is tested

| Layer                                                                                                                                       | Where                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Geo engine: ported unit tests + golden test proving the Worker pipeline equals the old main-thread pipeline, memo, cancellation, hider mode | `packages/geo/test`                                                |
| Contract: room codes, names, defaults, locked questions                                                                                     | `packages/shared/test`                                             |
| Authorization matrix: every action × role × phase (158 cases)                                                                               | `apps/server/test/authz.test.ts`                                   |
| Full game over HTTP, privacy fuzzing, SSE, durability (`kill -9` mid-write → integrity ok), static serving, limits                          | `apps/server/test`                                                 |
| Browser e2e: create/join/start/ask/answer/rejoin/end, secrecy, no third-party CDNs, bundle budget                                           | `e2e/`                                                             |
| Lighthouse budgets (mobile, simulated 4G)                                                                                                   | `lighthouserc.json` (CI)                                           |
| Backup helper vs. sqlite3 3.22 in `ubuntu:18.04` (plain + `age`, NAS names, restore, corrupt file)                                          | `deploy/homeserver/test` (CI)                                      |
| Container amd64 + arm64 (QEMU): start guard, health, uid 1000, graceful stop, size budget (~72 MB compressed) | CI `container` job |
| On-device checks on the Jetson                                                                                                              | [deploy/homeserver/ACCEPTANCE.md](deploy/homeserver/ACCEPTANCE.md) |

## Releasing

Push a tag `vX.Y.Z`. The release workflow builds `linux/arm64` + `linux/amd64`
and publishes `ghcr.io/mw-sand/jetlag-hide-seek:X.Y.Z`; the job summary shows
the digest to pin in the homeserver compose file. See
[deploy/homeserver/README.md](deploy/homeserver/README.md).

## Credits

Original map generator by [taibeled](https://github.com/taibeled) and
[contributors](https://github.com/taibeled/JetLagHideAndSeek#contributors).
Map data © OpenStreetMap contributors; tiles by CARTO / Esri / Thunderforest.
