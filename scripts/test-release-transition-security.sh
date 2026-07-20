#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
workspace=$(mktemp -d)
cleanup() {
  chmod -R u+w "$workspace" 2>/dev/null || true
  rm -rf "$workspace"
}
trap cleanup EXIT HUP INT TERM

# shellcheck source=scripts/lib/postgres-release.sh
source "$ROOT_DIR/scripts/lib/postgres-release.sh"
if postgres_assert_release_transition upgrade \
  'postgres (PostgreSQL) 17.10' 'postgres (PostgreSQL) 18.1' >/dev/null 2>&1; then
  echo "PostgreSQL major 变化负向 canary 未失败关闭。" >&2
  exit 1
fi
if postgres_assert_release_transition rollback \
  'postgres (PostgreSQL) 17.10' 'postgres (PostgreSQL) 17.9' >/dev/null 2>&1; then
  echo "PostgreSQL minor 回退在未确认时被接受。" >&2
  exit 1
fi
postgres_assert_release_transition rollback \
  'postgres (PostgreSQL) 17.10' 'postgres (PostgreSQL) 17.9' \
  POSTGRES-MINOR-ROLLBACK-REVIEWED >/dev/null

fixture="$workspace/repository"
mkdir -p "$fixture/scripts/lib" "$workspace/state" "$workspace/backups"
for script in \
  backup.sh restore.sh upgrade.sh rollback.sh verify-backup-attestation.sh \
  verify-release-images.sh verify-deployment-source.sh; do
  install -m 0755 "$ROOT_DIR/scripts/$script" "$fixture/scripts/$script"
done
install -m 0644 "$ROOT_DIR/scripts/lib/runtime-env.sh" "$fixture/scripts/lib/runtime-env.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/maintenance-lock.sh" "$fixture/scripts/lib/maintenance-lock.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/postgres-release.sh" "$fixture/scripts/lib/postgres-release.sh"

transition_log="$workspace/transition.log"
fake_compose="$fixture/scripts/compose.sh"
cat >"$fake_compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
override=${FIATLUX_VERSION_OVERRIDE:-none}
printf '%s\t%s\n' "$override" "$*" >>"${TRANSITION_LOG:?}"
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
case "${1:-}" in
  config)
    if [[ "$*" == *'--format json'* ]]; then
      version=${FIATLUX_VERSION_OVERRIDE:?}
      cat <<JSON
{"services":{"api":{"image":"registry.example/choice-api:$version"},"worker":{"image":"registry.example/choice-worker:$version"},"web":{"image":"registry.example/choice-web:$version"},"caddy":{"image":"registry.example/choice-gateway:$version"},"minio":{"image":"registry.example/choice-minio:$version"},"backup-tools":{"image":"registry.example/choice-backup:$version"},"postgres":{"image":"registry.example/choice-postgres:$version"}}}
JSON
    fi
    ;;
  ps)
    if [[ "$*" == *'--status running --services'* ]]; then
      printf '%s\n' postgres minio caddy api worker web
    else
      for service in "$@"; do :; done
      printf 'container-%s\n' "${service:?service required}"
    fi
    ;;
  pull | stop)
    ;;
  exec)
    printf 'postgres (PostgreSQL) %s\n' "${TRANSITION_RUNNING_POSTGRES_VERSION:-17.10}"
    ;;
  run)
    if [[ "${TRANSITION_ENFORCE_PINNED:-0}" == 1 && " $* " != *' --pull never '* ]]; then
      echo "one-shot transition command did not prohibit a post-verification pull: $*" >&2
      exit 86
    fi
    if [[ "$*" == *'--entrypoint postgres postgres --version'* ]]; then
      case "$override" in
        v1.0.0) postgres_version=17.9 ;;
        v-major.0.0) postgres_version=18.1 ;;
        *) postgres_version=17.10 ;;
      esac
      printf 'postgres (PostgreSQL) %s\n' "$postgres_version"
    fi
    if [[ "${TRANSITION_FAIL_CONFIG_BACKUP:-0}" == 1 &&
      "$*" == *'backup-tools config-backup-container'* ]]; then
      exit 77
    fi
    if [[ "$*" == *'backup-tools restore-container'* ]]; then
      write_synthetic_restore_report "$@"
    fi
    ;;
  up)
    if [[ "${TRANSITION_ENFORCE_PINNED:-0}" == 1 ]] &&
      { [[ " $* " != *' --pull never '* ]] || [[ " $* " != *' --no-build '* ]]; }; then
      echo "transition start did not prohibit post-verification pull/build drift: $*" >&2
      exit 87
    fi
    ;;
  *)
    printf 'unexpected fake compose command: %s\n' "$*" >&2
    exit 9
    ;;
esac
EOF
chmod 0755 "$fake_compose"

cat >"$fixture/scripts/verify-deployment.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'deployment verification stub: %s\n' "$*"
EOF
chmod 0755 "$fixture/scripts/verify-deployment.sh"

env_file="$fixture/production.env"
cat >"$env_file" <<'EOF'
APP_IMAGE_TAG=v1.0.0
BACKUP_AGE_RECIPIENT=age1securitytestrecipient
BACKUP_SOURCE_ID=fiatlux-transition-test
EOF
signing_private_key="$workspace/backup-signing-private.pem"
signing_public_key="$workspace/backup-signing-public.pem"
signing_public_der="$workspace/backup-signing-public.der"
openssl genpkey -algorithm ED25519 -out "$signing_private_key"
chmod 0600 "$signing_private_key"
openssl pkey -in "$signing_private_key" -passin pass: -pubout -out "$signing_public_key"
openssl pkey -pubin -in "$signing_public_key" -outform DER -out "$signing_public_der"
signing_key_sha=$(sha256sum "$signing_public_der" | awk '{print $1}')
cat >"$fixture/.gitignore" <<'EOF'
data/
backups/
EOF

git -C "$fixture" init --quiet
git -C "$fixture" config user.name "FIAT LUX Transition Test"
git -C "$fixture" config user.email "transition-test@fiatlux.invalid"
git -C "$fixture" add .
git -C "$fixture" commit --quiet -m "approved deployment controller"
git_sha=$(git -C "$fixture" rev-parse HEAD)

fake_docker="$workspace/docker"
cat >"$fake_docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
last=""
for argument in "$@"; do
  last=$argument
done
if [[ "${1:-}" == container ]]; then
  service=${last#container-}
  component=$service
  [[ "$component" == caddy ]] && component=gateway
  printf 'sha256:image-%s\n' "$component"
  exit 0
fi
repository=${last%:*}
case "$repository" in
  *-api) digit=1; component=api ;;
  *-worker) digit=2; component=worker ;;
  *-web) digit=3; component=web ;;
  *-gateway) digit=4; component=gateway ;;
  *-minio) digit=5; component=minio ;;
  *-backup) digit=6; component=backup ;;
  *-postgres) digit=7; component=postgres ;;
  *) exit 9 ;;
esac
if [[ "$*" == *'{{.Id}}'* ]]; then
  printf 'sha256:image-%s\n' "$component"
  exit 0
fi
printf '%s@sha256:' "$repository"
for _ in {1..64}; do
  printf '%s' "$digit"
done
printf '\n'
EOF
chmod 0755 "$fake_docker"

make_manifest() {
  local version=$1
  local destination=$2
  {
    printf 'version\tgit_sha\tcomponent\tdigest\n'
    printf '%s\t%s\tapi\tsha256:%s\n' "$version" "$git_sha" "$(printf '1%.0s' {1..64})"
    printf '%s\t%s\tworker\tsha256:%s\n' "$version" "$git_sha" "$(printf '2%.0s' {1..64})"
    printf '%s\t%s\tweb\tsha256:%s\n' "$version" "$git_sha" "$(printf '3%.0s' {1..64})"
    printf '%s\t%s\tgateway\tsha256:%s\n' "$version" "$git_sha" "$(printf '4%.0s' {1..64})"
    printf '%s\t%s\tminio\tsha256:%s\n' "$version" "$git_sha" "$(printf '5%.0s' {1..64})"
    printf '%s\t%s\tbackup\tsha256:%s\n' "$version" "$git_sha" "$(printf '6%.0s' {1..64})"
    printf '%s\t%s\tpostgres\tsha256:%s\n' "$version" "$git_sha" "$(printf '7%.0s' {1..64})"
  } >"$destination"
}

line_number() {
  local pattern=$1
  local file=$2
  local result
  result=$(grep -n -F -- "$pattern" "$file" | head -n 1 | cut -d: -f1)
  if [[ ! "$result" =~ ^[0-9]+$ ]]; then
    printf '未找到 transition 日志模式：%s\n' "$pattern" >&2
    exit 1
  fi
  printf '%s\n' "$result"
}

assert_transition_commands_pinned() {
  local file=$1
  local override command
  while IFS=$'\t' read -r override command; do
    case "$command" in
      run\ *)
        if [[ " $command " != *' --pull never '* ]]; then
          printf '一次性发布命令允许校验后重新拉取：override=%s command=%s\n' \
            "$override" "$command" >&2
          exit 1
        fi
        ;;
      up\ *)
        if [[ " $command " != *' --pull never '* ]] ||
          [[ " $command " != *' --no-build '* ]]; then
          printf '发布切换允许校验后重新拉取或本地构建：override=%s command=%s\n' \
            "$override" "$command" >&2
          exit 1
        fi
        ;;
    esac
  done <"$file"
}

assert_single_explicit_pull() {
  local file=$1
  local count
  count=$(awk -F '\t' '$2 ~ /^pull / { count += 1 } END { print count + 0 }' "$file")
  if [[ "$count" != 1 ]]; then
    printf '每次发布转换必须只有首次显式 pull，实际=%s。\n' "$count" >&2
    exit 1
  fi
}

export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=$env_file
export FIATLUX_COMPOSE_SCRIPT=$fake_compose
export FIATLUX_STATE_DIR=$workspace/state
export BACKUP_DIR=$workspace/backups
export BACKUP_SIGNING_PRIVATE_KEY_FILE=$signing_private_key
mkdir -p "$workspace/backup-scratch" "$workspace/restore-scratch"
chmod 700 "$workspace/backup-scratch" "$workspace/restore-scratch"
export BACKUP_SCRATCH_DIR=$workspace/backup-scratch
export RESTORE_SCRATCH_DIR=$workspace/restore-scratch
mkdir -p "$workspace/restore-pre-backup"
chmod 700 "$workspace/restore-pre-backup"
export RESTORE_PRE_BACKUP_DIR=$workspace/restore-pre-backup
mkdir -p "$workspace/restore-operation-reports"
chmod 700 "$workspace/restore-operation-reports"
export FIATLUX_MAINTENANCE_DIR=$workspace/maintenance
export TRANSITION_LOG=$transition_log
export DOCKER_BIN=$fake_docker
export CADDY_ROOT_CA_FILE=$workspace/test-ca.pem
export POSTGRES_RESTORE_PASSWORD=transition-postgres-restore-password
export S3_RESTORE_ACCESS_KEY_ID=transition-restore
export S3_RESTORE_SECRET_ACCESS_KEY=transition-restore-secret
export TRANSITION_ENFORCE_PINNED=1

# Prove the harness fails closed if a future transition drops the post-verification
# `--pull never`/`--no-build` boundary.  This canary never invokes a real Compose project.
set +e
"$fake_compose" run --rm migrate >/dev/null 2>&1
unpinned_canary_exit=$?
set -e
if ((unpinned_canary_exit != 86)); then
  printf '未固定 one-shot 命令的负向 canary 未被测试桩拒绝：exit=%d。\n' \
    "$unpinned_canary_exit" >&2
  exit 1
fi
: >"$transition_log"

printf 'v1.0.0\n' >"$workspace/state/current"
upgrade_manifest="$workspace/upgrade.tsv"
make_manifest v2.0.0 "$upgrade_manifest"
upgrade_manifest_sha=$(sha256sum "$upgrade_manifest" | awk '{print $1}')
"$fixture/scripts/upgrade.sh" \
  --to v2.0.0 \
  --release-manifest "$upgrade_manifest" \
  --manifest-sha256 "$upgrade_manifest_sha" \
  --expected-git-sha "$git_sha" \
  --apply --confirm UPGRADE >/dev/null

upgrade_pull=$(line_number $'v2.0.0\tpull api worker web caddy backup-tools minio postgres' "$transition_log")
upgrade_backup=$(line_number $'v2.0.0\trun --rm --no-deps --pull never -e BACKUP_NAME=pre-upgrade-' "$transition_log")
upgrade_stop=$(line_number $'v2.0.0\tstop caddy api worker' "$transition_log")
upgrade_postgres_switch=$(line_number $'v2.0.0\tup -d --wait --no-deps --force-recreate --no-build --pull never postgres' "$transition_log")
upgrade_migrate=$(line_number $'v2.0.0\trun --rm --no-deps --pull never migrate' "$transition_log")
if ! ((upgrade_pull < upgrade_backup && upgrade_backup < upgrade_stop &&
  upgrade_stop < upgrade_postgres_switch && upgrade_postgres_switch < upgrade_migrate)); then
  echo "升级顺序错误：必须先拉取/核验和备份，再停止写入方、切换 PostgreSQL，最后迁移。" >&2
  exit 1
fi
assert_single_explicit_pull "$transition_log"
assert_transition_commands_pinned "$transition_log"
if ! grep -F $'v2.0.0\trun --rm --no-deps --pull never' "$transition_log" |
  grep -F 'BACKUP_TOOL_RELEASE=v2.0.0' >/dev/null; then
  echo "升级恢复点未记录目标 backup tool release。" >&2
  exit 1
fi
if ! grep -F $'none\tstop caddy api worker' "$transition_log" >/dev/null ||
  ! grep -F $'none\tup -d --wait --no-deps --no-recreate --no-build --pull never caddy api worker' "$transition_log" >/dev/null; then
  echo "升级备份的暂停/恢复意外使用目标应用版本。" >&2
  exit 1
fi
if ! grep -F $'v2.0.0\tup -d --wait --remove-orphans --no-build --pull never minio minio-bootstrap api worker web caddy' \
  "$transition_log" >/dev/null; then
  echo "升级切换未使用已核验本地镜像的禁止拉取/构建边界。" >&2
  exit 1
fi

: >"$transition_log"
printf 'v2.0.0\n' >"$workspace/state/current"
rollback_manifest="$workspace/rollback.tsv"
make_manifest v1.0.0 "$rollback_manifest"
rollback_manifest_sha=$(sha256sum "$rollback_manifest" | awk '{print $1}')
if "$fixture/scripts/rollback.sh" \
  --to v1.0.0 \
  --release-manifest "$rollback_manifest" \
  --manifest-sha256 "$rollback_manifest_sha" \
  --expected-git-sha "$git_sha" \
  --apply --confirm RELEASE-ROLLBACK >/dev/null 2>&1; then
  echo "未确认 PostgreSQL minor 回退的真实 rollback 入口未失败关闭。" >&2
  exit 1
fi
if grep -F 'BACKUP_NAME=pre-rollback-' "$transition_log" >/dev/null; then
  echo "PostgreSQL minor 回退门禁失败后仍开始了恢复点备份。" >&2
  exit 1
fi
: >"$transition_log"
"$fixture/scripts/rollback.sh" \
  --to v1.0.0 \
  --release-manifest "$rollback_manifest" \
  --manifest-sha256 "$rollback_manifest_sha" \
  --expected-git-sha "$git_sha" \
  --confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED \
  --apply --confirm RELEASE-ROLLBACK >/dev/null

rollback_pull=$(line_number $'v1.0.0\tpull api worker web caddy backup-tools minio postgres' "$transition_log")
rollback_backup=$(line_number $'v2.0.0\trun --rm --no-deps --pull never -e BACKUP_NAME=pre-rollback-' "$transition_log")
rollback_switch=$(line_number $'v1.0.0\tstop caddy api worker' "$transition_log")
rollback_postgres_switch=$(line_number $'v1.0.0\tup -d --wait --no-deps --force-recreate --no-build --pull never postgres' "$transition_log")
rollback_app_switch=$(line_number $'v1.0.0\tup -d --wait --no-build --pull never minio minio-bootstrap api worker web caddy' "$transition_log")
if ! ((rollback_pull < rollback_backup && rollback_backup < rollback_switch &&
  rollback_switch < rollback_postgres_switch && rollback_postgres_switch < rollback_app_switch)); then
  echo "回滚顺序错误：必须先核验目标和 source 备份，再停止写入方并依次切换 PostgreSQL 与应用。" >&2
  exit 1
fi
if ! grep -F $'v2.0.0\trun --rm --no-deps --pull never' "$transition_log" |
  grep -F 'BACKUP_TOOL_RELEASE=v2.0.0' >/dev/null; then
  echo "回滚恢复点未使用并记录当前/source backup tool release。" >&2
  exit 1
fi
assert_single_explicit_pull "$transition_log"
assert_transition_commands_pinned "$transition_log"
if ! grep -F $'v1.0.0\tup -d --wait --no-build --pull never minio minio-bootstrap api worker web caddy' \
  "$transition_log" >/dev/null; then
  echo "回滚切换未使用已核验本地镜像的禁止拉取/构建边界。" >&2
  exit 1
fi

: >"$transition_log"
printf 'v1.0.0\n' >"$workspace/state/current"
restore_manifest="$workspace/restore.tsv"
make_manifest v3.0.0 "$restore_manifest"
restore_manifest_sha=$(sha256sum "$restore_manifest" | awk '{print $1}')
mkdir -p "$workspace/source-archive"
restore_archive="$workspace/source-archive/approved-source.tar.gz"
printf 'fixture archive; fake compose does not open it\n' >"$restore_archive"
"$ROOT_DIR/infra/backup/create-backup-attestation.sh" \
  --file "$restore_archive" \
  --private-key "$signing_private_key" \
  --source-id fiatlux-transition-test \
  --source-database fiatlux_choice \
  --source-bucket fiatlux-choice \
  --backup-tool-release v2.0.0 \
  --created-at 2026-07-20T00:00:00Z >/dev/null
restore_attestation="$restore_archive.attestation.json"
restore_signature="$restore_archive.attestation.sig"
chmod 444 "$restore_archive" "$restore_attestation" "$restore_signature"
chmod 555 "$workspace/source-archive"
restore_archive_sha=$(sha256sum "$restore_archive" | awk '{print $1}')
"$fixture/scripts/restore.sh" \
  --file "$restore_archive" \
  --attestation "$restore_attestation" \
  --signature "$restore_signature" \
  --signing-public-key "$signing_public_key" \
  --expected-signing-key-sha256 "$signing_key_sha" \
  --expected-sha256 "$restore_archive_sha" \
  --expected-source-id fiatlux-transition-test \
  --expected-source-database fiatlux_choice \
  --expected-source-bucket fiatlux-choice \
  --restore-image-version v3.0.0 \
  --expected-backup-tool-release v2.0.0 \
  --release-manifest "$restore_manifest" \
  --manifest-sha256 "$restore_manifest_sha" \
  --expected-git-sha "$git_sha" \
  --confirm-database fiatlux_choice \
  --confirm-bucket fiatlux-choice \
  --operation-id transition-restore-0001 \
  --environment-id transition-fixture \
  --operator-identity fixture-operator \
  --approval-reference fixture-approval-0001 \
  --reason "受控编排夹具恢复测试，不代表真实生产批准" \
  --operation-report-dir "$workspace/restore-operation-reports" \
  --approve YES-I-UNDERSTAND >/dev/null

restore_pull=$(line_number $'v3.0.0\tpull api worker web caddy backup-tools minio postgres' "$transition_log")
restore_prebackup=$(line_number $'v3.0.0\trun --rm --no-deps --pull never -e BACKUP_NAME=pre-restore-' "$transition_log")
restore_stop=$(line_number $'v3.0.0\tstop caddy api worker' "$transition_log")
restore_postgres_switch=$(line_number $'v3.0.0\tup -d --wait --no-deps --force-recreate --no-build --pull never postgres' "$transition_log")
restore_container=$(line_number $'v3.0.0\trun --rm --no-deps --pull never -e BACKUP_FILE=/restore-source/approved-source.tar.gz' "$transition_log")
if ! ((restore_pull < restore_prebackup && restore_prebackup < restore_stop &&
  restore_stop < restore_postgres_switch && restore_postgres_switch < restore_container)); then
  echo "恢复顺序错误：必须先核验发布和前置备份，再停止写入方、切换 PostgreSQL，最后破坏性恢复。" >&2
  exit 1
fi
restore_command=$(grep -F $'v3.0.0\trun --rm --no-deps --pull never -e BACKUP_FILE=/restore-source/approved-source.tar.gz' "$transition_log")
if [[ "$restore_command" != *"RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=v2.0.0"* ||
  "$restore_command" != *"RESTORE_TOOL_RELEASE=v3.0.0"* ]]; then
  echo "恢复容器未同时记录受审备份工具与实际恢复 image 版本。" >&2
  exit 1
fi
assert_single_explicit_pull "$transition_log"
assert_transition_commands_pinned "$transition_log"
if [[ "$(<"$workspace/state/current")" != v3.0.0 ]]; then
  echo "成功恢复后全局发布状态未更新为实际运行版本。" >&2
  exit 1
fi
transition_operation_dir="$workspace/restore-operation-reports/operations/transition-restore-0001"
transition_restore_report="$transition_operation_dir/production-restore-transition-restore-0001.json"
transition_technical_report="$transition_operation_dir/technical/restore-reports/restore-transition-restore-0001.json"
transition_technical_sha=$(sha256sum "$transition_technical_report" | awk '{print $1}')
transition_restore_sha=$(sha256sum "$transition_restore_report" | awk '{print $1}')
if ! jq -e \
  --arg technicalSha "$transition_technical_sha" '
    .evidenceType == "production_restore_operation" and
    .result == "success" and .operationId == "transition-restore-0001" and
    .approval.approvalIndependentlyVerified == false and
    .execution.destructiveRestorePerformed == true and
    .checks.technicalRestoreReportSha256 == $technicalSha and
    .checks.migrationsPermissionsImagesHealth == true and
    .checks.releaseStateRecorded == true
  ' "$transition_restore_report" >/dev/null; then
  echo "恢复编排未生成绑定技术报告和最终健康状态的主机报告。" >&2
  exit 1
fi
if ! awk -F '\t' \
  -v report_sha="$transition_restore_sha" '
    $2 == "restore" {
      found = ($10 == "transition-restore-0001" &&
        $11 == "transition-fixture" && $12 == "fixture-operator" &&
        $13 == "fixture-approval-0001" && $14 == report_sha)
    }
    END { exit !found }
  ' "$workspace/state/history.tsv"; then
  echo "恢复历史未绑定操作、环境、操作者、批准引用和主机报告摘要。" >&2
  exit 1
fi

: >"$transition_log"
set +e
TRANSITION_FAIL_CONFIG_BACKUP=1 \
  "$fixture/scripts/backup.sh" --name config-staging-failure --quiesce \
  >/dev/null 2>&1
config_staging_failure_exit=$?
set -e
if ((config_staging_failure_exit != 77)); then
  printf '配置备份失败退出码未保留：%d。\n' "$config_staging_failure_exit" >&2
  exit 1
fi
if find "$workspace/backup-scratch" -mindepth 1 -print -quit | grep -q .; then
  echo "配置备份失败后 owner-only host staging 未清理。" >&2
  exit 1
fi
if ! grep -F $'none\tstop caddy api worker' "$transition_log" >/dev/null ||
  ! grep -F $'none\tup -d --wait --no-deps --no-recreate --no-build --pull never caddy api worker' \
    "$transition_log" >/dev/null; then
  echo "配置备份失败后没有恢复原写入服务集合。" >&2
  exit 1
fi

echo "七组件升级/回滚/恢复 N-1 编排测试通过：PostgreSQL 兼容、镜像/backup/restore provenance 与配置 staging 失败清理精确。"
