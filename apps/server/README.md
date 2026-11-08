# @jetlag/server

Single-process Node 24 server: REST API, Server-Sent Events, static files and
SQLite (`node:sqlite`, no native modules). The production build is one file,
`dist/server.mjs` (~90 KB).

## Configuration

All environment variables are optional.

| Variable              | Default   | Meaning                                                                                            |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                | `8080`    | HTTP port                                                                                          |
| `HOST`                | `0.0.0.0` | Bind address                                                                                       |
| `DATA_DIR`            | `/data`   | Directory holding `jetlag.db`                                                                      |
| `REQUIRE_DATA_MARKER` | `true`    | Refuse to start unless `$DATA_DIR/.jetlag-volume` exists (protects against an unmounted USB drive) |
| `STATIC_DIR`          | _(none)_  | Built web app to serve (`/app/public` in the image)                                                |
| `TRUST_PROXY`         | `true`    | Client IP = last `X-Forwarded-For` hop (Nginx Proxy Manager). Used for rate limits only            |
| `COOKIE_SECURE`       | `true`    | `Secure` flag on the identity cookie; set `false` for plain-http local runs                        |
| `LOG_LEVEL`           | `info`    | `debug` / `info` / `warn` / `error` (one JSON line per event)                                      |
| `GAME_TTL_DAYS`       | `30`      | Games are deleted this long after creation                                                         |
| `SHARE_TTL_DAYS`      | `180`     | Short share links expire after this                                                                |
| `SSE_HEARTBEAT_MS`    | `25000`   | Keep-alive comment interval on event streams                                                       |

## API

The full contract (paths, request/response schemas, error codes) lives in
[`packages/shared/src/api.ts`](../../packages/shared/src/api.ts).

- Every non-GET `/api` request must send `X-Requested-With: jetlag` (CSRF
  protection; the web client always does).
- Errors are `{ "error": { "code", "message" } }` with matching HTTP status.
- Rate limits per client IP: create game 20/10 min, join 60/10 min, share
  links 30/10 min, any other change 600/min.
- Bodies are limited to 5 MB; share payloads to 1 MB.

### Realtime

`GET /api/games/:gameId/events` is an SSE stream. It sends `event: state`
with `{ version, geoVersions }` immediately and after every change, `: ping`
every 25 s, and `event: removed` when the player is no longer in the game.
Clients re-fetch `/state` (role-filtered) and changed geo fields when the
versions move, so no game data — in particular the hider location — ever
travels over the stream.

The fan-out is in memory: run **one active instance per database**. A standby
copy must not be started against the same file while the active one runs.

## Data

- One SQLite file, WAL mode, `synchronous=FULL`. Migrations are tracked with
  `PRAGMA user_version` and applied atomically.
- The schema stays readable by sqlite3 3.22 (no STRICT tables, generated
  columns or JSON functions in DDL) so the host can back it up with
  `sqlite3 jetlag.db ".backup …"`.
- Hourly cleanup of expired games and links (idempotent).
- On `SIGTERM`: stop accepting requests, close event streams, wait up to 10 s
  for in-flight requests, checkpoint the WAL, close the database.

## Health

`GET /healthz` → `{ "ok": true, "version": "…" }` (no writes). Used by the
container `HEALTHCHECK`.
