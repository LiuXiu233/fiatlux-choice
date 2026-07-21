#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

# The browser, API and worker must not inherit unrelated developer or CI credentials. Keep only
# the explicit loopback E2E inputs below; all other credential-shaped environment variables are
# removed before any child process or Playwright artifact can observe them.
while IFS= read -r variable_name; do
  case "$variable_name" in
    DATABASE_URL | TEST_DATABASE_URL | REAL_E2E_DATABASE_URL | REAL_E2E_API_PORT | \
      REAL_E2E_LOG_DIR | REAL_E2E_S3_ENDPOINT | REAL_E2E_ADMIN_EMAIL | \
      REAL_E2E_ADMIN_PASSWORD | REAL_E2E_ADMIN_ROTATED_PASSWORD | TEST_S3_ENDPOINT | \
      TEST_S3_REGION | TEST_S3_BUCKET | \
      TEST_S3_ACCESS_KEY_ID | TEST_S3_SECRET_ACCESS_KEY)
      ;;
    S3_* | JWT_SECRET | SESSION_SECRET | BOOTSTRAP_ADMIN_PASSWORD | INITIAL_ADMIN_PASSWORD | \
      *API_KEY* | *TOKEN* | *SECRET* | *PASSWORD* | *CREDENTIAL* | *ACCESS_KEY* | SSH_AUTH_SOCK)
      unset "$variable_name"
      ;;
  esac
done < <(compgen -e)

LOG_DIR=${REAL_E2E_LOG_DIR:-$ROOT_DIR/artifacts/real-stack/logs}
if [[ "$LOG_DIR" != /* ]]; then
  LOG_DIR="$ROOT_DIR/$LOG_DIR"
fi
case "$LOG_DIR" in
  "$ROOT_DIR"/artifacts/real-stack/* | "${TMPDIR:-/tmp}"/fiatlux-choice-e2e-*) ;;
  *)
    echo "REAL_E2E_LOG_DIR must stay inside artifacts/real-stack or a fiatlux-choice-e2e-* temp directory." >&2
    exit 2
    ;;
esac
# A prior failed run can contain inherited-environment diagnostics. Never let stale logs be
# uploaded as evidence for a later run, and recreate the directory with owner-only permissions.
rm -rf -- "$LOG_DIR"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

PIDS=()

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if ((${#PIDS[@]} > 0)); then
    for pid in "${PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi
  if ((exit_code != 0)); then
    for log_file in "$LOG_DIR"/*.log; do
      if [[ -f "$log_file" ]]; then
        echo "Last 120 lines from $log_file" >&2
        tail -n 120 "$log_file" >&2
      fi
    done
  fi
  exit "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export NODE_ENV=development
export DATABASE_URL=${REAL_E2E_DATABASE_URL:-${DATABASE_URL:-postgresql://fiatlux:fiatlux_e2e_password@127.0.0.1:5432/fiatlux_choice_e2e}}
export TEST_DATABASE_URL=$DATABASE_URL
export API_HOST=127.0.0.1
default_api_port=$((44000 + $$ % 1000))
default_web_port=$((43000 + $$ % 1000))
export API_PORT=${REAL_E2E_API_PORT:-$default_api_port}
export WEB_ORIGIN=${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:$default_web_port}
export APP_ORIGIN=$WEB_ORIGIN
export PLAYWRIGHT_BASE_URL=$WEB_ORIGIN
export VITE_DEV_API_URL=http://127.0.0.1:$API_PORT
export JWT_SECRET=${JWT_SECRET:-e2e-only-session-secret-with-more-than-32-characters}
export SESSION_SECRET=$JWT_SECRET
export JWT_TTL_SECONDS=43200
export COOKIE_SECURE=false
export TRUST_PROXY=false
export REAL_E2E_ADMIN_EMAIL=${REAL_E2E_ADMIN_EMAIL:-e2e-admin@fiatlux.local}
export REAL_E2E_ADMIN_PASSWORD=${REAL_E2E_ADMIN_PASSWORD:-e2e-only-admin-password-2026}
export REAL_E2E_ADMIN_ROTATED_PASSWORD=${REAL_E2E_ADMIN_ROTATED_PASSWORD:-e2e-only-rotated-admin-password-2026}
if [[ ${#REAL_E2E_ADMIN_ROTATED_PASSWORD} -lt 14 || "$REAL_E2E_ADMIN_ROTATED_PASSWORD" == "$REAL_E2E_ADMIN_PASSWORD" ]]; then
  echo "REAL_E2E_ADMIN_ROTATED_PASSWORD must contain at least 14 characters and differ from the bootstrap password." >&2
  exit 2
fi
export BOOTSTRAP_ORG_NAME=${BOOTSTRAP_ORG_NAME:-FIAT_LUX_REAL_E2E}
export BOOTSTRAP_ORG_SLUG=${BOOTSTRAP_ORG_SLUG:-fiat-lux-real-e2e}
export SEED_MODE=bootstrap
export BOOTSTRAP_ADMIN_EMAIL=$REAL_E2E_ADMIN_EMAIL
export BOOTSTRAP_ADMIN_NAME=${BOOTSTRAP_ADMIN_NAME:-真实栈验收管理员}
export BOOTSTRAP_ADMIN_PASSWORD=$REAL_E2E_ADMIN_PASSWORD
export COMPLIANCE_SOURCES_REQUIRED=true
export S3_ENDPOINT=${REAL_E2E_S3_ENDPOINT:-${S3_ENDPOINT:-${TEST_S3_ENDPOINT:-http://127.0.0.1:9000}}}
export S3_REGION=${S3_REGION:-${TEST_S3_REGION:-cn-south-1}}
export S3_BUCKET=${S3_BUCKET:-${TEST_S3_BUCKET:-fiatlux-choice-e2e}}
export S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:-${TEST_S3_ACCESS_KEY_ID:-fiatlux}}
export S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-${TEST_S3_SECRET_ACCESS_KEY:-fiatlux_e2e_minio_password}}
export S3_FORCE_PATH_STYLE=true
export LLM_DRIVER=mock
export GITHUB_INTEGRATION_MODE=manual
unset LLM_API_KEY GITHUB_TOKEN GITHUB_PROBE_REPOSITORY
export BACKUP_DIR=${BACKUP_DIR:-$ROOT_DIR/artifacts/real-stack/backups}

database_host=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname)')
database_name=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""))')
s3_host=$(node -e 'process.stdout.write(new URL(process.env.S3_ENDPOINT).hostname)')
web_host=$(node -e 'process.stdout.write(new URL(process.env.PLAYWRIGHT_BASE_URL).hostname)')
web_port=$(node -e 'process.stdout.write(new URL(process.env.PLAYWRIGHT_BASE_URL).port || "80")')

case "$database_host" in
  127.0.0.1 | localhost | ::1) ;;
  *)
    echo "Real-stack E2E refuses non-loopback PostgreSQL host." >&2
    exit 2
    ;;
esac
case "$s3_host" in
  127.0.0.1 | localhost | ::1) ;;
  *)
    echo "Real-stack E2E refuses non-loopback object-storage host." >&2
    exit 2
    ;;
esac
case "$web_host" in
  127.0.0.1 | localhost | ::1) ;;
  *)
    echo "Real-stack E2E refuses non-loopback web host." >&2
    exit 2
    ;;
esac
if [[ "$database_name" != *_e2e ]]; then
  echo "Real-stack E2E requires a dedicated database whose name ends in _e2e." >&2
  exit 2
fi

start_component() {
  local name=$1
  shift
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

wait_for_http() {
  local name=$1
  local url=$2
  local pid=$3
  for _ in $(seq 1 90); do
    if curl --fail --silent "$url" >/dev/null; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited before becoming ready." >&2
      return 1
    fi
    sleep 1
  done
  echo "$name did not become ready at $url." >&2
  return 1
}

wait_for_log() {
  local name=$1
  local expected=$2
  local pid=$3
  local log_file=$4
  for _ in $(seq 1 90); do
    if grep --quiet "$expected" "$log_file" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited before reporting readiness." >&2
      return 1
    fi
    sleep 1
  done
  echo "$name did not report readiness." >&2
  return 1
}

pnpm db:migrate >"$LOG_DIR/migrate.log" 2>&1
pnpm --filter @fiatlux/integrations exec tsx --conditions=development src/queue-migrate.ts >"$LOG_DIR/queue-migrate.log" 2>&1
pnpm db:seed >"$LOG_DIR/seed.log" 2>&1

start_component api pnpm --filter @fiatlux/api exec tsx --conditions=development src/server.ts
api_pid=${PIDS[${#PIDS[@]}-1]}
wait_for_http "Fastify API" "http://127.0.0.1:$API_PORT/health/ready" "$api_pid"

start_component worker pnpm --filter @fiatlux/worker exec tsx --conditions=development src/worker.ts
worker_pid=${PIDS[${#PIDS[@]}-1]}
wait_for_log "pg-boss worker" "FIAT LUX worker started" "$worker_pid" "$LOG_DIR/worker.log"

start_component web pnpm --filter @fiatlux/web exec vite --host 127.0.0.1 --port "$web_port" --strictPort
web_pid=${PIDS[${#PIDS[@]}-1]}
wait_for_http "Vite web" "$PLAYWRIGHT_BASE_URL/login" "$web_pid"

playwright_environment=(
  "CI=${CI:-}"
  "HOME=$HOME"
  "LANG=${LANG:-C.UTF-8}"
  "LC_ALL=${LC_ALL:-C.UTF-8}"
  "PATH=$PATH"
  "PLAYWRIGHT_BASE_URL=$PLAYWRIGHT_BASE_URL"
  "REAL_E2E_ADMIN_EMAIL=$REAL_E2E_ADMIN_EMAIL"
  "REAL_E2E_ADMIN_PASSWORD=$REAL_E2E_ADMIN_PASSWORD"
  "REAL_E2E_ADMIN_ROTATED_PASSWORD=$REAL_E2E_ADMIN_ROTATED_PASSWORD"
  "TMPDIR=${TMPDIR:-/tmp}"
)
env -i "${playwright_environment[@]}" \
  pnpm --filter @fiatlux/web exec playwright test --config playwright.real.config.ts
