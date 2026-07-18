#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env

usage() {
  cat <<'EOF'
用法：./scripts/backup.sh [--name NAME] [--recipient AGE_RECIPIENT] [--require-encryption]
       [--quiesce | --allow-live-writes]

生产环境始终要求 age 加密并默认暂停入口/API/worker，确保数据库与对象桶处于同一恢复点。
接收者也可通过 BACKUP_AGE_RECIPIENT 提供。
EOF
}

name=""
recipient=${BACKUP_AGE_RECIPIENT:-}
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

running_services=$("$COMPOSE" ps --status running --services)
if ! grep -qx postgres <<<"$running_services"; then
  echo "PostgreSQL 服务未运行，拒绝生成不完整备份。" >&2
  exit 3
fi
if ! grep -qx minio <<<"$running_services"; then
  echo "MinIO 服务未运行，拒绝生成不完整备份。" >&2
  exit 3
fi

services_to_resume=()
resume_services() {
  local status=$?
  trap - EXIT
  if ((${#services_to_resume[@]})); then
    echo "恢复备份前运行的应用服务。"
    if ! "$COMPOSE" up -d --wait --no-build --pull never "${services_to_resume[@]}"; then
      echo "备份后恢复应用服务失败，需要人工处理。" >&2
      if ((status == 0)); then
        status=6
      fi
    fi
  fi
  exit "$status"
}
trap resume_services EXIT

if [[ "$quiesce" == true ]]; then
  for service in caddy api worker; do
    if grep -qx "$service" <<<"$running_services"; then
      services_to_resume+=("$service")
    fi
  done
  if ((${#services_to_resume[@]})); then
    echo "暂停写入服务以生成一致恢复点：${services_to_resume[*]}"
    "$COMPOSE" stop "${services_to_resume[@]}"
  fi
else
  echo "警告：备份期间允许实时写入；PostgreSQL 与 MinIO 可能不属于同一业务恢复点。" >&2
fi

"$COMPOSE" run --rm --no-deps --pull never \
  -e "BACKUP_NAME=$name" \
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
  "$COMPOSE" run --rm --no-deps --pull never \
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
