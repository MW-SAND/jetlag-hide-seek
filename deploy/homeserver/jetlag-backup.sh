#!/usr/bin/env bash
# jetlag-backup.sh — backup / verify / restore for the jetlag-hide-seek SQLite DB.
#
# Designed to be called from the homeserver's backup.sh, verify-backup.sh,
# restore-from-nas.sh and restore.sh (one line each, see README.md here).
# Runs as the normal user (jetson); never needs sudo because the container
# writes its files as uid 1000.
#
#   jetlag-backup.sh backup  <dest-dir>     → <dest-dir>/jetlag-YYYYMMDD-HHMMSS.db[.age]
#   jetlag-backup.sh verify  <file.db|file.db.age>
#   jetlag-backup.sh restore <file.db|file.db.age>
#   jetlag-backup.sh matches <filename>     → exit 0 if the name is a jetlag artifact
#
# Environment (all optional):
#   JETLAG_DATA_DIR      data dir on the host        (default /mnt/backup/jetlag)
#   AGE_RECIPIENTS_FILE  if set, backups are age-encrypted to these recipients
#   AGE_IDENTITY_FILE    identity used to decrypt .age artifacts (verify/restore)
#   COMPOSE_DIR          dir with docker-compose.yml (default ~/homeserver)
#   JETLAG_SERVICE       compose service name        (default jetlag)
set -euo pipefail

DATA_DIR="${JETLAG_DATA_DIR:-/mnt/backup/jetlag}"
DB="$DATA_DIR/jetlag.db"
MARKER="$DATA_DIR/.jetlag-volume"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/homeserver}"
SERVICE="${JETLAG_SERVICE:-jetlag}"
NAME_RE='^jetlag-[0-9]{8}(-[0-9]{6})?\.db(\.age)?$'

log() { echo "[jetlag] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed"; }

TMPFILES=()
cleanup() { [ ${#TMPFILES[@]} -eq 0 ] || rm -f "${TMPFILES[@]}"; }
trap cleanup EXIT

# Decrypt (if needed) into a temp file; sets PLAIN to the path of a plain .db.
plain_copy() {
    local src="$1"
    PLAIN="$(mktemp --suffix=.db)"
    TMPFILES+=("$PLAIN")
    case "$src" in
        *.age)
            need age
            [ -n "${AGE_IDENTITY_FILE:-}" ] || die "AGE_IDENTITY_FILE is required to read $src"
            age -d -i "$AGE_IDENTITY_FILE" -o "$PLAIN" "$src"
            ;;
        *) cp "$src" "$PLAIN" ;;
    esac
}

check_db() {
    local file="$1" result version
    result="$(sqlite3 "$file" "PRAGMA integrity_check;")"
    [ "$result" = "ok" ] || die "integrity_check failed for $file: $result"
    version="$(sqlite3 "$file" "PRAGMA user_version;")"
    [ "$version" -ge 1 ] 2>/dev/null || die "unexpected schema version '$version' in $file"
    sqlite3 "$file" "SELECT count(*) FROM games;" >/dev/null || die "games table unreadable in $file"
    log "verified $(basename "$file"): integrity ok, schema v$version, $(sqlite3 "$file" 'SELECT count(*) FROM games;') game(s)"
}

cmd_backup() {
    local dest="${1:?usage: backup <dest-dir>}" out
    need sqlite3
    mkdir -p "$dest"
    if [ ! -f "$DB" ]; then
        [ -f "$MARKER" ] || die "$DATA_DIR is not mounted (marker missing)"
        log "no database yet, nothing to back up"
        return 0
    fi
    out="$dest/jetlag-$(date +%Y%m%d-%H%M%S).db"
    # Online, consistent copy (safe while the app is running; WAL included).
    sqlite3 "$DB" ".timeout 15000" ".backup '$out'"
    check_db "$out"
    if [ -n "${AGE_RECIPIENTS_FILE:-}" ]; then
        need age
        age -R "$AGE_RECIPIENTS_FILE" -o "$out.age" "$out"
        rm -f "$out"
        out="$out.age"
    fi
    log "backup written: $out"
    echo "$out"
}

cmd_verify() {
    local src="${1:?usage: verify <file>}"
    need sqlite3
    [ -f "$src" ] || die "$src not found"
    plain_copy "$src"
    check_db "$PLAIN"
}

cmd_restore() {
    local src="${1:?usage: restore <file>}"
    need sqlite3
    [ -f "$src" ] || die "$src not found"
    [ -d "$DATA_DIR" ] || die "$DATA_DIR does not exist — is the USB drive mounted?"
    plain_copy "$src"
    check_db "$PLAIN"

    if command -v docker-compose >/dev/null 2>&1 && [ -f "$COMPOSE_DIR/docker-compose.yml" ]; then
        (cd "$COMPOSE_DIR" && docker-compose stop "$SERVICE") || true
    fi
    rm -f "$DB-wal" "$DB-shm"
    cp "$PLAIN" "$DB.restoring"
    mv -f "$DB.restoring" "$DB"
    touch "$MARKER"
    if command -v docker-compose >/dev/null 2>&1 && [ -f "$COMPOSE_DIR/docker-compose.yml" ]; then
        (cd "$COMPOSE_DIR" && docker-compose up -d "$SERVICE")
    fi
    log "restored $DB from $(basename "$src")"
}

cmd_matches() {
    local name
    name="$(basename "${1:?usage: matches <filename>}")"
    [[ "$name" =~ $NAME_RE ]]
}

case "${1:-}" in
    backup) shift; cmd_backup "$@" ;;
    verify) shift; cmd_verify "$@" ;;
    restore) shift; cmd_restore "$@" ;;
    matches) shift; cmd_matches "$@" ;;
    *) sed -n '2,20p' "$0"; exit 2 ;;
esac
