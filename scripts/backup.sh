#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE=${FIATLUX_COMPOSE_SCRIPT:-$ROOT_DIR/scripts/compose.sh}
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
# shellcheck source=scripts/lib/maintenance-lock.sh
source "$ROOT_DIR/scripts/lib/maintenance-lock.sh"

usage() {
  cat <<'EOF'
用法：./scripts/backup.sh [--name NAME] [--recipient AGE_RECIPIENT] [--require-encryption]
       [--backup-image-version VERSION]
       [--quiesce | --allow-live-writes]

生产环境始终要求 age 加密并默认暂停入口/API/worker，确保数据库与对象桶处于同一恢复点。
接收者也可通过 BACKUP_AGE_RECIPIENT 提供。
EOF
}

name=""
recipient=${BACKUP_AGE_RECIPIENT:-}
source_id=${BACKUP_SOURCE_ID:-}
backup_image_version=""
require_encryption=false
if [[ "${FIATLUX_ENV:-development}" == production ]]; then
  quiesce=true
else
  quiesce=false
fi
while (($#)); do
  case "$1" in
    --name)
      name=${2:?--name 需要值}
      shift 2
      ;;
    --recipient)
      recipient=${2:?--recipient 需要值}
      shift 2
      ;;
    --require-encryption)
      require_encryption=true
      shift
      ;;
    --backup-image-version)
      backup_image_version=${2:?--backup-image-version 需要版本}
      shift 2
      ;;
    --quiesce)
      quiesce=true
      shift
      ;;
    --allow-live-writes)
      quiesce=false
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

if [[ "${FIATLUX_ENV:-development}" == production ]]; then
  require_encryption=true
fi
if [[ "$require_encryption" == true && -z "$recipient" ]]; then
  echo "备份要求加密，但未设置 BACKUP_AGE_RECIPIENT。" >&2
  exit 2
fi
if [[ -z "$source_id" ]]; then
  if [[ "${FIATLUX_ENV:-development}" == production ]]; then
    echo "生产备份要求设置稳定且唯一的 BACKUP_SOURCE_ID。" >&2
    exit 2
  fi
  source_id=fiatlux-development
fi
if ((${#source_id} > 128)) || [[ ! "$source_id" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "BACKUP_SOURCE_ID 只能包含字母、数字、点、下划线、冒号和连字符，最多 128 字符。" >&2
  exit 2
fi
if [[ -n "$backup_image_version" ]] &&
  [[ ! "$backup_image_version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "--backup-image-version 必须是 vMAJOR.MINOR.PATCH[-PRERELEASE]。" >&2
  exit 2
fi

if [[ -n "$backup_image_version" ]]; then
  backup_tool_release=$backup_image_version
else
  release_state=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}/current
  if [[ -r "$release_state" ]]; then
    backup_tool_release=$(<"$release_state")
  else
    backup_tool_release=${APP_IMAGE_TAG:-local}
  fi
fi
if ((${#backup_tool_release} > 128)) || [[ ! "$backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "无法确定安全的 backup tool release 标识。" >&2
  exit 2
fi

if [[ -z "$name" ]]; then
  name="fiatlux-$(date -u +%Y%m%dT%H%M%SZ)"
fi
if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "备份名称只能包含字母、数字、点、下划线和连字符。" >&2
  exit 2
fi

backup_dir=${BACKUP_DIR:-$ROOT_DIR/backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd -P)

export BACKUP_DIR="$backup_dir"
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}

if [[ "${FIATLUX_ENV:-development}" == production && -z "${BACKUP_SCRATCH_DIR:-}" ]]; then
  echo "生产备份要求显式设置位于受保护加密文件系统的 BACKUP_SCRATCH_DIR。" >&2
  exit 2
fi
backup_scratch_dir=${BACKUP_SCRATCH_DIR:-$ROOT_DIR/tmp/backup-scratch}
mkdir -p "$backup_scratch_dir"
chmod 700 "$backup_scratch_dir"
backup_scratch_dir=$(cd "$backup_scratch_dir" && pwd -P)
export BACKUP_SCRATCH_DIR=$backup_scratch_dir

services_to_resume=()
service_container_ids=()
cleanup_backup() {
  local status=$?
  local current_container_id
  local index
  local resume_safe=true
  trap - EXIT HUP INT TERM
  if ((${#services_to_resume[@]})); then
    echo "恢复备份前运行的应用服务。"
    for index in "${!services_to_resume[@]}"; do
      current_container_id=$("$COMPOSE" ps --all --quiet "${services_to_resume[$index]}")
      if [[ "$current_container_id" != "${service_container_ids[$index]}" ]]; then
        printf '服务 %s 的容器在备份期间消失或被替换，拒绝创建/重建：期望 %s，实际 %s。\n' \
          "${services_to_resume[$index]}" "${service_container_ids[$index]}" \
          "${current_container_id:-missing}" >&2
        resume_safe=false
      fi
    done
    if [[ "$resume_safe" == true ]] && ! "$COMPOSE" up -d --wait --no-deps \
      --no-recreate --no-build --pull never "${services_to_resume[@]}"; then
      resume_safe=false
    fi
    if [[ "$resume_safe" == true ]]; then
      for index in "${!services_to_resume[@]}"; do
        current_container_id=$("$COMPOSE" ps --all --quiet "${services_to_resume[$index]}")
        if [[ "$current_container_id" != "${service_container_ids[$index]}" ]]; then
          printf '服务 %s 在恢复期间被替换：期望 %s，实际 %s。\n' \
            "${services_to_resume[$index]}" "${service_container_ids[$index]}" \
            "${current_container_id:-missing}" >&2
          resume_safe=false
        fi
      done
    fi
    if [[ "$resume_safe" != true ]]; then
      echo "备份后恢复应用服务失败，需要人工处理。" >&2
      if ((status == 0)); then
        status=6
      fi
    fi
  fi
  if ! maintenance_lock_release; then
    if ((status == 0)); then
      status=7
    fi
  fi
  exit "$status"
}
trap cleanup_backup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

maintenance_lock_acquire "$backup_dir" "backup-$name"

shopt -s nullglob
backup_residue=("$backup_dir"/.*.partial "$backup_dir"/*.partial)
shopt -u nullglob
if ((${#backup_residue[@]})); then
  printf '备份目录存在上次异常遗留的 partial，拒绝自动删除：%s\n' "${backup_residue[0]}" >&2
  exit 5
fi
stale_scratch=$(find "$backup_scratch_dir" -mindepth 1 -maxdepth 1 -print -quit)
if [[ -n "$stale_scratch" ]]; then
  printf '备份明文工作区存在陈旧内容，拒绝自动删除：%s\n' "$stale_scratch" >&2
  exit 5
fi

running_services=$("$COMPOSE" ps --status running --services)
if ! grep -qx postgres <<<"$running_services"; then
  echo "PostgreSQL 服务未运行，拒绝生成不完整备份。" >&2
  exit 3
fi
if ! grep -qx minio <<<"$running_services"; then
  echo "MinIO 服务未运行，拒绝生成不完整备份。" >&2
  exit 3
fi

run_backup_tools() {
  if [[ -n "$backup_image_version" ]]; then
    FIATLUX_VERSION_OVERRIDE=$backup_image_version "$COMPOSE" "$@"
  else
    "$COMPOSE" "$@"
  fi
}

if [[ "$quiesce" == true ]]; then
  for service in caddy api worker; do
    if grep -qx "$service" <<<"$running_services"; then
      services_to_resume+=("$service")
      container_id=$("$COMPOSE" ps --all --quiet "$service")
      if [[ -z "$container_id" || "$container_id" == *$'\n'* ]]; then
        printf '运行服务 %s 必须恰好对应一个容器，拒绝备份。\n' "$service" >&2
        exit 3
      fi
      service_container_ids+=("$container_id")
    fi
  done
  if ((${#services_to_resume[@]})); then
    echo "暂停写入服务以生成一致恢复点：${services_to_resume[*]}"
    "$COMPOSE" stop "${services_to_resume[@]}"
  fi
else
  echo "警告：备份期间允许实时写入；PostgreSQL 与 MinIO 可能不属于同一业务恢复点。" >&2
fi

run_backup_tools run --rm --no-deps --pull never \
  -e "BACKUP_NAME=$name" \
  -e "BACKUP_SOURCE_ID=$source_id" \
  -e "BACKUP_TOOL_RELEASE=$backup_tool_release" \
  -e "BACKUP_AGE_RECIPIENT=$recipient" \
  -e "BACKUP_REQUIRE_ENCRYPTION=$require_encryption" \
  backup-tools backup-container

if [[ -n "$recipient" && -n "${FIATLUX_ENV_FILE:-}" && -r "$FIATLUX_ENV_FILE" ]]; then
  echo "加密保存部署配置副本（不包含 age 私钥）。"
  config_mounts=(-v "$FIATLUX_ENV_FILE:/run/backup-input/production.env:ro")
  release_state_dir=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}
  if [[ -d "$release_state_dir" ]]; then
    release_state_dir=$(cd "$release_state_dir" && pwd -P)
    config_mounts+=( -v "$release_state_dir:/run/backup-input/releases:ro" )
  fi
  # Variables in this command are intentionally expanded inside backup-tools.
  # shellcheck disable=SC2016
  run_backup_tools run --rm --no-deps --pull never \
    "${config_mounts[@]}" \
    -e "CONFIG_BACKUP_NAME=$name" \
    -e "CONFIG_BACKUP_RECIPIENT=$recipient" \
    backup-tools sh -ec '
      umask 077
      output="/backups/$CONFIG_BACKUP_NAME.config.tar.gz.age"
      [ ! -e "$output" ] || { echo "配置备份已存在：$output" >&2; exit 3; }
      mkdir -p /tmp/config-input
      cp /run/backup-input/production.env /tmp/config-input/production.env
      if [ -d /run/backup-input/releases ]; then
        cp -R /run/backup-input/releases /tmp/config-input/releases
      fi
      tar -C /tmp/config-input -czf /tmp/config.tar.gz .
      age --recipient "$CONFIG_BACKUP_RECIPIENT" --output "$output.partial" /tmp/config.tar.gz
      mv "$output.partial" "$output"
      sha256sum "$output"
    '
elif [[ "${FIATLUX_ENV:-development}" == production ]]; then
  echo "生产数据备份已完成，但未找到可读的 FIATLUX_ENV_FILE，配置副本未生成。" >&2
  exit 5
fi
