#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

# Exercise the documented, root-only access-key replacement path against a real,
# isolated MinIO instance.  This intentionally uses a temporary Compose project
# and named volume; it must never be pointed at the production project.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
PROJECT="fiatlux-minio-legacy-rotation-$$"
IMAGE_PREFIX=${MINIO_ROTATION_IMAGE_PREFIX:-ghcr.io/liuxiu233/fiatlux-choice}
IMAGE_TAG=${MINIO_ROTATION_IMAGE_TAG:-local}

mkdir -p "$ROOT_DIR/tmp"
workspace=$(mktemp -d "$ROOT_DIR/tmp/minio-legacy-rotation.XXXXXX")
env_file="$workspace/runtime.env"
umask 077

random_secret() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "需要 openssl 生成一次性测试凭据。" >&2
    exit 2
  fi
  openssl rand -hex 24
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  FIATLUX_ENV=development \
    FIATLUX_ENV_FILE="$env_file" \
    COMPOSE_PROJECT_NAME="$PROJECT" \
    "$COMPOSE" down --volumes --remove-orphans >/dev/null 2>&1
  rm -rf "$workspace"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

# Never commit credentials, even test-only credentials, to the repository.  A
# fresh set is generated for every isolated Compose project and is removed with
# the mode-0600 runtime file during cleanup.
root_password=$(random_secret)
app_new_secret=$(random_secret)
backup_new_secret=$(random_secret)
restore_new_secret=$(random_secret)
app_old_secret=$(random_secret)
backup_old_secret=$(random_secret)
restore_old_secret=$(random_secret)

# Keep all credentials in a mode-0600 ephemeral file.  The old IDs are injected
# only into the one-shot test commands below and are never part of application
# service configuration.
cat >"$env_file" <<EOF
APP_IMAGE_TAG=$IMAGE_TAG
IMAGE_PREFIX=$IMAGE_PREFIX
MINIO_ROOT_USER=fiatlux-rotation-root
MINIO_ROOT_PASSWORD=$root_password
S3_BUCKET=fiatlux-rotation-primary
S3_REGION=cn-south-1
S3_ACCESS_KEY_ID=fiatlux-app-new
S3_SECRET_ACCESS_KEY=$app_new_secret
S3_BACKUP_ACCESS_KEY_ID=fiatlux-backup-new
S3_BACKUP_SECRET_ACCESS_KEY=$backup_new_secret
S3_RESTORE_ACCESS_KEY_ID=fiatlux-restore-new
S3_RESTORE_SECRET_ACCESS_KEY=$restore_new_secret
EOF
chmod 0600 "$env_file"

export FIATLUX_ENV=development
export FIATLUX_ENV_FILE="$env_file"
export COMPOSE_PROJECT_NAME="$PROJECT"

run_minio_shell() {
  local program=$1
  "$COMPOSE" run --rm --no-deps --pull never \
    -e "SECOND_BUCKET=$SECOND_BUCKET" \
    --entrypoint /bin/sh minio-bootstrap -ec "$program"
}

run_minio_shell_with_old_credentials() {
  local program=$1
  "$COMPOSE" run --rm --no-deps --pull never \
    -e "OLD_APP_ID=$OLD_APP_ID" \
    -e "OLD_APP_SECRET=$OLD_APP_SECRET" \
    -e "OLD_BACKUP_ID=$OLD_BACKUP_ID" \
    -e "OLD_BACKUP_SECRET=$OLD_BACKUP_SECRET" \
    -e "OLD_RESTORE_ID=$OLD_RESTORE_ID" \
    -e "OLD_RESTORE_SECRET=$OLD_RESTORE_SECRET" \
    -e "SECOND_BUCKET=$SECOND_BUCKET" \
    --entrypoint /bin/sh minio-bootstrap -ec "$program"
}

OLD_APP_ID=fiatlux-app-old
OLD_APP_SECRET=$app_old_secret
OLD_BACKUP_ID=fiatlux-backup-old
OLD_BACKUP_SECRET=$backup_old_secret
OLD_RESTORE_ID=fiatlux-restore-old
OLD_RESTORE_SECRET=$restore_old_secret
SECOND_BUCKET=fiatlux-rotation-secondary

"$COMPOSE" up -d --wait --no-build --pull never minio >/dev/null

# Establish the initial (old) identities with an intentionally over-broad,
# cross-bucket policy.  A real object is written with the old backup identity so
# that a later authentication failure cannot be confused with a missing object.
run_minio_shell_with_old_credentials '
  set -eu
  cat >/tmp/legacy-wide.json <<"JSON"
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"] ,"Resource":["arn:aws:s3:::*"]},{"Effect":"Allow","Action":["s3:*"] ,"Resource":["arn:aws:s3:::*/*"]}]}
JSON
  mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
  mc mb --ignore-existing "root/$S3_BUCKET" >/dev/null
  mc mb --ignore-existing "root/$SECOND_BUCKET" >/dev/null
  mc anonymous set none "root/$S3_BUCKET" >/dev/null
  mc anonymous set none "root/$SECOND_BUCKET" >/dev/null
  mc admin policy create root fiatlux-choice-legacy-wide /tmp/legacy-wide.json >/dev/null
  mc admin user add root "$OLD_APP_ID" "$OLD_APP_SECRET" >/dev/null
  mc admin user add root "$OLD_BACKUP_ID" "$OLD_BACKUP_SECRET" >/dev/null
  mc admin user add root "$OLD_RESTORE_ID" "$OLD_RESTORE_SECRET" >/dev/null
  mc admin policy attach root fiatlux-choice-legacy-wide --user "$OLD_APP_ID" >/dev/null
  mc admin policy attach root fiatlux-choice-legacy-wide --user "$OLD_BACKUP_ID" >/dev/null
  mc admin policy attach root fiatlux-choice-legacy-wide --user "$OLD_RESTORE_ID" >/dev/null
  mc alias set old-backup http://minio:9000 "$OLD_BACKUP_ID" "$OLD_BACKUP_SECRET" --api S3v4 >/dev/null
  printf old-rotation-sentinel >/tmp/old-rotation-sentinel
  mc cp /tmp/old-rotation-sentinel "old-backup/$S3_BUCKET/rotation/old-sentinel" >/dev/null
  mc cp /tmp/old-rotation-sentinel "old-backup/$SECOND_BUCKET/rotation/old-sentinel" >/dev/null
  test "$(mc cat "old-backup/$S3_BUCKET/rotation/old-sentinel")" = old-rotation-sentinel
  test "$(mc cat "old-backup/$SECOND_BUCKET/rotation/old-sentinel")" = old-rotation-sentinel
  echo "旧 backup 身份跨桶写入探针通过。"
' >/dev/null

# Bootstrap creates the new three identities and converges their bucket-scoped
# policies.  It deliberately leaves old IDs untouched, proving that revocation
# requires an explicit, reviewed root operation.
"$COMPOSE" run --rm --no-deps --pull never minio-bootstrap >/dev/null
run_minio_shell_with_old_credentials '
  set -eu
  mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
  mc admin user info root "$OLD_APP_ID" >/dev/null
  mc admin user info root "$OLD_BACKUP_ID" >/dev/null
  mc admin user info root "$OLD_RESTORE_ID" >/dev/null
  echo "旧身份仍存在，确认需要显式撤销。"
' >/dev/null

# Disable first, then prove each old credential fails against an existing object.
run_minio_shell_with_old_credentials '
  set -eu
  mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
  mc admin user disable root "$OLD_APP_ID" >/dev/null
  mc admin user disable root "$OLD_BACKUP_ID" >/dev/null
  mc admin user disable root "$OLD_RESTORE_ID" >/dev/null
  for pair in \
    "$OLD_APP_ID:$OLD_APP_SECRET" \
    "$OLD_BACKUP_ID:$OLD_BACKUP_SECRET" \
    "$OLD_RESTORE_ID:$OLD_RESTORE_SECRET"; do
    id=${pair%%:*}
    secret=${pair#*:}
    mc alias set old-check "http://minio:9000" "$id" "$secret" --api S3v4 >/dev/null
    if mc stat "old-check/$S3_BUCKET/rotation/old-sentinel" >/dev/null 2>&1; then
      echo "禁用后的旧身份仍可访问：$id" >&2
      exit 21
    fi
  done
  echo "旧三身份 disable 后负向 stat 通过。"
' >/dev/null

# Remove only the explicitly named IDs through the root identity, then repeat
# the negative checks.  This is intentionally not automated in bootstrap.sh.
run_minio_shell_with_old_credentials '
  set -eu
  mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
  mc admin user remove root "$OLD_APP_ID" >/dev/null
  mc admin user remove root "$OLD_BACKUP_ID" >/dev/null
  mc admin user remove root "$OLD_RESTORE_ID" >/dev/null
  for pair in \
    "$OLD_APP_ID:$OLD_APP_SECRET" \
    "$OLD_BACKUP_ID:$OLD_BACKUP_SECRET" \
    "$OLD_RESTORE_ID:$OLD_RESTORE_SECRET"; do
    id=${pair%%:*}
    secret=${pair#*:}
    mc alias set old-check "http://minio:9000" "$id" "$secret" --api S3v4 >/dev/null
    if mc stat "old-check/$S3_BUCKET/rotation/old-sentinel" >/dev/null 2>&1; then
      echo "删除后的旧身份仍可访问：$id" >&2
      exit 22
    fi
  done
  echo "旧三身份 remove 后负向 stat 通过。"
' >/dev/null

# Verify the new identities' exact app/read-only-backup/read-write-restore
# boundaries using the repository's standard probe.
./scripts/verify-minio-permissions.sh >/dev/null

# Clean the sentinels through root and record a concise, non-secret result.
run_minio_shell '
  set -eu
  mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
  mc rm --recursive --force "root/$S3_BUCKET/rotation" >/dev/null
  mc rm --recursive --force "root/$SECOND_BUCKET/rotation" >/dev/null
  echo "root cleanup 通过。"
' >/dev/null

printf 'MinIO 旧三身份轮换/显式撤销测试通过：跨桶旧 backup 写入；新三身份最小权限；disable 后与 remove 后旧三凭据 mc stat 均失败。\n'
