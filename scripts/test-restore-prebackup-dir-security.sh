#!/usr/bin/env bash
set -euo pipefail

# Verify that restore.sh keeps an approved/read-only archive source separate from
# the writable pre-restore output. Compose, release-image and deployment checks
# are reduced to safe stubs so no database or object bucket is touched.

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd -P)
mkdir -p "$ROOT_DIR/tmp"
workspace=$(mktemp -d "$ROOT_DIR/tmp/restore-prebackup-security.XXXXXX")
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  chmod -R u+w "$workspace" 2>/dev/null || true
  rm -rf "$workspace"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

random_secret() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "需要 openssl 生成一次性测试凭据。" >&2
    exit 2
  fi
  openssl rand -hex 24
}

# Keep fixture credentials ephemeral; this test must not add password-shaped
# literals to the repository or expose them in process output.
postgres_restore_password=$(random_secret)
s3_restore_secret=$(random_secret)

fixture="$workspace/repository"
mkdir -p "$fixture/scripts/lib" "$workspace/source" "$workspace/runtime" \
  "$workspace/output" "$workspace/backup-scratch" "$workspace/restore-scratch" \
  "$workspace/maintenance" "$workspace/state" "$workspace/fakebin"
install -m 0755 "$ROOT_DIR/scripts/restore.sh" "$fixture/scripts/restore.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/runtime-env.sh" "$fixture/scripts/lib/runtime-env.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/maintenance-lock.sh" "$fixture/scripts/lib/maintenance-lock.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/postgres-release.sh" "$fixture/scripts/lib/postgres-release.sh"

cat >"$fixture/scripts/verify-release-images.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
cat >"$fixture/scripts/verify-deployment-source.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
cat >"$fixture/scripts/verify-deployment.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
chmod 0755 "$fixture/scripts/verify-release-images.sh" \
  "$fixture/scripts/verify-deployment-source.sh" "$fixture/scripts/verify-deployment.sh"

compose_log="$workspace/compose.log"
backup_log="$workspace/backup.log"
cat >"$fixture/scripts/compose.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'BACKUP_DIR=%s\tRESTORE_SOURCE_DIR=%s\t%s\n' \
  "$BACKUP_DIR" "$RESTORE_SOURCE_DIR" "$*" >>"$COMPOSE_LOG"
case "$1" in
  pull | stop | up) ;;
  exec)
    printf 'postgres (PostgreSQL) 17.10\n'
    ;;
  run)
    if [[ "$*" == *'--entrypoint postgres postgres --version'* ]]; then
      printf 'postgres (PostgreSQL) 17.10\n'
    fi
    ;;
  *) printf 'unexpected fake compose command: %s\n' "$*" >&2; exit 9 ;;
esac
EOF
chmod 0755 "$fixture/scripts/compose.sh"

cat >"$fixture/scripts/backup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'BACKUP_DIR=%s\tRESTORE_SOURCE_DIR=%s\t%s\n' \
  "$BACKUP_DIR" "$RESTORE_SOURCE_DIR" "$*" >>"$BACKUP_LOG"
[[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]]
printf '%s\n' 'pre-restore-output' >"$BACKUP_DIR/pre-restore-output.marker"
EOF
chmod 0755 "$fixture/scripts/backup.sh"

cat >"$workspace/fakebin/df" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
low_df=$(printenv LOW_DF || true)
if [[ "$low_df" == 1 ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
  printf 'fake 100 99 1 99%% /\n'
else
  exec /bin/df "$@"
fi
EOF
chmod 0755 "$workspace/fakebin/df"

source_dir="$workspace/source"
archive="$source_dir/approved-source.tar.gz"
printf '%s\n' 'approved archive fixture' >"$archive"
chmod 0444 "$archive"
chmod 0555 "$source_dir"
output_dir="$workspace/output"
runtime_dir="$workspace/runtime"
backup_scratch="$workspace/backup-scratch"
restore_scratch="$workspace/restore-scratch"
maintenance_dir="$workspace/maintenance"
state_dir="$workspace/state"
manifest="$workspace/release-manifest.tsv"
printf '%s\n' 'fixture manifest' >"$manifest"
archive_sha=$(sha256sum "$archive" | awk '{print $1}')
manifest_sha=$(sha256sum "$manifest" | awk '{print $1}')

mode_of() {
  local mode
  mode=$(stat -c '%a' "$1" 2>/dev/null || true)
  if [[ -n "$mode" ]]; then
    printf '%s\n' "$mode"
  else
    stat -f '%Lp' "$1"
  fi
}

env_file="$workspace/production.env"
write_env() {
  pre_dir=$1
  cat >"$env_file" <<EOF
APP_IMAGE_TAG=v1.0.0
BACKUP_DIR=$runtime_dir
RESTORE_SOURCE_DIR=$source_dir
RESTORE_PRE_BACKUP_DIR=$pre_dir
BACKUP_SCRATCH_DIR=$backup_scratch
RESTORE_SCRATCH_DIR=$restore_scratch
FIATLUX_MAINTENANCE_DIR=$maintenance_dir
POSTGRES_RESTORE_PASSWORD=$postgres_restore_password
S3_RESTORE_ACCESS_KEY_ID=restore-prebackup-test
S3_RESTORE_SECRET_ACCESS_KEY=$s3_restore_secret
EOF
  chmod 0600 "$env_file"
}

run_restore() {
  extra_path=$1
  path_value="$ROOT_DIR/scripts:$PATH"
  if [[ -n "$extra_path" ]]; then path_value="$extra_path:$path_value"; fi
  PATH="$path_value" \
    COMPOSE_LOG="$compose_log" \
    BACKUP_LOG="$backup_log" \
    FIATLUX_ENV=production \
    FIATLUX_ENV_FILE="$env_file" \
    FIATLUX_COMPOSE_SCRIPT="$fixture/scripts/compose.sh" \
    FIATLUX_STATE_DIR="$state_dir" \
    "$fixture/scripts/restore.sh" \
      --file "$archive" \
      --expected-sha256 "$archive_sha" \
      --expected-source-id fiatlux-prebackup-security \
      --expected-source-database fiatlux_choice \
      --expected-source-bucket fiatlux-choice \
      --restore-image-version v1.0.0 \
      --expected-backup-tool-release v1.0.0 \
      --release-manifest "$manifest" \
      --manifest-sha256 "$manifest_sha" \
      --expected-git-sha "$(printf 'b%.0s' {1..40})" \
      --confirm-database fiatlux_choice \
      --confirm-bucket fiatlux-choice \
      --approve YES-I-UNDERSTAND
}

write_env "$output_dir"
run_restore "" >/dev/null
[[ -f "$output_dir/pre-restore-output.marker" ]]
[[ ! -e "$source_dir/pre-restore-output.marker" ]]
[[ "$(mode_of "$source_dir")" == 555 ]]
grep -F $'BACKUP_DIR='"$output_dir"$'\t' "$backup_log" >/dev/null
grep -F $'BACKUP_FILE=/restore-source/approved-source.tar.gz' "$compose_log" >/dev/null
grep -F $'BACKUP_DIR='"$runtime_dir"$'\t' "$compose_log" | grep -F $'\tup -d --wait' >/dev/null

# A non-directory output path fails before pull/stop/backup-tools.
: >"$workspace/output-file"
rm -f "$compose_log" "$backup_log"
write_env "$workspace/output-file"
if run_restore "" >/dev/null 2>&1; then
  echo "不可用的 RESTORE_PRE_BACKUP_DIR 未失败关闭。" >&2
  exit 1
fi
[[ ! -s "$compose_log" && ! -s "$backup_log" ]]
[[ "$(mode_of "$source_dir")" == 555 ]]

# A capacity failure is also caught before any destructive Compose command.
rm -f "$workspace/output-file" "$compose_log" "$backup_log"
mkdir -m 700 "$workspace/output-file"
write_env "$workspace/output-file"
if LOW_DF=1 run_restore "$workspace/fakebin" >/dev/null 2>&1; then
  echo "容量不足的 RESTORE_PRE_BACKUP_DIR 未失败关闭。" >&2
  exit 1
fi
[[ ! -s "$compose_log" && ! -s "$backup_log" ]]
[[ "$(mode_of "$source_dir")" == 555 ]]

echo "恢复源只读挂载、独立恢复前输出与权限/容量 fail-closed 测试通过。"
