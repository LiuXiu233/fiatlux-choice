#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

release_state=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}/current
if [[ -n "${FIATLUX_VERSION_OVERRIDE:-}" ]]; then
  export APP_IMAGE_TAG=$FIATLUX_VERSION_OVERRIDE
elif [[ -r "$release_state" ]]; then
  APP_IMAGE_TAG=$(<"$release_state")
  export APP_IMAGE_TAG
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  cat >&2 <<'EOF'
未找到 Docker Compose v2 插件。
请安装官方 Compose CLI 插件后重试；不要使用已停止维护的 Compose v1。
macOS 可将官方插件安装到 ~/.docker/cli-plugins/docker-compose，或使用包管理器安装 docker-compose v2。
EOF
  exit 127
fi

version=$("${COMPOSE[@]}" version --short 2>/dev/null | sed 's/^v//')
major=${version%%.*}
if [[ ! "$major" =~ ^[0-9]+$ ]] || ((major < 2)); then
  printf '需要 Docker Compose v2，当前版本：%s\n' "$version" >&2
  exit 126
fi

environment=${FIATLUX_ENV:-development}
case "$environment" in
  development)
    FILES=(-f "$ROOT_DIR/compose.yml" -f "$ROOT_DIR/compose.dev.yml")
    ;;
  production)
    FILES=(-f "$ROOT_DIR/compose.yml" -f "$ROOT_DIR/compose.prod.yml")
    ;;
  *)
    printf '不支持 FIATLUX_ENV=%s；仅允许 development 或 production。\n' "$environment" >&2
    exit 2
    ;;
esac

COMPOSE_ARGS=(
  --project-directory "$ROOT_DIR"
  --project-name "${COMPOSE_PROJECT_NAME:-fiatlux-choice}"
)
if [[ -n "${FIATLUX_ENV_FILE:-}" ]]; then
  if [[ ! -f "$FIATLUX_ENV_FILE" ]]; then
    printf '找不到 FIATLUX_ENV_FILE：%s\n' "$FIATLUX_ENV_FILE" >&2
    exit 2
  fi
  COMPOSE_ARGS+=(--env-file "$FIATLUX_ENV_FILE")
fi
COMPOSE_ARGS+=("${FILES[@]}")

exec "${COMPOSE[@]}" \
  "${COMPOSE_ARGS[@]}" \
  "$@"
