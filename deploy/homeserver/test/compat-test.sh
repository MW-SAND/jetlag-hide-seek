#!/usr/bin/env bash
# Runs inside ubuntu:18.04 (same sqlite3 3.22 as the Jetson host).
# Expects the app's live data dir mounted at /live (read-write, WAL active)
# and deploy/homeserver mounted at /deploy.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq >/dev/null
apt-get install -y -qq sqlite3 curl ca-certificates >/dev/null
echo "sqlite3 $(sqlite3 --version | cut -d' ' -f1)"

AGE_VERSION=v1.2.1
curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 age/age age/age-keygen

# Run as uid 1000 like the jetson user (backup.sh is never run with sudo).
useradd -u 1000 -m jetson 2>/dev/null || true
tr -d '\r' < /deploy/jetlag-backup.sh > /usr/local/bin/jetlag-backup.sh
chmod +x /usr/local/bin/jetlag-backup.sh

su jetson -s /bin/bash -c '
set -euo pipefail
cd ~
age-keygen -o key.txt 2>/dev/null
age-keygen -y key.txt > recipients.txt
export JETLAG_DATA_DIR=/live

echo "== plain backup + verify"
plain=$(jetlag-backup.sh backup ~/out)
jetlag-backup.sh verify "$plain"

echo "== encrypted backup + verify"
enc=$(AGE_RECIPIENTS_FILE=~/recipients.txt jetlag-backup.sh backup ~/out-age)
case "$enc" in *.db.age) ;; *) echo "expected .db.age, got $enc"; exit 1;; esac
if AGE_IDENTITY_FILE= jetlag-backup.sh verify "$enc" 2>/dev/null; then echo "verify without identity must fail"; exit 1; fi
AGE_IDENTITY_FILE=~/key.txt jetlag-backup.sh verify "$enc"

echo "== file name recognition (restore-from-nas)"
for good in jetlag-20261108.db jetlag-20261108-101500.db jetlag-20261108-101500.db.age /nas/x/jetlag-20261108.db.age; do
    jetlag-backup.sh matches "$good" || { echo "should match: $good"; exit 1; }
done
for bad in jetlag.db jetlag-2026.db immich-20261108.db.age jetlag-20261108.db.age.tmp; do
    if jetlag-backup.sh matches "$bad"; then echo "should not match: $bad"; exit 1; fi
done

echo "== restore into an empty data dir"
mkdir -p ~/restore-target
JETLAG_DATA_DIR=~/restore-target AGE_IDENTITY_FILE=~/key.txt COMPOSE_DIR=/nonexistent jetlag-backup.sh restore "$enc"
test -f ~/restore-target/.jetlag-volume
jetlag-backup.sh verify ~/restore-target/jetlag.db
orig=$(sqlite3 "$plain" "SELECT count(*) FROM games; SELECT count(*) FROM questions;")
rest=$(sqlite3 ~/restore-target/jetlag.db "SELECT count(*) FROM games; SELECT count(*) FROM questions;")
[ "$orig" = "$rest" ] || { echo "restored data differs: $orig vs $rest"; exit 1; }
[ "$(sqlite3 "$plain" "SELECT count(*) FROM questions;")" -ge 5 ] || { echo "seeded questions missing from backup"; exit 1; }

echo "== corrupt artifact is rejected"
head -c 8192 "$plain" > ~/broken.db
if jetlag-backup.sh verify ~/broken.db 2>/dev/null; then echo "corrupt file passed verify"; exit 1; fi
echo "ALL BACKUP COMPAT CHECKS PASSED"
'
