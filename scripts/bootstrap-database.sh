#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE=${FIATLUX_COMPOSE_SCRIPT:-$ROOT_DIR/scripts/compose.sh}
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
# shellcheck source=scripts/lib/maintenance-lock.sh
source "$ROOT_DIR/scripts/lib/maintenance-lock.sh"

apply=false
confirmation=""
if [[ "${FIATLUX_ENV:-development}" != production ]]; then
  apply=true
fi

usage() {
  cat <<'EOF'
用法：./scripts/bootstrap-database.sh [--apply --confirm DATABASE-BOOTSTRAP]

创建或轮换 PostgreSQL 最小权限角色，转移旧单角色部署的应用对象所有权，然后执行
业务迁移、pg-boss 迁移和运行时授权收敛。生产环境必须先停止入口/API/worker，且显式确认。
EOF
}

while (($#)); do
  case "$1" in
    --apply)
      apply=true
      shift
      ;;
    --confirm)
      confirmation=${2:?--confirm 需要值}
      shift 2
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
  if [[ "$apply" != true || "$confirmation" != DATABASE-BOOTSTRAP ]]; then
    cat <<'EOF'
生产数据库角色引导计划（未执行）：
  1. 启动并等待 PostgreSQL
  2. 在 --rm 一次性容器中创建/轮换 migrator、runtime、backup、restore
  3. 将目标库和既有应用对象所有权交给 migrator
  4. 执行业务 schema 与 pg-boss schema 迁移
  5. 收敛 runtime 权限并强制审计追加写

实际执行前停止 caddy、api、worker，并传入 --apply --confirm DATABASE-BOOTSTRAP。
EOF
    exit 0
  fi

  running_services=$($COMPOSE ps --status running --services 2>/dev/null || true)
  for service in caddy api worker; do
    if grep -qx "$service" <<<"$running_services"; then
      printf '生产角色引导前必须停止 %s，避免密码轮换和所有权迁移期间继续写入。\n' "$service" >&2
      exit 3
    fi
  done
fi

maintenance_lock_acquire "${BACKUP_DIR:-$ROOT_DIR/backups}" database-bootstrap
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

$COMPOSE config --quiet
$COMPOSE up -d --wait --no-build --pull never postgres

echo "在自动删除的一次性容器中创建或轮换数据库角色。"
$COMPOSE run --rm --no-deps --pull never db-bootstrap

echo "执行 Drizzle 业务迁移。"
$COMPOSE run --rm --no-deps --pull never migrate

echo "执行 pg-boss schema 与声明队列迁移。"
$COMPOSE run --rm --no-deps --pull never queue-migrate

echo "收敛应用运行时授权。"
$COMPOSE run --rm --no-deps --pull never database-permissions

echo "数据库角色分离、迁移与权限收敛完成。"
