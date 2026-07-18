#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
STATE_DIR=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}

usage() {
  cat <<'EOF'
用法：./scripts/rollback.sh [--to VERSION] [--apply --confirm APP-ONLY-ROLLBACK]

默认只输出 dry-run。回滚仅切换应用镜像，不自动执行数据库降级；不兼容时必须走备份恢复流程。
EOF
}

target=""
apply=false
confirmation=""
while (($#)); do
  case "$1" in
    --to)
      target=${2:?--to 需要版本}
      shift 2
      ;;
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
      exit 2
      ;;
  esac
done

if [[ -z "$target" && -r "$STATE_DIR/previous" ]]; then
  target=$(<"$STATE_DIR/previous")
fi
if [[ ! "$target" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "未找到有效回滚目标；请使用 --to 指定不可变镜像标签。" >&2
  exit 2
fi

current=${APP_IMAGE_TAG:-unknown}
if [[ -r "$STATE_DIR/current" ]]; then
  current=$(<"$STATE_DIR/current")
fi

cat <<EOF
回滚计划（dry-run）：
  当前版本：$current
  目标版本：$target
  1. 人工确认目标版本与当前数据库 schema 向后兼容
  2. 创建加密的回滚前备份
  3. 拉取旧版 api/worker/web/gateway 镜像
  4. 仅切换应用镜像，不执行数据库 down migration
  5. 等待健康检查并记录版本

若旧应用与当前 schema 不兼容，请停止本流程，使用 restore.sh 恢复升级前完整备份。
EOF

if [[ "$apply" == false ]]; then
  echo "未传入 --apply；没有修改运行环境。"
  exit 0
fi
if [[ "$confirmation" != APP-ONLY-ROLLBACK ]]; then
  echo "实际回滚必须传入 --confirm APP-ONLY-ROLLBACK。" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-}" != production ]]; then
  echo "实际回滚要求 FIATLUX_ENV=production。" >&2
  exit 2
fi
if [[ "$current" == "$target" ]]; then
  echo "回滚目标与当前版本相同。" >&2
  exit 2
fi

FIATLUX_VERSION_OVERRIDE=$target "$COMPOSE" config --quiet
"$ROOT_DIR/scripts/backup.sh" --name "pre-rollback-${current//[^A-Za-z0-9._-]/_}-$(date -u +%Y%m%dT%H%M%SZ)" --require-encryption
export FIATLUX_VERSION_OVERRIDE=$target
"$COMPOSE" pull api worker web caddy
"$COMPOSE" up -d --wait api worker web caddy

ca_file=${CADDY_ROOT_CA_FILE:-}
if [[ -z "$ca_file" ]]; then
  echo "回滚后验证要求设置 CADDY_ROOT_CA_FILE。" >&2
  exit 5
fi
"$ROOT_DIR/scripts/verify-deployment.sh" --ca "$ca_file"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
printf '%s\n' "$current" >"$STATE_DIR/previous"
printf '%s\n' "$target" >"$STATE_DIR/current"
printf '%s\trollback\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current" "$target" >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"

printf '应用版本回滚完成：%s -> %s；数据库 schema 未降级。\n' "$current" "$target"
