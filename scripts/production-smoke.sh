#!/usr/bin/env bash
# Production-like deployment smoke test (CI and local), mirroring the Vercel runbook:
#   fresh database → migrations as the owner role → least-privilege app role grants →
#   consultant account → `next start` in production mode (password auth, private S3-compatible
#   storage, fail-closed startup checks) → deployment smoke test → role check.
#
# Requires: a built app (npm run build), Chromium (npx playwright install chromium) and
#   SMOKE_ADMIN_URL  postgres URL of a role that can create databases and roles (CI: the service superuser)
# Everything here is test-only: throwaway database, role, credentials and fake S3.
set -euo pipefail

: "${SMOKE_ADMIN_URL:?SMOKE_ADMIN_URL is required}"
DB=value_office_prod_smoke
APP_ROLE=vo_app_smoke
APP_PASSWORD="smoke-$(openssl rand -hex 12)"
PORT=${SMOKE_PORT:-3200}
S3_PORT=${SMOKE_S3_PORT:-9100}
CONSULTANT_EMAIL=smoke.consultant@cardaxia.ai
CONSULTANT_PASSWORD="smoke-$(openssl rand -hex 16)"

with_db() { node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$1" "$2"; }
as_user() { node -e 'const u=new URL(process.argv[1]);u.username=process.argv[2];u.password=process.argv[3];console.log(u.toString())' "$1" "$2" "$3"; }

OWNER_URL=$(with_db "$SMOKE_ADMIN_URL" "$DB")
APP_URL=$(as_user "$OWNER_URL" "$APP_ROLE" "$APP_PASSWORD")

psql "$SMOKE_ADMIN_URL" -qc "drop database if exists $DB" -c "create database $DB"
psql "$SMOKE_ADMIN_URL" -qc "do \$\$ begin if not exists (select from pg_roles where rolname = '$APP_ROLE') then create role $APP_ROLE login; end if; end \$\$" \
  -c "alter role $APP_ROLE login password '$APP_PASSWORD'"

echo "→ migrations as the owner role, then app-role grants"
MIGRATION_DATABASE_URL="$OWNER_URL" VO_APP_DB_ROLE=$APP_ROLE npm run -s db:migrate
echo "→ app role is least-privilege"
DATABASE_URL="$APP_URL" npm run -s db:check-role
echo "→ consultant account (via the app role)"
printf '%s' "$CONSULTANT_PASSWORD" | DATABASE_URL="$APP_URL" VO_AUTH_MODE=dev VO_DEV_USER_EMAIL=ops@cardaxia.ai \
  npm run -s user:create -- --email $CONSULTANT_EMAIL --name "Smoke Consultant" --password-stdin

npx tsx tests/support/fake-s3.ts $S3_PORT &
S3_PID=$!
cleanup() { kill "$S3_PID" "${APP_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "→ next start (production configuration)"
# Blank (not unset) so a local .env.local, which next start also loads, cannot re-supply them.
VO_DEV_USER_EMAIL= VO_DEV_USER_NAME= VO_AUTH_MODE= VO_REPORT_STORAGE_DIR= \
  NODE_ENV=production DATABASE_URL="$APP_URL" \
  VO_SESSION_SECRET="$(openssl rand -hex 32)" VO_APP_ORIGIN="http://localhost:$PORT" \
  VO_REPORT_STORAGE=s3 VO_S3_BUCKET=vo-reports VO_S3_REGION=auto VO_S3_ENDPOINT="http://127.0.0.1:$S3_PORT" \
  VO_S3_ACCESS_KEY_ID=smoke-key VO_S3_SECRET_ACCESS_KEY=smoke-secret VO_S3_FORCE_PATH_STYLE=true \
  VO_PDF_RUNTIME="${SMOKE_PDF_RUNTIME:-playwright}" \
  npx next start --port "$PORT" > production-smoke-server.log 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/health" || { cat production-smoke-server.log; exit 1; }
echo

echo "→ security headers"
headers=$(curl -sI "http://localhost:$PORT/sign-in")
for h in "content-security-policy: default-src 'self'" "x-frame-options: DENY" "x-content-type-options: nosniff" "strict-transport-security"; do
  grep -qi "$h" <<<"$headers" || { echo "missing header: $h"; exit 1; }
done

echo "→ deployment smoke test"
SMOKE_BASE_URL="http://localhost:$PORT" SMOKE_EMAIL=$CONSULTANT_EMAIL SMOKE_PASSWORD="$CONSULTANT_PASSWORD" npm run -s smoke:deploy

grep -q "configuration ok: auth=password storage=s3" production-smoke-server.log
if grep -Eiq "$CONSULTANT_PASSWORD|$APP_PASSWORD|smoke-secret" production-smoke-server.log; then
  echo "secret found in server log"; exit 1
fi
echo "✓ production-like smoke test passed"
