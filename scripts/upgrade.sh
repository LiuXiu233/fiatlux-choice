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
用法：./scripts/upgrade.sh --to VERSION \
       [--release-manifest FILE --manifest-sha256 SHA256 \
        --expected-git-sha GIT_SHA] \
       [--apply --confirm UPGRADE]

默认只输出 dry-run 计划。实际升级还必须提供受审的七组件发布清单及其独立批准 SHA-256。
EOF
}

target=""
apply=false
confirmation=""
release_manifest=""
manifest_sha256=${RELEASE_MANIFEST_SHA256:-}
expected_git_sha=${RELEASE_EXPECTED_GIT_SHA:-}
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
  2. 校验受审 Git SHA、clean 本地部署资产、发布清单 SHA-256 与七个组件条目
  3. 拉取七个组件并逐一核对本地 RepoDigest
  4. 使用已核验的目标 backup image 创建加密的 PostgreSQL + MinIO 恢复点
  5. 禁止 PostgreSQL major 变化或 minor 回退，停止写入方后切换已核验的目标 PostgreSQL
  6. 单独执行业务与 pg-boss 迁移，再重新收敛运行时授权（迁移须满足 expand/contract 兼容）
  7. 滚动重建应用并等待健康检查
  8. 校验权限、安全参数、内网端口和 live/ready
  9. 记录 current/previous 版本与受审清单
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
if [[ -z "$release_manifest" || ! -f "$release_manifest" ]]; then
  echo "实际升级要求 --release-manifest 指向发布工作流生成的七组件清单。" >&2
  exit 2
fi
if [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "实际升级要求 --manifest-sha256 提供独立审批记录中的清单 SHA-256。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "实际升级要求 --expected-git-sha 提供受审发布的完整 40 位 commit ID。" >&2
  exit 2
fi
release_manifest=$(cd "$(dirname "$release_manifest")" && pwd -P)/$(basename "$release_manifest")

"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$target" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --manifest-only
"$ROOT_DIR/scripts/verify-deployment-source.sh" --expected-git-sha "$expected_git_sha"

maintenance_lock_acquire "${BACKUP_DIR:-$ROOT_DIR/backups}" "upgrade-$target"
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

FIATLUX_VERSION_OVERRIDE=$target "$COMPOSE" config --quiet

echo "拉取并核验目标七镜像。"
FIATLUX_VERSION_OVERRIDE=$target "$COMPOSE" pull api worker web caddy backup-tools minio postgres
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$target" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256"

current_postgres_version=$(postgres_current_binary_version "$COMPOSE" "$current")
target_postgres_version=$(postgres_release_binary_version "$COMPOSE" "$target")
postgres_assert_release_transition \
  upgrade "$current_postgres_version" "$target_postgres_version"

echo "使用已核验的目标 backup image 创建升级前加密备份。"
"$ROOT_DIR/scripts/backup.sh" \
  --name "pre-upgrade-${current//[^A-Za-z0-9._-]/_}-$(date -u +%Y%m%dT%H%M%SZ)" \
  --backup-image-version "$target" \
  --require-encryption

export FIATLUX_VERSION_OVERRIDE=$target
echo "停止写入方并切换已核验的目标 PostgreSQL。"
"$COMPOSE" stop caddy api worker
"$COMPOSE" up -d --wait --no-deps --force-recreate --no-build --pull never postgres

echo "执行一次性迁移。"
"$COMPOSE" run --rm --no-deps --pull never migrate
"$COMPOSE" run --rm --no-deps --pull never queue-migrate
"$COMPOSE" run --rm --no-deps --pull never database-permissions

echo "重建服务并等待健康。"
"$COMPOSE" up -d --wait --remove-orphans --no-build --pull never \
  minio minio-bootstrap api worker web caddy
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$target" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --check-running-services

ca_file=${CADDY_ROOT_CA_FILE:-}
if [[ -z "$ca_file" ]]; then
  echo "升级后验证要求设置 CADDY_ROOT_CA_FILE。" >&2
  exit 5
fi
"$ROOT_DIR/scripts/verify-deployment.sh" --ca "$ca_file"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
mkdir -p "$STATE_DIR/manifests"
chmod 700 "$STATE_DIR/manifests"
manifest_record="$STATE_DIR/manifests/$target.tsv"
manifest_record_partial="$STATE_DIR/manifests/.$target.tsv.partial.$$"
install -m 600 "$release_manifest" "$manifest_record_partial"
recorded_manifest_sha256=$(sha256sum "$manifest_record_partial" | awk '{print $1}')
if [[ "$recorded_manifest_sha256" != "$manifest_sha256" ]]; then
  rm -f "$manifest_record_partial"
  echo "写入本机发布状态时清单发生变化，拒绝记录版本。" >&2
  exit 6
fi
mv "$manifest_record_partial" "$manifest_record"
printf '%s  %s\n' "$manifest_sha256" "$target.tsv" >"$STATE_DIR/manifests/$target.tsv.sha256"
chmod 600 "$STATE_DIR/manifests/$target.tsv.sha256"
printf '%s\n' "$current" >"$STATE_DIR/previous"
printf '%s\n' "$target" >"$STATE_DIR/current"
printf '%s\tupgrade\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current" "$target" "$expected_git_sha" "$manifest_sha256" >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"

printf '升级完成：%s -> %s\n' "$current" "$target"
