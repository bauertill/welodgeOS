#!/usr/bin/env bash
# Resets staging's database to a fresh copy of the live data, then re-applies
# the database changes that are on the staging branch but not yet live.
#
# Staging's database is a Neon branch called "staging" of the live database
# (product-scope §2.5). "Reset from parent" overwrites it with the live data
# as it is right now: everything entered on staging since is gone, and its
# connection string stays the same. The second step matters because staging
# usually runs code that is one step ahead of the live site — without it,
# staging would wake up to a database missing the tables its code expects.
#
# Runs every night at midnight UTC from .github/workflows/reset-staging.yml,
# and by hand whenever staging needs refreshing:
#
#   ./scripts/reset-staging.sh
#
# Needs, from the environment or from .env:
#   NEON_API_KEY             a Neon API key with access to welodge-production
#   NEON_PROJECT_ID          welodge-production's project ID (Neon → Settings)
#   STAGING_DATABASE_URL     staging's connection string — the same value as
#                            the Staging DATABASE_URL on Vercel
#
# The migrations applied are those in the working copy, so run it from a
# checkout of the staging branch.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${NEON_API_KEY:?NEON_API_KEY is not set}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID is not set}"
: "${STAGING_DATABASE_URL:?STAGING_DATABASE_URL is not set}"

api() {
  curl -sS --fail-with-body -H "Authorization: Bearer $NEON_API_KEY" \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID$1" "${@:2}"
}

branches=$(api /branches)
staging=$(jq -r '.branches[] | select(.name == "staging")' <<<"$branches")
[[ -n "$staging" ]] || { echo "No branch called \"staging\" in this project. Stopping."; exit 1; }

staging_id=$(jq -r .id <<<"$staging")
parent_id=$(jq -r '.parent_id // empty' <<<"$staging")
parent=$(jq -r --arg id "$parent_id" '.branches[] | select(.id == $id)' <<<"$branches")

# Belt and braces: Neon already refuses to reset a branch with no parent, but
# make sure the branch being overwritten is staging and its source is the
# live database, before anything is overwritten.
[[ "$(jq -r '.default // .primary // false' <<<"$staging")" == "false" ]] || { echo "\"staging\" is the project's main branch. Stopping."; exit 1; }
[[ "$(jq -r '.default // .primary // false' <<<"$parent")" == "true" ]] || { echo "\"staging\" does not branch from the main (live) branch. Stopping."; exit 1; }

echo "Resetting staging ($staging_id) from $(jq -r .name <<<"$parent") ($parent_id)…"
operations=$(api "/branches/$staging_id/restore" -X POST -d "{\"source_branch_id\": \"$parent_id\"}" | jq -r '.operations[].id')

for op in $operations; do
  for _ in $(seq 1 60); do
    status=$(api "/operations/$op" | jq -r .operation.status)
    case "$status" in
      finished|skipped|cancelled) break ;;
      failed|error) echo "Neon reports the reset failed (operation $op). Stopping."; exit 1 ;;
    esac
    sleep 2
  done
  [[ "$status" == "finished" || "$status" == "skipped" || "$status" == "cancelled" ]] || { echo "The reset did not finish within two minutes. Stopping."; exit 1; }
done
echo "Staging now holds the live data."

echo "Applying the database changes that are on staging but not yet live…"
DATABASE_URL="$STAGING_DATABASE_URL" pnpm exec prisma migrate deploy
echo "Staging is reset."
