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
install -m 0755 "$ROOT_DIR/scripts/verify-backup-attestation.sh" \
  "$fixture/scripts/verify-backup-attestation.sh"
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
signing_private_key="$workspace/backup-signing-private.pem"
signing_public_key="$workspace/backup-signing-public.pem"
signing_public_der="$workspace/backup-signing-public.der"
openssl genpkey -algorithm ED25519 -out "$signing_private_key"
chmod 0600 "$signing_private_key"
openssl pkey -in "$signing_private_key" -passin pass: -pubout -out "$signing_public_key"
openssl pkey -pubin -in "$signing_public_key" -outform DER -out "$signing_public_der"
signing_key_sha=$(sha256sum "$signing_public_der" | awk '{print $1}')
"$ROOT_DIR/infra/backup/create-backup-attestation.sh" \
  --file "$archive" \
  --private-key "$signing_private_key" \
  --source-id fiatlux-prebackup-security \
  --source-database fiatlux_choice \
  --source-bucket fiatlux-choice \
  --backup-tool-release v1.0.0 \
  --created-at 2026-07-20T00:00:00Z >/dev/null
attestation="$archive.attestation.json"
signature="$archive.attestation.sig"
chmod 0444 "$archive" "$attestation" "$signature"
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
restore_archive=$archive
restore_expected_sha=$archive_sha
restore_attestation=$attestation
restore_signature=$signature
restore_public_key=$signing_public_key
restore_key_sha=$signing_key_sha
restore_expected_source_id=fiatlux-prebackup-security
restore_expected_tool_release=v1.0.0
signature_mode=full

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
  local -a restore_args=(
    --file "$restore_archive"
    --expected-sha256 "$restore_expected_sha"
    --expected-source-id "$restore_expected_source_id"
    --expected-source-database fiatlux_choice
    --expected-source-bucket fiatlux-choice
    --restore-image-version v1.0.0
    --expected-backup-tool-release "$restore_expected_tool_release"
    --release-manifest "$manifest"
    --manifest-sha256 "$manifest_sha"
    --expected-git-sha "$(printf 'b%.0s' {1..40})"
    --confirm-database fiatlux_choice
    --confirm-bucket fiatlux-choice
  )
  path_value="$ROOT_DIR/scripts:$PATH"
  if [[ -n "$extra_path" ]]; then path_value="$extra_path:$path_value"; fi
  case "$signature_mode" in
    full)
      restore_args+=(
        --attestation "$restore_attestation"
        --signature "$restore_signature"
        --signing-public-key "$restore_public_key"
        --expected-signing-key-sha256 "$restore_key_sha"
      )
      ;;
    partial)
      restore_args+=(--attestation "$restore_attestation")
      ;;
    none) ;;
    *) printf 'unknown signature mode: %s\n' "$signature_mode" >&2; return 9 ;;
  esac
  restore_args+=(--approve YES-I-UNDERSTAND)
  PATH="$path_value" \
    COMPOSE_LOG="$compose_log" \
    BACKUP_LOG="$backup_log" \
    FIATLUX_ENV=production \
    FIATLUX_ENV_FILE="$env_file" \
    FIATLUX_COMPOSE_SCRIPT="$fixture/scripts/compose.sh" \
    FIATLUX_STATE_DIR="$state_dir" \
    "$fixture/scripts/restore.sh" "${restore_args[@]}"
}

write_env "$output_dir"
run_restore "" >/dev/null
[[ -f "$output_dir/pre-restore-output.marker" ]]
[[ ! -e "$source_dir/pre-restore-output.marker" ]]
[[ "$(mode_of "$source_dir")" == 555 ]]
grep -F $'BACKUP_DIR='"$output_dir"$'\t' "$backup_log" >/dev/null
grep -F $'BACKUP_FILE=/restore-source/approved-source.tar.gz' "$compose_log" >/dev/null
grep -F $'BACKUP_DIR='"$runtime_dir"$'\t' "$compose_log" | grep -F $'\tup -d --wait' >/dev/null

expect_signature_rejected_before_compose() {
  local label=$1
  local restore_exit
  rm -f "$compose_log" "$backup_log"
  set +e
  run_restore "" >/dev/null 2>&1
  restore_exit=$?
  set -e
  if ((restore_exit == 0)); then
    printf '签名负向场景未失败关闭：%s\n' "$label" >&2
    exit 1
  fi
  if [[ -s "$compose_log" || -s "$backup_log" ]]; then
    printf '签名负向场景在验证失败后仍执行 Compose/备份：%s\n' "$label" >&2
    exit 1
  fi
  return 0
}

valid_archive=$restore_archive
valid_expected_sha=$restore_expected_sha
valid_attestation=$restore_attestation
valid_signature=$restore_signature
valid_public_key=$restore_public_key
valid_key_sha=$restore_key_sha
valid_source_id=$restore_expected_source_id
valid_tool_release=$restore_expected_tool_release

wrong_private_key="$workspace/wrong-signing-private.pem"
wrong_public_key="$workspace/wrong-signing-public.pem"
openssl genpkey -algorithm ED25519 -out "$wrong_private_key"
openssl pkey -in "$wrong_private_key" -passin pass: -pubout -out "$wrong_public_key"
restore_public_key=$wrong_public_key
expect_signature_rejected_before_compose wrong-public-key
restore_public_key=$valid_public_key

restore_key_sha=$(printf '0%.0s' {1..64})
expect_signature_rejected_before_compose wrong-approved-key-fingerprint
restore_key_sha=$valid_key_sha

tampered_source="$workspace/tampered-source"
mkdir -m 0700 "$tampered_source"
tampered_archive="$tampered_source/approved-source.tar.gz"
cp "$valid_archive" "$tampered_archive"
chmod 0600 "$tampered_archive"
printf 'tampered\n' >>"$tampered_archive"
chmod 0444 "$tampered_archive"
chmod 0555 "$tampered_source"
restore_archive=$tampered_archive
expect_signature_rejected_before_compose tampered-archive
restore_archive=$valid_archive

tampered_attestation="$workspace/tampered-attestation.json"
cp "$valid_attestation" "$tampered_attestation"
chmod 0600 "$tampered_attestation"
printf '\n' >>"$tampered_attestation"
restore_attestation=$tampered_attestation
expect_signature_rejected_before_compose tampered-attestation
restore_attestation=$valid_attestation

restore_expected_source_id=unapproved-source
expect_signature_rejected_before_compose wrong-source
restore_expected_source_id=$valid_source_id

restore_expected_tool_release=v9.9.9-unapproved
expect_signature_rejected_before_compose wrong-backup-tool-release
restore_expected_tool_release=$valid_tool_release

signature_mode=none
expect_signature_rejected_before_compose missing-signature-inputs
signature_mode=partial
expect_signature_rejected_before_compose partial-signature-inputs
signature_mode=full

restore_archive=$valid_archive
restore_expected_sha=$valid_expected_sha
restore_attestation=$valid_attestation
restore_signature=$valid_signature
restore_public_key=$valid_public_key
restore_key_sha=$valid_key_sha
restore_expected_source_id=$valid_source_id
restore_expected_tool_release=$valid_tool_release

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

echo "恢复签名来源、只读源挂载、独立恢复前输出与权限/容量 fail-closed 测试通过。"
