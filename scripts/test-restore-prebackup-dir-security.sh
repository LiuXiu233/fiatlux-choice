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
  "$workspace/maintenance" "$workspace/state" "$workspace/fakebin" \
  "$workspace/operation-reports"
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
write_synthetic_restore_report() {
  local argument
  local backup_file=""
  local archive_sha256=""
  local source_id=""
  local source_database=""
  local source_bucket=""
  local backup_tool_release=""
  local restore_tool_release=""
  local signature_verified=false
  local attestation_sha256=""
  local signing_key_fingerprint_sha256=""
  local report_id=""
  local target_database=""
  local target_bucket=""
  for argument in "$@"; do
    case "$argument" in
      BACKUP_FILE=*) backup_file=${argument#*=} ;;
      BACKUP_EXPECTED_SHA256=*) archive_sha256=${argument#*=} ;;
      RESTORE_EXPECTED_SOURCE_ID=*) source_id=${argument#*=} ;;
      RESTORE_EXPECTED_SOURCE_DATABASE=*) source_database=${argument#*=} ;;
      RESTORE_EXPECTED_SOURCE_BUCKET=*) source_bucket=${argument#*=} ;;
      RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=*) backup_tool_release=${argument#*=} ;;
      RESTORE_TOOL_RELEASE=*) restore_tool_release=${argument#*=} ;;
      RESTORE_SIGNATURE_VERIFIED=*) signature_verified=${argument#*=} ;;
      RESTORE_ATTESTATION_SHA256=*) attestation_sha256=${argument#*=} ;;
      RESTORE_SIGNING_KEY_FINGERPRINT_SHA256=*)
        signing_key_fingerprint_sha256=${argument#*=}
        ;;
      RESTORE_REPORT_ID=*) report_id=${argument#*=} ;;
      RESTORE_CONFIRM_DATABASE=*) target_database=${argument#*=} ;;
      RESTORE_CONFIRM_BUCKET=*) target_bucket=${argument#*=} ;;
    esac
  done
  if [[ "${TECHNICAL_REPORT_MODE:-valid}" == missing ]]; then
    return 0
  fi
  if [[ "${TECHNICAL_REPORT_MODE:-valid}" == tampered ]]; then
    source_id=tampered-source
  fi
  : "${BACKUP_DIR:?}" "${backup_file:?}" "${archive_sha256:?}" "${source_id:?}" \
    "${source_database:?}" "${source_bucket:?}" "${backup_tool_release:?}" \
    "${restore_tool_release:?}" "${report_id:?}" "${target_database:?}" \
    "${target_bucket:?}"
  local report_dir="$BACKUP_DIR/restore-reports"
  local report="$report_dir/restore-$report_id.json"
  mkdir -p "$report_dir"
  umask 077
  jq -n \
    --arg reportId "$report_id" \
    --arg source "$(basename "$backup_file")" \
    --arg archiveSha256 "$archive_sha256" \
    --argjson signatureVerified "$signature_verified" \
    --arg attestationSha256 "$attestation_sha256" \
    --arg signingKeyFingerprintSha256 "$signing_key_fingerprint_sha256" \
    --arg sourceId "$source_id" \
    --arg sourceDatabase "$source_database" \
    --arg sourceBucket "$source_bucket" \
    --arg backupToolRelease "$backup_tool_release" \
    --arg restoreToolRelease "$restore_tool_release" \
    --arg database "$target_database" \
    --arg bucket "$target_bucket" '
      {
        schemaVersion: 1,
        evidenceType: "technical_restore",
        result: "success",
        reportId: $reportId,
        restoredAt: "2026-07-20T00:00:01Z",
        source: $source,
        archiveSha256: $archiveSha256,
        approvedDigestMatched: true,
        signatureVerified: $signatureVerified,
        attestationSha256: (if $signatureVerified then $attestationSha256 else null end),
        signingKeyFingerprintSha256: (if $signatureVerified then $signingKeyFingerprintSha256 else null end),
        sourceId: $sourceId,
        sourceDatabase: $sourceDatabase,
        sourceBucket: $sourceBucket,
        backupToolRelease: $backupToolRelease,
        restoreToolRelease: $restoreToolRelease,
        database: $database,
        bucket: $bucket,
        checksumVerified: true,
        metadataVerified: true,
        objectsVerified: true,
        objectCount: 1,
        objectBytes: 94,
        objectManifestSha256: "8888888888888888888888888888888888888888888888888888888888888888"
      }
    ' >"$report.partial"
  mv "$report.partial" "$report"
}
case "$1" in
  pull | stop | up) ;;
  exec)
    printf 'postgres (PostgreSQL) 17.10\n'
    ;;
  run)
    if [[ "$*" == *'--entrypoint postgres postgres --version'* ]]; then
      printf 'postgres (PostgreSQL) 17.10\n'
    fi
    if [[ "$*" == *'backup-tools restore-container'* ]]; then
      write_synthetic_restore_report "$@"
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
operation_report_dir="$workspace/operation-reports"
chmod 0700 "$operation_report_dir"
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
restore_case_counter=0
restore_operation_id_override=""
restore_environment_id=production-fixture
restore_operator_identity="fixture-operator"
restore_approval_reference="fixture-approval-0001"
restore_reason="受控恢复安全夹具，不代表真实生产批准"
restore_operation_report_dir=$operation_report_dir
restore_skip_pre_backup=false
restore_skip_confirmation=""
technical_report_mode=valid
last_operation_id=""

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
  restore_case_counter=$((restore_case_counter + 1))
  local effective_operation_id=${restore_operation_id_override:-}
  if [[ -z "$effective_operation_id" ]]; then
    effective_operation_id=$(printf 'fixture-restore-%04d' "$restore_case_counter")
  fi
  last_operation_id=$effective_operation_id
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
    --operation-id "$effective_operation_id"
    --environment-id "$restore_environment_id"
    --operator-identity "$restore_operator_identity"
    --approval-reference "$restore_approval_reference"
    --reason "$restore_reason"
    --operation-report-dir "$restore_operation_report_dir"
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
  if [[ "$restore_skip_pre_backup" == true ]]; then
    restore_args+=(--skip-pre-backup)
  fi
  if [[ -n "$restore_skip_confirmation" ]]; then
    restore_args+=(--confirm-skip-pre-backup "$restore_skip_confirmation")
  fi
  restore_args+=(--approve YES-I-UNDERSTAND)
  PATH="$path_value" \
    COMPOSE_LOG="$compose_log" \
    BACKUP_LOG="$backup_log" \
    TECHNICAL_REPORT_MODE="$technical_report_mode" \
    FIATLUX_ENV=production \
    FIATLUX_ENV_FILE="$env_file" \
    FIATLUX_COMPOSE_SCRIPT="$fixture/scripts/compose.sh" \
    FIATLUX_STATE_DIR="$state_dir" \
    "$fixture/scripts/restore.sh" "${restore_args[@]}"
}

write_env "$output_dir"
run_restore "" >/dev/null
first_operation_id=$last_operation_id
[[ -f "$output_dir/pre-restore-output.marker" ]]
[[ ! -e "$source_dir/pre-restore-output.marker" ]]
[[ "$(mode_of "$source_dir")" == 555 ]]
grep -F $'BACKUP_DIR='"$output_dir"$'\t' "$backup_log" >/dev/null
grep -F $'BACKUP_FILE=/restore-source/approved-source.tar.gz' "$compose_log" >/dev/null
grep -F $'BACKUP_DIR='"$runtime_dir"$'\t' "$compose_log" | grep -F $'\tup -d --wait' >/dev/null
first_operation_dir="$operation_report_dir/operations/$first_operation_id"
first_technical_report="$first_operation_dir/technical/restore-reports/restore-$first_operation_id.json"
first_operation_report="$first_operation_dir/production-restore-$first_operation_id.json"
if ! grep -F $'BACKUP_DIR='"$first_operation_dir/technical"$'\t' "$compose_log" |
  grep -F 'backup-tools restore-container' >/dev/null; then
  echo "恢复容器未被限制到当前 operation 的 technical 子目录。" >&2
  exit 1
fi
first_technical_sha=$(sha256sum "$first_technical_report" | awk '{print $1}')
first_operation_sha=$(sha256sum "$first_operation_report" | awk '{print $1}')
if ! jq -e \
  --arg operationId "$first_operation_id" \
  --arg technicalSha "$first_technical_sha" '
    .schemaVersion == 1 and .evidenceType == "production_restore_operation" and
    .result == "success" and .operationId == $operationId and
    .environment.environmentId == "production-fixture" and
    .approval.operatorIdentity == "fixture-operator" and
    .approval.assertedApprovalReference == "fixture-approval-0001" and
    .approval.approvalIndependentlyVerified == false and
    .execution.destructiveRestorePerformed == true and
    .execution.preRestoreBackupCreated == true and
    .checks.technicalRestoreReportSha256 == $technicalSha and
    .checks.objectsVerified == true and
    .checks.migrationsPermissionsImagesHealth == true and
    .checks.releaseStateRecorded == true
  ' "$first_operation_report" >/dev/null; then
  echo "主机恢复报告未绑定批准断言、技术报告、对象核验和最终健康状态。" >&2
  exit 1
fi
if [[ "$(mode_of "$operation_report_dir")" != 700 ||
  "$(mode_of "$operation_report_dir/operations")" != 700 ||
  "$(mode_of "$first_operation_dir")" != 700 ||
  "$(mode_of "$first_operation_dir/technical")" != 700 ||
  "$(mode_of "$first_operation_dir/technical/restore-reports")" != 700 ||
  "$(mode_of "$first_technical_report")" != 600 ||
  "$(mode_of "$first_operation_report")" != 600 ]]; then
  echo "恢复证据目录或报告权限不是预期的 0700/0600。" >&2
  exit 1
fi
if ! awk -F '\t' \
  -v operation_id="$first_operation_id" \
  -v report_sha="$first_operation_sha" '
    $2 == "restore" {
      found = (NF == 14 && $10 == operation_id &&
        $11 == "production-fixture" && $12 == "fixture-operator" &&
        $13 == "fixture-approval-0001" && $14 == report_sha)
    }
    END { exit !found }
  ' "$state_dir/history.tsv"; then
  echo "恢复 history.tsv 未绑定完整操作身份和报告 SHA-256。" >&2
  exit 1
fi

expect_rejected_before_compose() {
  local label=$1
  local restore_exit
  rm -f "$compose_log" "$backup_log"
  set +e
  run_restore "" >/dev/null 2>&1
  restore_exit=$?
  set -e
  if ((restore_exit == 0)); then
    printf '恢复负向场景未失败关闭：%s\n' "$label" >&2
    exit 1
  fi
  if [[ -s "$compose_log" || -s "$backup_log" ]]; then
    printf '恢复负向场景在验证失败后仍执行 Compose/备份：%s\n' "$label" >&2
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
expect_rejected_before_compose wrong-public-key
restore_public_key=$valid_public_key

restore_key_sha=$(printf '0%.0s' {1..64})
expect_rejected_before_compose wrong-approved-key-fingerprint
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
expect_rejected_before_compose tampered-archive
restore_archive=$valid_archive

tampered_attestation="$workspace/tampered-attestation.json"
cp "$valid_attestation" "$tampered_attestation"
chmod 0600 "$tampered_attestation"
printf '\n' >>"$tampered_attestation"
restore_attestation=$tampered_attestation
expect_rejected_before_compose tampered-attestation
restore_attestation=$valid_attestation

restore_expected_source_id=unapproved-source
expect_rejected_before_compose wrong-source
restore_expected_source_id=$valid_source_id

restore_expected_tool_release=v9.9.9-unapproved
expect_rejected_before_compose wrong-backup-tool-release
restore_expected_tool_release=$valid_tool_release

signature_mode=none
expect_rejected_before_compose missing-signature-inputs
signature_mode=partial
expect_rejected_before_compose partial-signature-inputs
signature_mode=full

restore_archive=$valid_archive
restore_expected_sha=$valid_expected_sha
restore_attestation=$valid_attestation
restore_signature=$valid_signature
restore_public_key=$valid_public_key
restore_key_sha=$valid_key_sha
restore_expected_source_id=$valid_source_id
restore_expected_tool_release=$valid_tool_release

restore_operation_id_override=$first_operation_id
expect_rejected_before_compose duplicate-operation-id
restore_operation_id_override=""

restore_operator_identity=""
expect_rejected_before_compose missing-operator-identity
restore_operator_identity="fixture-operator"

restore_environment_id=x
expect_rejected_before_compose invalid-environment-id
restore_environment_id=production-fixture

restore_approval_reference="  TBD  "
expect_rejected_before_compose placeholder-approval-reference
restore_approval_reference="fixture-approval-0001"

restore_reason=too-short
expect_rejected_before_compose missing-meaningful-reason
restore_reason="受控恢复安全夹具，不代表真实生产批准"

restore_operation_id_override=short
expect_rejected_before_compose invalid-operation-id
restore_operation_id_override=""

restore_skip_confirmation=PRE-RESTORE-BACKUP-RISK-ACCEPTED
expect_rejected_before_compose skip-confirmation-without-skip
restore_skip_confirmation=""
restore_skip_pre_backup=true
expect_rejected_before_compose skip-without-secondary-confirmation
restore_skip_confirmation=PRE-RESTORE-BACKUP-RISK-ACCEPTED
rm -f "$compose_log" "$backup_log"
run_restore "" >/dev/null
skip_operation_id=$last_operation_id
skip_operation_report="$operation_report_dir/operations/$skip_operation_id/production-restore-$skip_operation_id.json"
if [[ -s "$backup_log" ]] ||
  ! jq -e '.execution.preRestoreBackupCreated == false' \
    "$skip_operation_report" >/dev/null; then
  echo "显式跳过恢复前备份的二次确认或主机报告状态不正确。" >&2
  exit 1
fi
restore_skip_pre_backup=false
restore_skip_confirmation=""

restore_operation_report_dir=relative-operation-reports
expect_rejected_before_compose relative-operation-report-dir
restore_operation_report_dir=$operation_report_dir

restore_operation_report_dir="$workspace/nonexistent-operation-reports"
expect_rejected_before_compose nonexistent-operation-report-dir
restore_operation_report_dir=$operation_report_dir

ln -s "$operation_report_dir" "$workspace/operation-report-link"
restore_operation_report_dir="$workspace/operation-report-link"
expect_rejected_before_compose symlink-operation-report-dir
restore_operation_report_dir=$operation_report_dir

restore_operation_report_dir=$source_dir
expect_rejected_before_compose operation-report-overlaps-source
if [[ "$(mode_of "$source_dir")" != 555 ]]; then
  echo "报告路径重叠拒绝前意外修改了只读归档源权限。" >&2
  exit 1
fi
restore_operation_report_dir=$operation_report_dir

restore_operation_report_dir=$restore_scratch
expect_rejected_before_compose operation-report-overlaps-restore-scratch
restore_operation_report_dir=$output_dir
expect_rejected_before_compose operation-report-overlaps-prebackup
restore_operation_report_dir=$backup_scratch
expect_rejected_before_compose operation-report-overlaps-backup-scratch
restore_operation_report_dir=$operation_report_dir

nested_symlink_report_dir="$workspace/nested-symlink-operation-reports"
mkdir -m 0700 "$nested_symlink_report_dir"
ln -s "$workspace" "$nested_symlink_report_dir/operations"
restore_operation_report_dir=$nested_symlink_report_dir
expect_rejected_before_compose symlink-technical-report-dir
restore_operation_report_dir=$operation_report_dir

existing_partial_id="fixture-existing-partial"
mkdir -m 0700 "$operation_report_dir/operations/$existing_partial_id"
: >"$operation_report_dir/operations/$existing_partial_id/.production-restore-$existing_partial_id.json.partial"
chmod 0600 "$operation_report_dir/operations/$existing_partial_id/.production-restore-$existing_partial_id.json.partial"
restore_operation_id_override=$existing_partial_id
expect_rejected_before_compose existing-host-partial
rm -rf "$operation_report_dir/operations/$existing_partial_id"
restore_operation_id_override=""

existing_technical_id="fixture-existing-technical"
mkdir -m 0700 "$operation_report_dir/operations/$existing_technical_id"
: >"$operation_report_dir/operations/$existing_technical_id/restore-$existing_technical_id.json"
chmod 0600 "$operation_report_dir/operations/$existing_technical_id/restore-$existing_technical_id.json"
restore_operation_id_override=$existing_technical_id
expect_rejected_before_compose existing-technical-report
rm -rf "$operation_report_dir/operations/$existing_technical_id"
restore_operation_id_override=""

expect_technical_report_rejected() {
  local label=$1
  local mode=$2
  local restore_exit
  rm -f "$compose_log" "$backup_log"
  technical_report_mode=$mode
  set +e
  run_restore "" >/dev/null 2>&1
  restore_exit=$?
  set -e
  technical_report_mode=valid
  if ((restore_exit == 0)); then
    printf '技术报告负向场景未失败关闭：%s\n' "$label" >&2
    exit 1
  fi
  if ! grep -F 'backup-tools restore-container' "$compose_log" >/dev/null; then
    printf '技术报告负向场景未到达受控恢复容器：%s\n' "$label" >&2
    exit 1
  fi
  local operation_dir="$operation_report_dir/operations/$last_operation_id"
  if [[ -e "$operation_dir/production-restore-$last_operation_id.json" ||
    -e "$operation_dir/.production-restore-$last_operation_id.json.partial" ]]; then
    printf '无效技术报告仍发布了主机成功报告：%s\n' "$label" >&2
    exit 1
  fi
}
expect_technical_report_rejected missing-technical-report missing
expect_technical_report_rejected tampered-technical-report tampered

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

echo "恢复签名、人工操作元数据、只读源、独立备份/报告目录、技术报告绑定与权限/容量 fail-closed 测试通过。"
