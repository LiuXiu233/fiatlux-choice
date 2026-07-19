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
用法：./scripts/rollback.sh [--to VERSION] \
       [--release-manifest FILE --manifest-sha256 SHA256 \
        --expected-git-sha GIT_SHA] \
       [--confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED] \
       [--apply --confirm RELEASE-ROLLBACK]

默认只输出 dry-run。回滚一致切换七组件版本，不自动执行数据库 schema 降级；不兼容时必须走备份恢复流程。
EOF
}

target=""
apply=false
confirmation=""
release_manifest=""
manifest_sha256=${RELEASE_MANIFEST_SHA256:-}
expected_git_sha=${RELEASE_EXPECTED_GIT_SHA:-}
postgres_minor_rollback_confirmation=""
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
    --confirm-postgres-minor-rollback)
      postgres_minor_rollback_confirmation=${2:?--confirm-postgres-minor-rollback 需要值}
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
  1. 人工确认目标应用与当前数据库 schema、目标 MinIO 与现有对象数据向后兼容
  2. 校验目标发布 Git SHA、clean 部署资产并拉取、核验七个组件
  3. 使用当前/source backup image 创建加密恢复点（失败后由 source 版本恢复）
  4. 禁止 PostgreSQL major 变化；minor 回退要求单独兼容复核确认
  5. 停止写入方并一致切换 PostgreSQL、MinIO 与 api/worker/web/gateway，不执行数据库 down migration
  6. 等待健康检查并记录版本与受审清单

若旧应用与当前 schema 不兼容，请停止本流程，使用 restore.sh 恢复升级前完整备份。
EOF

if [[ "$apply" == false ]]; then
  echo "未传入 --apply；没有修改运行环境。"
  exit 0
fi
if [[ "$confirmation" != RELEASE-ROLLBACK ]]; then
  echo "实际回滚必须传入 --confirm RELEASE-ROLLBACK。" >&2
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
if [[ -z "$release_manifest" || ! -f "$release_manifest" ]]; then
  echo "实际回滚要求 --release-manifest 指向目标版本的七组件清单。" >&2
  exit 2
fi
if [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "实际回滚要求 --manifest-sha256 提供独立审批记录中的清单 SHA-256。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "实际回滚要求 --expected-git-sha 提供受审目标发布的完整 40 位 commit ID。" >&2
  exit 2
fi
if [[ ! "$current" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "当前/source 版本状态无效，拒绝生成无法归属的回滚恢复点。" >&2
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

maintenance_lock_acquire "${BACKUP_DIR:-$ROOT_DIR/backups}" "rollback-$target"
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
FIATLUX_VERSION_OVERRIDE=$target "$COMPOSE" pull api worker web caddy backup-tools minio postgres
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$target" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256"
current_postgres_version=$(postgres_current_binary_version "$COMPOSE" "$current")
target_postgres_version=$(postgres_release_binary_version "$COMPOSE" "$target")
postgres_assert_release_transition \
  rollback "$current_postgres_version" "$target_postgres_version" \
  "$postgres_minor_rollback_confirmation"
"$ROOT_DIR/scripts/backup.sh" \
  --name "pre-rollback-${current//[^A-Za-z0-9._-]/_}-$(date -u +%Y%m%dT%H%M%SZ)" \
  --backup-image-version "$current" \
  --require-encryption
export FIATLUX_VERSION_OVERRIDE=$target
"$COMPOSE" stop caddy api worker
"$COMPOSE" up -d --wait --no-deps --force-recreate --no-build --pull never postgres
"$COMPOSE" up -d --wait --no-build --pull never minio minio-bootstrap api worker web caddy
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$target" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --check-running-services

ca_file=${CADDY_ROOT_CA_FILE:-}
if [[ -z "$ca_file" ]]; then
  echo "回滚后验证要求设置 CADDY_ROOT_CA_FILE。" >&2
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
  echo "写入本机回滚状态时清单发生变化，拒绝记录版本。" >&2
  exit 6
fi
mv "$manifest_record_partial" "$manifest_record"
printf '%s  %s\n' "$manifest_sha256" "$target.tsv" >"$STATE_DIR/manifests/$target.tsv.sha256"
chmod 600 "$STATE_DIR/manifests/$target.tsv.sha256"
printf '%s\n' "$current" >"$STATE_DIR/previous"
printf '%s\n' "$target" >"$STATE_DIR/current"
printf '%s\trollback\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current" "$target" "$expected_git_sha" "$manifest_sha256" >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"

printf '应用版本回滚完成：%s -> %s；数据库 schema 未降级。\n' "$current" "$target"
