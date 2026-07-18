#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
unset FIATLUX_ENV_FILE LLM_BASE_URL LLM_API_KEY LLM_MODEL GITHUB_TOKEN
export LLM_DRIVER=mock
export GITHUB_INTEGRATION_MODE=manual

usage() {
  cat <<'EOF'
用法：./scripts/restore-drill.sh --file FILE [--identity AGE_IDENTITY]

在随机 Compose 项目和全新卷中恢复；默认结束后销毁演练环境。
设置 KEEP_RESTORE_STACK=1 可在故障调查时保留环境。
EOF
}

backup_file=""
identity_file=""
while (($#)); do
  case "$1" in
    --file)
      backup_file=${2:?--file 需要值}
      shift 2
      ;;
    --identity)
      identity_file=${2:?--identity 需要值}
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  usage >&2
  exit 2
fi
if [[ "$backup_file" == *.age && -z "$identity_file" ]]; then
  echo "加密备份需要 --identity。" >&2
  exit 2
fi
if [[ -n "$identity_file" && ! -r "$identity_file" ]]; then
  printf '无法读取 age 身份文件：%s\n' "$identity_file" >&2
  exit 3
fi

stamp=$(date -u +%Y%m%d%H%M%S)
export COMPOSE_PROJECT_NAME="fiatlux-restore-$stamp-$$"
if [[ ! "$COMPOSE_PROJECT_NAME" =~ ^fiatlux-restore-[A-Za-z0-9-]+$ ]]; then
  echo "演练项目名安全检查失败。" >&2
  exit 4
fi

backup_dir=$(cd "$(dirname "$backup_file")" && pwd -P)
backup_basename=$(basename "$backup_file")
export BACKUP_DIR="$backup_dir"
export FIATLUX_ENV=development
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}
export POSTGRES_DB=fiatlux_restore
export POSTGRES_USER=fiatlux_restore
POSTGRES_PASSWORD=$(openssl rand -hex 24)
export POSTGRES_PASSWORD
export S3_BUCKET=fiatlux-restore
export MINIO_ROOT_USER=fiatluxrestore
MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
export MINIO_ROOT_PASSWORD SESSION_SECRET
export INITIAL_ADMIN_EMAIL=restore-drill@fiatlux.local
INITIAL_ADMIN_PASSWORD=$(openssl rand -hex 24)
export INITIAL_ADMIN_PASSWORD

report="$backup_dir/restore-drill-$stamp.log"
exec > >(tee -a "$report") 2>&1

cleanup() {
  status=$?
  if [[ "${KEEP_RESTORE_STACK:-0}" == 1 ]]; then
    printf '保留演练环境：COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
  else
    if [[ "$COMPOSE_PROJECT_NAME" == fiatlux-restore-* ]]; then
      "$COMPOSE" down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
  fi
  printf '恢复演练报告：%s\n' "$report"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

echo "启动隔离的 PostgreSQL 与 MinIO：$COMPOSE_PROJECT_NAME"
"$COMPOSE" up -d --wait --no-build --pull never postgres minio

run_args=(
  run --rm --no-deps --pull never
  -e "BACKUP_FILE=/backups/$backup_basename"
  -e "RESTORE_CONFIRM_DATABASE=$POSTGRES_DB"
  -e "RESTORE_CONFIRM_BUCKET=$S3_BUCKET"
  -e RESTORE_APPROVED=YES-I-UNDERSTAND
)
if [[ -n "$identity_file" ]]; then
  identity_file=$(cd "$(dirname "$identity_file")" && pwd -P)/$(basename "$identity_file")
  run_args+=( -T -e BACKUP_AGE_IDENTITY_STDIN=true )
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container <"$identity_file"
else
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container
fi

echo "在恢复数据上执行当前迁移。"
"$COMPOSE" run --rm --pull never migrate

echo "启动 API 与 worker，等待应用健康。"
"$COMPOSE" up -d --wait --no-build --pull never api worker
"$COMPOSE" exec -T api node -e \
  "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

table_output=$("$COMPOSE" run --rm --no-deps --pull never backup-tools sh -ec \
  'export PGPASSWORD; psql -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\''"')
table_count=$(awk '/^[0-9]+$/{value=$0} END{print value}' <<<"$table_output")
if [[ ! "$table_count" =~ ^[0-9]+$ ]] || ((table_count == 0)); then
  printf '恢复数据库未发现业务表：%s\n' "$table_count" >&2
  exit 5
fi

# Variables in this command are intentionally expanded inside backup-tools.
# shellcheck disable=SC2016
object_output=$("$COMPOSE" run --rm --no-deps --pull never backup-tools sh -ec \
  'set -o pipefail; mc alias set verify "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null; mc ls --recursive --json "verify/$S3_BUCKET" | jq -s '\''[.[] | select(.type == "file")] | length'\''')
object_count=$(awk '/^[0-9]+$/{value=$0} END{print value}' <<<"$object_output")
if [[ ! "$object_count" =~ ^[0-9]+$ ]]; then
  printf '恢复对象计数无效：%s\n' "$object_count" >&2
  exit 6
fi

printf '恢复演练通过：业务表=%s，对象=%s。\n' "$table_count" "$object_count"
