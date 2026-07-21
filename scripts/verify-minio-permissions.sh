#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env

# Variables in this single-quoted program intentionally expand inside minio-bootstrap.
# shellcheck disable=SC2016
"$COMPOSE" run --rm --no-deps --pull never --entrypoint /bin/sh minio-bootstrap -ec '
  set -eu
  probe="least-privilege/deployment-probe-$$"
  printf probe >/tmp/probe
  mc alias set app http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
  mc alias set backup http://minio:9000 "$S3_BACKUP_ACCESS_KEY_ID" "$S3_BACKUP_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
  mc alias set restore http://minio:9000 "$S3_RESTORE_ACCESS_KEY_ID" "$S3_RESTORE_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
  cleanup() {
    mc rm "app/$S3_BUCKET/$probe-app" >/dev/null 2>&1 || true
    mc rm "restore/$S3_BUCKET/$probe-restore" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT HUP INT TERM

  mc cp /tmp/probe "app/$S3_BUCKET/$probe-app" >/dev/null
  test "$(mc cat "app/$S3_BUCKET/$probe-app")" = probe
  if mc admin info app >/dev/null 2>&1; then
    echo "应用对象账号意外拥有 MinIO 管理权限。" >&2
    exit 10
  fi

  test "$(mc cat "backup/$S3_BUCKET/$probe-app")" = probe
  if mc cp /tmp/probe "backup/$S3_BUCKET/$probe-backup-write" >/dev/null 2>&1; then
    echo "备份对象账号意外拥有写权限。" >&2
    exit 11
  fi
  if mc rm "backup/$S3_BUCKET/$probe-app" >/dev/null 2>&1; then
    echo "备份对象账号意外拥有删除权限。" >&2
    exit 12
  fi
  if mc admin info backup >/dev/null 2>&1; then
    echo "备份对象账号意外拥有 MinIO 管理权限。" >&2
    exit 13
  fi

  mc cp /tmp/probe "restore/$S3_BUCKET/$probe-restore" >/dev/null
  mc rm "restore/$S3_BUCKET/$probe-restore" >/dev/null
  if mc admin info restore >/dev/null 2>&1; then
    echo "恢复对象账号意外拥有 MinIO 管理权限。" >&2
    exit 14
  fi

  mc rm "app/$S3_BUCKET/$probe-app" >/dev/null
  trap - EXIT HUP INT TERM
  echo "MinIO 最小权限探测通过。"
'
