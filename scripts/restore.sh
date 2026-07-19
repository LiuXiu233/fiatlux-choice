#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE=${FIATLUX_COMPOSE_SCRIPT:-$ROOT_DIR/scripts/compose.sh}
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
# shellcheck source=scripts/lib/maintenance-lock.sh
source "$ROOT_DIR/scripts/lib/maintenance-lock.sh"
# shellcheck source=scripts/lib/postgres-release.sh
source "$ROOT_DIR/scripts/lib/postgres-release.sh"
STATE_DIR=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}

usage() {
  cat <<'EOF'
用法：./scripts/restore.sh --file FILE --confirm-database DB --confirm-bucket BUCKET \
       --expected-sha256 SHA256 --expected-source-id SOURCE_ID \
       [--expected-source-database DB --expected-source-bucket BUCKET] \
       --restore-image-version VERSION --release-manifest FILE \
       --manifest-sha256 SHA256 --expected-git-sha GIT_SHA \
       [--expected-backup-tool-release VERSION] \
       [--confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED] \
       --approve YES-I-UNDERSTAND \
       [--identity AGE_IDENTITY] [--skip-pre-backup]

本命令会停止应用、替换目标数据库和对象桶，然后执行迁移并重新启动。
归档源以只读方式挂载；默认恢复前备份写入 RESTORE_PRE_BACKUP_DIR（生产必须显式配置独立的受保护可写目录）。
EOF
}

backup_file=""
runtime_backup_dir=${BACKUP_DIR:-$ROOT_DIR/backups}
restore_pre_backup_dir=${RESTORE_PRE_BACKUP_DIR:-}
database_confirmation=""
bucket_confirmation=""
approval=""
identity_file=""
expected_sha256=${BACKUP_EXPECTED_SHA256:-}
expected_source_id=${RESTORE_EXPECTED_SOURCE_ID:-}
expected_source_database=${RESTORE_EXPECTED_SOURCE_DATABASE:-}
expected_source_bucket=${RESTORE_EXPECTED_SOURCE_BUCKET:-}
restore_image_version=""
expected_backup_tool_release=${RESTORE_EXPECTED_BACKUP_TOOL_RELEASE:-}
release_manifest=""
manifest_sha256=${RELEASE_MANIFEST_SHA256:-}
expected_git_sha=${RELEASE_EXPECTED_GIT_SHA:-}
skip_pre_backup=false
postgres_minor_rollback_confirmation=""

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
    --expected-sha256)
      expected_sha256=${2:?--expected-sha256 需要值}
      shift 2
      ;;
    --expected-source-id)
      expected_source_id=${2:?--expected-source-id 需要值}
      shift 2
      ;;
    --expected-source-database)
      expected_source_database=${2:?--expected-source-database 需要值}
      shift 2
      ;;
    --expected-source-bucket)
      expected_source_bucket=${2:?--expected-source-bucket 需要值}
      shift 2
      ;;
    --restore-image-version)
      restore_image_version=${2:?--restore-image-version 需要值}
      shift 2
      ;;
    --expected-backup-tool-release)
      expected_backup_tool_release=${2:?--expected-backup-tool-release 需要值}
      shift 2
      ;;
    --release-manifest)
      release_manifest=${2:?--release-manifest 需要值}
      shift 2
      ;;
    --manifest-sha256)
      manifest_sha256=${2:?--manifest-sha256 需要值}
      shift 2
      ;;
    --expected-git-sha)
      expected_git_sha=${2:?--expected-git-sha 需要值}
      shift 2
      ;;
    --confirm-postgres-minor-rollback)
      postgres_minor_rollback_confirmation=${2:?--confirm-postgres-minor-rollback 需要值}
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
if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "必须通过受控审批记录提供 64 位小写 --expected-sha256；不得自动信任备份旁的 sidecar。" >&2
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
if [[ "${FIATLUX_ENV:-development}" == production && -z "$restore_pre_backup_dir" ]]; then
  echo "生产恢复要求显式设置独立的 RESTORE_PRE_BACKUP_DIR；归档源可以保持只读挂载。" >&2
  exit 2
fi
if [[ -z "${POSTGRES_RESTORE_PASSWORD:-}" ]]; then
  echo "恢复要求设置独立的 POSTGRES_RESTORE_PASSWORD。" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-development}" == production ]] &&
  [[ -z "${S3_RESTORE_ACCESS_KEY_ID:-}" || -z "${S3_RESTORE_SECRET_ACCESS_KEY:-}" ]]; then
  echo "生产恢复要求设置独立的 S3_RESTORE_ACCESS_KEY_ID/S3_RESTORE_SECRET_ACCESS_KEY。" >&2
  exit 2
fi
restore_access_key=${S3_RESTORE_ACCESS_KEY_ID:-fiatlux-restore}
restore_secret_key=${S3_RESTORE_SECRET_ACCESS_KEY:-fiatlux-dev-restore-password}

target_database=${POSTGRES_DB:-fiatlux_choice}
target_bucket=${S3_BUCKET:-fiatlux-choice}
expected_source_database=${expected_source_database:-$target_database}
expected_source_bucket=${expected_source_bucket:-$target_bucket}
if ((${#expected_source_id} > 128)) || [[ ! "$expected_source_id" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "必须提供受审的 --expected-source-id（最多 128 位安全字符）。" >&2
  exit 2
fi
if [[ ! "$expected_source_database" =~ ^[A-Za-z0-9_]+$ ]] ||
  [[ ! "$expected_source_bucket" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "预期来源数据库或对象桶格式无效。" >&2
  exit 2
fi
if [[ ! "$restore_image_version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "破坏性恢复要求 --restore-image-version 为 vMAJOR.MINOR.PATCH[-PRERELEASE]。" >&2
  exit 2
fi
expected_backup_tool_release=${expected_backup_tool_release:-$restore_image_version}
if ((${#expected_backup_tool_release} > 128)) ||
  [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "--expected-backup-tool-release 格式无效。" >&2
  exit 2
fi
if [[ -z "$release_manifest" || ! -f "$release_manifest" || -L "$release_manifest" ]]; then
  echo "破坏性恢复要求 --release-manifest 指向恢复工具版本的受审七组件清单。" >&2
  exit 2
fi
if [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "破坏性恢复要求独立受审的 64 位小写 --manifest-sha256。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "破坏性恢复要求 --expected-git-sha 提供受审恢复发布的完整 commit ID。" >&2
  exit 2
fi
if [[ "$database_confirmation" != "$target_database" || "$bucket_confirmation" != "$target_bucket" ]]; then
  printf '确认值必须精确匹配目标：数据库=%s，对象桶=%s。\n' "$target_database" "$target_bucket" >&2
  exit 2
fi

release_manifest=$(cd "$(dirname "$release_manifest")" && pwd -P)/$(basename "$release_manifest")
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --manifest-only
"$ROOT_DIR/scripts/verify-deployment-source.sh" --expected-git-sha "$expected_git_sha"

source_backup_dir=$(cd "$(dirname "$backup_file")" && pwd -P)
backup_basename=$(basename "$backup_file")
backup_file="$source_backup_dir/$backup_basename"
if [[ ! -r "$backup_file" ]]; then
  printf '恢复归档不可读：%s\n' "$backup_file" >&2
  exit 3
fi
archive_size=$(wc -c <"$backup_file" | tr -d '[:space:]')
if [[ ! "$archive_size" =~ ^[0-9]+$ ]]; then
  echo "无法读取恢复归档大小，拒绝继续。" >&2
  exit 3
fi
if [[ -z "$restore_pre_backup_dir" ]]; then
  restore_pre_backup_dir="$ROOT_DIR/tmp/restore-pre-backups"
fi
if [[ -e "$restore_pre_backup_dir" && -L "$restore_pre_backup_dir" ]]; then
  echo "RESTORE_PRE_BACKUP_DIR 不得是符号链接，拒绝继续。" >&2
  exit 2
fi
if [[ "$restore_pre_backup_dir" != /* ]]; then
  restore_pre_backup_dir="$ROOT_DIR/$restore_pre_backup_dir"
fi
if [[ -e "$restore_pre_backup_dir" && ! -d "$restore_pre_backup_dir" ]]; then
  printf 'RESTORE_PRE_BACKUP_DIR 不是目录：%s\n' "$restore_pre_backup_dir" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-development}" == production && -z "${FIATLUX_MAINTENANCE_DIR:-}" ]]; then
  echo "生产恢复要求显式设置稳定的 FIATLUX_MAINTENANCE_DIR。" >&2
  exit 2
fi
if [[ -z "${FIATLUX_MAINTENANCE_DIR:-}" ]]; then
  export FIATLUX_MAINTENANCE_DIR="$ROOT_DIR/tmp/maintenance"
fi
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}
if [[ "${FIATLUX_ENV:-development}" == production && -z "${RESTORE_SCRATCH_DIR:-}" ]]; then
  echo "生产恢复要求显式设置位于受保护加密文件系统的 RESTORE_SCRATCH_DIR。" >&2
  exit 2
fi
restore_scratch_dir=${RESTORE_SCRATCH_DIR:-$ROOT_DIR/tmp/restore-scratch}
mkdir -p "$restore_scratch_dir"
chmod 700 "$restore_scratch_dir"
restore_scratch_dir=$(cd "$restore_scratch_dir" && pwd -P)
export RESTORE_SCRATCH_DIR=$restore_scratch_dir

maintenance_lock_acquire "$source_backup_dir" "restore-$backup_basename"
release_maintenance_lock() {
  local status=$?
  trap - EXIT HUP INT TERM
  if ! maintenance_lock_release && ((status == 0)); then
    status=7
  fi
  exit "$status"
}
trap release_maintenance_lock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

available_bytes() {
  local available_kib
  available_kib=$(df -Pk "$1" | awk 'END {print $4}')
  case "$available_kib" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo $((available_kib * 1024))
}

check_pre_backup_directory() {
  local directory=$1
  local label=$2
  local probe
  local free_bytes
  local required_bytes
  local capacity_margin=$((64 * 1024 * 1024))

  if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ]]; then
    printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
    return 2
  fi
  if [[ -e "$directory" ]]; then
    if [[ ! -d "$directory" ]]; then
      printf '%s 不是目录：%s\n' "$label" "$directory" >&2
      return 2
    fi
    directory=$(cd "$directory" && pwd -P)
    if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ||
      "$source_backup_dir" == "$directory/"* ]]; then
      printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
      return 2
    fi
  fi
  mkdir -p "$directory"
  directory=$(cd "$directory" && pwd -P)
  if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ||
    "$source_backup_dir" == "$directory/"* ]]; then
    printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
    return 2
  fi
  chmod 700 "$directory"
  probe="$directory/.fiatlux-restore-output-probe.$$"
  if [[ -e "$probe" || -L "$probe" ]]; then
    printf '%s 存在未解释的探针残留，拒绝继续：%s\n' "$label" "$probe" >&2
    return 5
  fi
  if ! (umask 077; : >"$probe") 2>/dev/null; then
    printf '%s 不可写，拒绝在破坏性恢复前继续：%s\n' "$label" "$directory" >&2
    return 2
  fi
  rm -f "$probe"
  if ((archive_size > (9223372036854775807 - capacity_margin) / 2)); then
    echo "恢复归档过大，无法安全计算恢复前备份容量下限。" >&2
    return 2
  fi
  required_bytes=$((archive_size * 2 + capacity_margin))
  if ! free_bytes=$(available_bytes "$directory") || ((free_bytes < required_bytes)); then
    printf '%s 可用空间不足：至少需要 %s bytes，实际 %s bytes。\n' \
      "$label" "$required_bytes" "${free_bytes:-unknown}" >&2
    return 2
  fi
}

if [[ "$skip_pre_backup" == false ]]; then
  check_pre_backup_directory "$restore_pre_backup_dir" "RESTORE_PRE_BACKUP_DIR"
  restore_pre_backup_dir=$(cd "$restore_pre_backup_dir" && pwd -P)
  backup_scratch_dir=${BACKUP_SCRATCH_DIR:-$ROOT_DIR/tmp/backup-scratch}
  if [[ "${FIATLUX_ENV:-development}" == production && -z "${BACKUP_SCRATCH_DIR:-}" ]]; then
    echo "生产恢复要求显式设置位于受保护加密文件系统的 BACKUP_SCRATCH_DIR。" >&2
    exit 2
  fi
  check_pre_backup_directory "$backup_scratch_dir" "BACKUP_SCRATCH_DIR"
  backup_scratch_dir=$(cd "$backup_scratch_dir" && pwd -P)
  if [[ "$backup_scratch_dir" == "$restore_pre_backup_dir" ]]; then
    echo "RESTORE_PRE_BACKUP_DIR 与 BACKUP_SCRATCH_DIR 必须是不同目录。" >&2
    exit 2
  fi
  export RESTORE_PRE_BACKUP_DIR="$restore_pre_backup_dir"
  export BACKUP_SCRATCH_DIR="$backup_scratch_dir"
fi

# Compose mounts the source archive separately as /restore-source:ro.  The
# writable /backups mount is reserved for the pre-restore output and is reset to
# the normal deployment directory before the long-lived services are started.
export RESTORE_SOURCE_DIR="$source_backup_dir"
export BACKUP_DIR="$restore_pre_backup_dir"

current_release=${APP_IMAGE_TAG:-unknown}
if [[ -r "$STATE_DIR/current" ]]; then
  current_release=$(<"$STATE_DIR/current")
fi

echo "拉取并核验显式选择的恢复发布七镜像。"
FIATLUX_VERSION_OVERRIDE=$restore_image_version "$COMPOSE" pull \
  api worker web caddy backup-tools minio postgres
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256"

current_postgres_version=$(postgres_current_binary_version "$COMPOSE" "$current_release")
target_postgres_version=$(postgres_release_binary_version "$COMPOSE" "$restore_image_version")
postgres_assert_release_transition \
  restore "$current_postgres_version" "$target_postgres_version" \
  "$postgres_minor_rollback_confirmation"

if [[ "$skip_pre_backup" == false ]]; then
  pre_name="pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  "$ROOT_DIR/scripts/backup.sh" --name "$pre_name" \
    --backup-image-version "$restore_image_version" --require-encryption
else
  echo "警告：已明确跳过恢复前备份。"
fi

export FIATLUX_VERSION_OVERRIDE=$restore_image_version

echo "进入维护窗口：停止入口、API 和 worker。"
"$COMPOSE" stop caddy api worker
echo "在任何数据替换前切换已核验的恢复发布 PostgreSQL。"
"$COMPOSE" up -d --wait --no-deps --force-recreate --no-build --pull never postgres

run_args=(
  run --rm --no-deps --pull never
  -e "BACKUP_FILE=/restore-source/$backup_basename"
  -e "BACKUP_EXPECTED_SHA256=$expected_sha256"
  -e "RESTORE_EXPECTED_SOURCE_ID=$expected_source_id"
  -e "RESTORE_EXPECTED_SOURCE_DATABASE=$expected_source_database"
  -e "RESTORE_EXPECTED_SOURCE_BUCKET=$expected_source_bucket"
  -e "RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=$expected_backup_tool_release"
  -e "RESTORE_TOOL_RELEASE=$restore_image_version"
  -e "RESTORE_CONFIRM_DATABASE=$target_database"
  -e "RESTORE_CONFIRM_BUCKET=$target_bucket"
  -e RESTORE_APPROVED=YES-I-UNDERSTAND
  -e PGUSER=fiatlux_restore
  -e "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD"
  -e "S3_ACCESS_KEY_ID=$restore_access_key"
  -e "S3_SECRET_ACCESS_KEY=$restore_secret_key"
)
if [[ -n "$identity_file" ]]; then
  identity_file=$(cd "$(dirname "$identity_file")" && pwd -P)/$(basename "$identity_file")
  run_args+=( -T -e BACKUP_AGE_IDENTITY_STDIN=true )
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container <"$identity_file"
else
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container
fi

# Runtime services must continue to use the normal deployment backup volume;
# only the one-shot restore container reads the approved source mount.
export BACKUP_DIR="$runtime_backup_dir"

echo "执行显式恢复版本数据库迁移。"
"$COMPOSE" run --rm --no-deps --pull never migrate
echo "执行 pg-boss 迁移并重新收敛运行时授权。"
"$COMPOSE" run --rm --no-deps --pull never queue-migrate
"$COMPOSE" run --rm --no-deps --pull never database-permissions

echo "重新启动并等待健康检查。"
"$COMPOSE" up -d --wait --no-build --pull never minio minio-bootstrap api worker web caddy
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --check-running-services
"$ROOT_DIR/scripts/verify-deployment.sh"

mkdir -p "$STATE_DIR/manifests"
chmod 700 "$STATE_DIR" "$STATE_DIR/manifests"
manifest_record="$STATE_DIR/manifests/$restore_image_version.tsv"
manifest_record_partial="$STATE_DIR/manifests/.$restore_image_version.tsv.partial.$$"
install -m 600 "$release_manifest" "$manifest_record_partial"
recorded_manifest_sha256=$(sha256sum "$manifest_record_partial" | awk '{print $1}')
if [[ "$recorded_manifest_sha256" != "$manifest_sha256" ]]; then
  rm -f "$manifest_record_partial"
  echo "写入本机恢复发布状态时清单发生变化，拒绝记录版本。" >&2
  exit 6
fi
mv "$manifest_record_partial" "$manifest_record"
printf '%s  %s\n' "$manifest_sha256" "$restore_image_version.tsv" \
  >"$STATE_DIR/manifests/$restore_image_version.tsv.sha256"
chmod 600 "$STATE_DIR/manifests/$restore_image_version.tsv.sha256"
printf '%s\n' "$current_release" >"$STATE_DIR/previous"
printf '%s\n' "$restore_image_version" >"$STATE_DIR/current"
printf '%s\trestore\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current_release" "$restore_image_version" \
  "$expected_git_sha" "$manifest_sha256" "$expected_sha256" >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"
