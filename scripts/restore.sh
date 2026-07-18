#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env

usage() {
  cat <<'EOF'
用法：./scripts/restore.sh --file FILE --confirm-database DB --confirm-bucket BUCKET \
       --approve YES-I-UNDERSTAND [--identity AGE_IDENTITY] [--skip-pre-backup]

本命令会停止应用、替换目标数据库和对象桶，然后执行迁移并重新启动。
EOF
}

backup_file=""
database_confirmation=""
bucket_confirmation=""
approval=""
identity_file=""
skip_pre_backup=false

while (($#)); do
  case "$1" in
    --file)
      backup_file=${2:?--file 需要值}
      shift 2
      ;;
    --confirm-database)
      database_confirmation=${2:?--confirm-database 需要值}
      shift 2
      ;;
    --confirm-bucket)
      bucket_confirmation=${2:?--confirm-bucket 需要值}
      shift 2
      ;;
    --approve)
      approval=${2:?--approve 需要值}
      shift 2
      ;;
    --identity)
      identity_file=${2:?--identity 需要值}
      shift 2
      ;;
    --skip-pre-backup)
      skip_pre_backup=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$backup_file" || -z "$database_confirmation" || -z "$bucket_confirmation" ]]; then
  usage >&2
  exit 2
fi
if [[ "$approval" != YES-I-UNDERSTAND ]]; then
  echo "必须显式传入 --approve YES-I-UNDERSTAND。" >&2
  exit 2
fi
if [[ ! -f "$backup_file" ]]; then
  printf '找不到备份文件：%s\n' "$backup_file" >&2
  exit 3
fi
if [[ "$backup_file" == *.age && -z "$identity_file" ]]; then
  echo "加密备份需要 --identity。" >&2
  exit 2
fi
if [[ -n "$identity_file" && ! -r "$identity_file" ]]; then
  printf '无法读取 age 身份文件：%s\n' "$identity_file" >&2
  exit 3
fi

target_database=${POSTGRES_DB:-fiatlux_choice}
target_bucket=${S3_BUCKET:-fiatlux-choice}
if [[ "$database_confirmation" != "$target_database" || "$bucket_confirmation" != "$target_bucket" ]]; then
  printf '确认值必须精确匹配目标：数据库=%s，对象桶=%s。\n' "$target_database" "$target_bucket" >&2
  exit 2
fi

backup_dir=$(cd "$(dirname "$backup_file")" && pwd -P)
backup_basename=$(basename "$backup_file")
backup_file="$backup_dir/$backup_basename"
export BACKUP_DIR="$backup_dir"
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}

if [[ "$skip_pre_backup" == false ]]; then
  pre_name="pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  "$ROOT_DIR/scripts/backup.sh" --name "$pre_name" --require-encryption
else
  echo "警告：已明确跳过恢复前备份。"
fi

echo "进入维护窗口：停止入口、API 和 worker。"
"$COMPOSE" stop caddy api worker

run_args=(
  run --rm --no-deps --pull never
  -e "BACKUP_FILE=/backups/$backup_basename"
  -e "RESTORE_CONFIRM_DATABASE=$target_database"
  -e "RESTORE_CONFIRM_BUCKET=$target_bucket"
  -e RESTORE_APPROVED=YES-I-UNDERSTAND
)
if [[ -n "$identity_file" ]]; then
  identity_file=$(cd "$(dirname "$identity_file")" && pwd -P)/$(basename "$identity_file")
  run_args+=( -T -e BACKUP_AGE_IDENTITY_STDIN=true )
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container <"$identity_file"
else
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container
fi

echo "执行当前版本数据库迁移。"
"$COMPOSE" run --rm --pull never migrate

echo "重新启动并等待健康检查。"
"$COMPOSE" up -d --wait --no-build --pull never api worker web caddy
"$ROOT_DIR/scripts/verify-deployment.sh"
