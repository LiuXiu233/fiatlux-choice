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
用法：./scripts/upgrade.sh --to VERSION [--apply --confirm UPGRADE]

默认只输出 dry-run 计划。实际升级要求 --apply --confirm UPGRADE，并且只用于生产环境。
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

if [[ ! "$target" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "版本必须是不可变镜像标签，且只能包含字母、数字、点、下划线和连字符。" >&2
  exit 2
fi

current=${APP_IMAGE_TAG:-unknown}
if [[ -r "$STATE_DIR/current" ]]; then
  current=$(<"$STATE_DIR/current")
fi

cat <<EOF
升级计划（dry-run）：
  当前版本：$current
  目标版本：$target
  1. 校验生产 Compose 配置与镜像可用性
  2. 创建加密的升级前 PostgreSQL + MinIO 备份
  3. 拉取 api/worker/web/gateway/backup/minio 镜像
  4. 单独执行一次数据库迁移（迁移须满足 expand/contract 兼容）
  5. 滚动重建应用并等待健康检查
  6. 校验权限、安全参数、内网端口和 live/ready
  7. 记录 current/previous 版本
EOF

if [[ "$apply" == false ]]; then
  echo "未传入 --apply；没有修改运行环境。"
  exit 0
fi
if [[ "$confirmation" != UPGRADE ]]; then
  echo "实际升级必须传入 --confirm UPGRADE。" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-}" != production ]]; then
  echo "实际升级要求 FIATLUX_ENV=production。" >&2
  exit 2
fi
if [[ "$current" == "$target" ]]; then
  echo "目标版本与当前版本相同，拒绝无效升级。" >&2
  exit 2
fi

FIATLUX_VERSION_OVERRIDE=$target "$COMPOSE" config --quiet

echo "创建升级前加密备份。"
"$ROOT_DIR/scripts/backup.sh" --name "pre-upgrade-${current//[^A-Za-z0-9._-]/_}-$(date -u +%Y%m%dT%H%M%SZ)" --require-encryption

export FIATLUX_VERSION_OVERRIDE=$target
echo "拉取目标镜像。"
"$COMPOSE" pull api worker web caddy backup-tools minio

echo "执行一次性迁移。"
"$COMPOSE" run --rm migrate

echo "重建服务并等待健康。"
"$COMPOSE" up -d --wait --remove-orphans api worker web caddy

ca_file=${CADDY_ROOT_CA_FILE:-}
if [[ -z "$ca_file" ]]; then
  echo "升级后验证要求设置 CADDY_ROOT_CA_FILE。" >&2
  exit 5
fi
"$ROOT_DIR/scripts/verify-deployment.sh" --ca "$ca_file"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
printf '%s\n' "$current" >"$STATE_DIR/previous"
printf '%s\n' "$target" >"$STATE_DIR/current"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current" "$target" >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"

printf '升级完成：%s -> %s\n' "$current" "$target"
