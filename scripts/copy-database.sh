#!/usr/bin/env bash
# Copies one database, whole, into another that is still empty — and then
# proves it, table by table, by counting the rows on both sides.
#
# Written for moving the live data into the We Lodge team's own Neon database
# (docs/todos.md §1). It asks for both connection strings instead of taking
# them as arguments, so they never land in shell history or on screen.
#
# Only the app's own tables (schema "public") are copied; anything Neon keeps
# for itself in other schemas is left alone on both sides.
#
# Safe by construction:
#   - the source is only ever read;
#   - it refuses to write into a database that already has tables;
#   - the restore is one transaction, so a failure leaves the target empty.
#
# Usage: ./scripts/copy-database.sh

set -euo pipefail

read -rsp "Connection string to copy FROM (the old database): " SOURCE; echo
read -rsp "Connection string to copy INTO (the new, empty one): " TARGET; echo

# Neon's pooled address ("-pooler") is for the app; a dump and a restore need
# a direct connection, so use the direct one whichever was pasted.
SOURCE=${SOURCE/-pooler./.}
TARGET=${TARGET/-pooler./.}

host() { sed -E 's#^[a-z]+://[^@]*@([^?]+).*#\1#' <<<"$1"; }
[[ "$(host "$SOURCE")" == "$(host "$TARGET")" ]] && { echo "Source and target are the same database. Stopping."; exit 1; }

echo
echo "  FROM  $(host "$SOURCE")"
echo "  INTO  $(host "$TARGET")"

tables_in() { psql "$1" -Atc "select count(*) from information_schema.tables where table_schema = 'public'"; }
existing=$(tables_in "$TARGET")
if [[ "$existing" != "0" ]]; then
  echo
  echo "The target already has $existing tables. This script only copies into an empty database. Stopping."
  exit 1
fi

read -rp $'\nType "copy" to go ahead: ' answer
[[ "$answer" == "copy" ]] || { echo "Nothing done."; exit 1; }

# pg_dump refuses a server newer than itself: use the matching tools from
# Docker when the local ones are older than either database.
major() { psql "$1" -Atc "show server_version_num" | cut -c1-2; }
need=$(( $(major "$SOURCE") > $(major "$TARGET") ? $(major "$SOURCE") : $(major "$TARGET") ))
have=$(pg_dump --version | grep -oE '[0-9]+' | head -1)

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
if (( have >= need )); then
  run() { "$@"; }
else
  echo "Using Postgres $need tools from Docker (local ones are $have)."
  run() { docker run --rm -v "$work:$work" "postgres:$need" "$@"; }
fi

echo "Reading the old database…"
run pg_dump --format=custom --schema=public --no-owner --no-acl --file="$work/dump" "$SOURCE"

echo "Writing into the new one…"
# Every database already has the "public" schema; restore everything but that.
run pg_restore --list "$work/dump" | grep -v ' SCHEMA - public ' > "$work/contents"
run pg_restore --no-owner --no-acl --single-transaction --exit-on-error \
  --use-list="$work/contents" --dbname="$TARGET" "$work/dump"

echo
echo "Rows per table, old vs new:"
mismatches=0
for t in $(psql "$SOURCE" -Atc "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"); do
  a=$(psql "$SOURCE" -Atc "select count(*) from public.\"$t\"")
  b=$(psql "$TARGET" -Atc "select count(*) from public.\"$t\"")
  mark="ok"; [[ "$a" == "$b" ]] || { mark="MISMATCH"; mismatches=$((mismatches + 1)); }
  printf "  %-40s %8s %8s  %s\n" "$t" "$a" "$b" "$mark"
done

echo
if (( mismatches == 0 )); then
  echo "Every table matches. The copy is complete."
else
  echo "$mismatches table(s) differ. Do not switch the live site over."
  exit 1
fi
