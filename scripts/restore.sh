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
用法：./scripts/restore.sh --file FILE --confirm-database DB --confirm-bucket BUCKET \
       --expected-sha256 SHA256 --expected-source-id SOURCE_ID \
       [--expected-source-database DB --expected-source-bucket BUCKET] \
       --restore-image-version VERSION --release-manifest FILE \
       --manifest-sha256 SHA256 --expected-git-sha GIT_SHA \
       [--expected-backup-tool-release VERSION] \
       --attestation FILE --signature FILE --signing-public-key FILE \
       --expected-signing-key-sha256 SHA256 \
       --operation-id ID --environment-id ID --operator-identity ID \
       --approval-reference REF --reason TEXT --operation-report-dir DIR \
       [--confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED] \
       --approve YES-I-UNDERSTAND \
       [--identity AGE_IDENTITY] \
       [--skip-pre-backup --confirm-skip-pre-backup PRE-RESTORE-BACKUP-RISK-ACCEPTED]

本命令会停止应用、替换目标数据库和对象桶，然后执行迁移并重新启动。
归档源以只读方式挂载；默认恢复前备份写入 RESTORE_PRE_BACKUP_DIR（生产必须显式配置独立的受保护可写目录）。
操作报告根目录必须预先创建为 0700；批准引用由操作者断言，脚本不会独立验证审批真实性。
EOF
}

backup_file=""
runtime_backup_dir=${BACKUP_DIR:-$ROOT_DIR/backups}
restore_pre_backup_dir=${RESTORE_PRE_BACKUP_DIR:-}
database_confirmation=""
bucket_confirmation=""
approval=""
identity_file=""
attestation_file=${BACKUP_ATTESTATION_FILE:-}
signature_file=${BACKUP_SIGNATURE_FILE:-}
signing_public_key_file=${BACKUP_SIGNING_PUBLIC_KEY_FILE:-}
expected_signing_key_sha256=${BACKUP_SIGNING_PUBLIC_KEY_SHA256:-}
expected_sha256=${BACKUP_EXPECTED_SHA256:-}
expected_source_id=${RESTORE_EXPECTED_SOURCE_ID:-}
expected_source_database=${RESTORE_EXPECTED_SOURCE_DATABASE:-}
expected_source_bucket=${RESTORE_EXPECTED_SOURCE_BUCKET:-}
restore_image_version=""
expected_backup_tool_release=${RESTORE_EXPECTED_BACKUP_TOOL_RELEASE:-}
release_manifest=""
manifest_sha256=${RELEASE_MANIFEST_SHA256:-}
expected_git_sha=${RELEASE_EXPECTED_GIT_SHA:-}
skip_pre_backup=false
postgres_minor_rollback_confirmation=""
skip_pre_backup_confirmation=""
operation_id=""
environment_id=""
operator_identity=""
approval_reference=""
approval_reason=""
operation_report_dir=${RESTORE_OPERATION_REPORT_DIR:-}
operation_evidence_dir=""
operation_report_path=""
operation_report_partial=""
technical_restore_mount_dir=""
technical_restore_report_dir=""
technical_restore_report=""
technical_restore_report_partial=""
preserve_operation_report_partial=false

while (($#)); do
  case "$1" in
    --file)
      backup_file=${2:?--file 需要值}
      shift 2
      ;;
    --confirm-database)
      database_confirmation=${2:?--confirm-database 需要值}
      shift 2
      ;;
    --confirm-bucket)
      bucket_confirmation=${2:?--confirm-bucket 需要值}
      shift 2
      ;;
    --approve)
      approval=${2:?--approve 需要值}
      shift 2
      ;;
    --identity)
      identity_file=${2:?--identity 需要值}
      shift 2
      ;;
    --attestation)
      attestation_file=${2:?--attestation 需要文件}
      shift 2
      ;;
    --signature)
      signature_file=${2:?--signature 需要文件}
      shift 2
      ;;
    --signing-public-key)
      signing_public_key_file=${2:?--signing-public-key 需要文件}
      shift 2
      ;;
    --expected-signing-key-sha256)
      expected_signing_key_sha256=${2:?--expected-signing-key-sha256 需要 SHA-256}
      shift 2
      ;;
    --expected-sha256)
      expected_sha256=${2:?--expected-sha256 需要值}
      shift 2
      ;;
    --expected-source-id)
      expected_source_id=${2:?--expected-source-id 需要值}
      shift 2
      ;;
    --expected-source-database)
      expected_source_database=${2:?--expected-source-database 需要值}
      shift 2
      ;;
    --expected-source-bucket)
      expected_source_bucket=${2:?--expected-source-bucket 需要值}
      shift 2
      ;;
    --restore-image-version)
      restore_image_version=${2:?--restore-image-version 需要值}
      shift 2
      ;;
    --expected-backup-tool-release)
      expected_backup_tool_release=${2:?--expected-backup-tool-release 需要值}
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
    --confirm-skip-pre-backup)
      skip_pre_backup_confirmation=${2:?--confirm-skip-pre-backup 需要值}
      shift 2
      ;;
    --operation-id)
      operation_id=${2:?--operation-id 需要值}
      shift 2
      ;;
    --environment-id)
      environment_id=${2:?--environment-id 需要值}
      shift 2
      ;;
    --operator-identity)
      operator_identity=${2:?--operator-identity 需要值}
      shift 2
      ;;
    --approval-reference)
      approval_reference=${2:?--approval-reference 需要值}
      shift 2
      ;;
    --reason)
      approval_reason=${2:?--reason 需要值}
      shift 2
      ;;
    --operation-report-dir)
      operation_report_dir=${2:?--operation-report-dir 需要值}
      shift 2
      ;;
    --skip-pre-backup)
      skip_pre_backup=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$backup_file" || -z "$database_confirmation" || -z "$bucket_confirmation" ]]; then
  usage >&2
  exit 2
fi
if [[ "$approval" != YES-I-UNDERSTAND ]]; then
  echo "必须显式传入 --approve YES-I-UNDERSTAND。" >&2
  exit 2
fi
if [[ ! "$operation_id" =~ ^[a-z0-9][a-z0-9._-]{7,119}$ ]]; then
  echo "--operation-id 必须是 8–120 位小写稳定标识。" >&2
  exit 2
fi
if [[ ! "$environment_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$ ]]; then
  echo "--environment-id 必须是 2–200 位稳定环境标识。" >&2
  exit 2
fi
validate_operation_metadata() {
  local label=$1
  local value=$2
  local minimum=$3
  local maximum=$4
  local length=${#value}
  if ((length < minimum || length > maximum)) ||
    [[ "$value" == *$'\n'* ]] ||
    LC_ALL=C grep -q '[[:cntrl:]]' < <(printf '%s' "$value"); then
    printf '%s 必须是 %d–%d 字符且不含控制字符。\n' \
      "$label" "$minimum" "$maximum" >&2
    exit 2
  fi
}
validate_operation_metadata operator-identity "$operator_identity" 2 200
validate_operation_metadata approval-reference "$approval_reference" 5 200
validate_operation_metadata reason "$approval_reason" 10 1000
if grep -Eiq '^[[:space:]]*(pending|todo|tbd|unknown|none|n/a|placeholder)[[:space:]]*$' \
  < <(printf '%s' "$approval_reference"); then
  echo "--approval-reference 不能使用占位值。" >&2
  exit 2
fi
if [[ "$skip_pre_backup" == true ]]; then
  if [[ "$skip_pre_backup_confirmation" != PRE-RESTORE-BACKUP-RISK-ACCEPTED ]]; then
    echo "跳过恢复前备份必须显式传入 --confirm-skip-pre-backup PRE-RESTORE-BACKUP-RISK-ACCEPTED。" >&2
    exit 2
  fi
elif [[ -n "$skip_pre_backup_confirmation" ]]; then
  echo "未使用 --skip-pre-backup 时不得传入 --confirm-skip-pre-backup。" >&2
  exit 2
fi
validate_operation_metadata operation-report-dir "$operation_report_dir" 2 4096
if [[ "$operation_report_dir" != /* || "$operation_report_dir" == / ||
  ! -d "$operation_report_dir" || -L "$operation_report_dir" ||
  ! -O "$operation_report_dir" ]]; then
  echo "--operation-report-dir 必须是当前操作者所有、预先创建的绝对普通目录，不能是根目录或符号链接。" >&2
  exit 2
fi
operation_report_dir=$(cd "$operation_report_dir" && pwd -P)
for required_command in date jq ln sha256sum stat; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf '生产恢复审计报告要求安装 %s。\n' "$required_command" >&2
    exit 127
  fi
done
umask 077
restore_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
restore_started_epoch=$(date -u +%s)
if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "必须通过受控审批记录提供 64 位小写 --expected-sha256；不得自动信任备份旁的 sidecar。" >&2
  exit 2
fi
if [[ ! -f "$backup_file" || -L "$backup_file" ]]; then
  printf '找不到备份文件：%s\n' "$backup_file" >&2
  exit 3
fi
signature_inputs=(
  "$attestation_file"
  "$signature_file"
  "$signing_public_key_file"
  "$expected_signing_key_sha256"
)
signature_input_count=0
for signature_input in "${signature_inputs[@]}"; do
  if [[ -n "$signature_input" ]]; then
    ((signature_input_count += 1))
  fi
done
if [[ "${FIATLUX_ENV:-development}" == production && $signature_input_count -ne 4 ]]; then
  echo "生产恢复要求显式提供 attestation、Ed25519 签名、公钥和独立批准的公钥指纹。" >&2
  exit 2
fi
if ((signature_input_count != 0 && signature_input_count != 4)); then
  echo "备份签名验证参数必须完整提供，不能部分启用。" >&2
  exit 2
fi
if [[ "$backup_file" == *.age && -z "$identity_file" ]]; then
  echo "加密备份需要 --identity。" >&2
  exit 2
fi
if [[ -n "$identity_file" && ! -r "$identity_file" ]]; then
  printf '无法读取 age 身份文件：%s\n' "$identity_file" >&2
  exit 3
fi
if [[ "${FIATLUX_ENV:-development}" == production && -z "$restore_pre_backup_dir" ]]; then
  echo "生产恢复要求显式设置独立的 RESTORE_PRE_BACKUP_DIR；归档源可以保持只读挂载。" >&2
  exit 2
fi
if [[ -z "${POSTGRES_RESTORE_PASSWORD:-}" ]]; then
  echo "恢复要求设置独立的 POSTGRES_RESTORE_PASSWORD。" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-development}" == production ]] &&
  [[ -z "${S3_RESTORE_ACCESS_KEY_ID:-}" || -z "${S3_RESTORE_SECRET_ACCESS_KEY:-}" ]]; then
  echo "生产恢复要求设置独立的 S3_RESTORE_ACCESS_KEY_ID/S3_RESTORE_SECRET_ACCESS_KEY。" >&2
  exit 2
fi
restore_access_key=${S3_RESTORE_ACCESS_KEY_ID:-fiatlux-restore}
restore_secret_key=${S3_RESTORE_SECRET_ACCESS_KEY:-fiatlux-dev-restore-password}

target_database=${POSTGRES_DB:-fiatlux_choice}
target_bucket=${S3_BUCKET:-fiatlux-choice}
expected_source_database=${expected_source_database:-$target_database}
expected_source_bucket=${expected_source_bucket:-$target_bucket}
if ((${#expected_source_id} > 128)) || [[ ! "$expected_source_id" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "必须提供受审的 --expected-source-id（最多 128 位安全字符）。" >&2
  exit 2
fi
if [[ ! "$expected_source_database" =~ ^[A-Za-z0-9_]+$ ]] ||
  [[ ! "$expected_source_bucket" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "预期来源数据库或对象桶格式无效。" >&2
  exit 2
fi
if [[ ! "$restore_image_version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "破坏性恢复要求 --restore-image-version 为 vMAJOR.MINOR.PATCH[-PRERELEASE]。" >&2
  exit 2
fi
expected_backup_tool_release=${expected_backup_tool_release:-$restore_image_version}
if ((${#expected_backup_tool_release} > 128)) ||
  [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "--expected-backup-tool-release 格式无效。" >&2
  exit 2
fi
if [[ -z "$release_manifest" || ! -f "$release_manifest" || -L "$release_manifest" ]]; then
  echo "破坏性恢复要求 --release-manifest 指向恢复工具版本的受审七组件清单。" >&2
  exit 2
fi
if [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "破坏性恢复要求独立受审的 64 位小写 --manifest-sha256。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "破坏性恢复要求 --expected-git-sha 提供受审恢复发布的完整 commit ID。" >&2
  exit 2
fi
if [[ "$database_confirmation" != "$target_database" || "$bucket_confirmation" != "$target_bucket" ]]; then
  printf '确认值必须精确匹配目标：数据库=%s，对象桶=%s。\n' "$target_database" "$target_bucket" >&2
  exit 2
fi

source_backup_dir=$(cd "$(dirname "$backup_file")" && pwd -P)
backup_basename=$(basename "$backup_file")
backup_file="$source_backup_dir/$backup_basename"
paths_overlap() {
  local first=$1
  local second=$2
  if [[ "$first" == "$second" ]]; then
    return 0
  fi
  if [[ "$second" == / ]]; then
    [[ "$first" == /* ]]
    return
  fi
  if [[ "$first" == / ]]; then
    [[ "$second" == /* ]]
    return
  fi
  [[ "$first" == "$second/"* || "$second" == "$first/"* ]]
}
if paths_overlap "$operation_report_dir" "$source_backup_dir"; then
  echo "恢复操作报告目录必须与只读归档源分离。" >&2
  exit 2
fi
if [[ ! -r "$backup_file" ]]; then
  printf '恢复归档不可读：%s\n' "$backup_file" >&2
  exit 3
fi
signature_verified=false
attestation_sha256=""
signing_key_fingerprint_sha256=""
backup_created_at=""
if ((signature_input_count == 4)); then
  attestation_file=$(cd "$(dirname "$attestation_file")" && pwd -P)/$(basename "$attestation_file")
  signature_file=$(cd "$(dirname "$signature_file")" && pwd -P)/$(basename "$signature_file")
  signing_public_key_file=$(cd "$(dirname "$signing_public_key_file")" && pwd -P)/$(basename "$signing_public_key_file")
  signature_result=$("$ROOT_DIR/scripts/verify-backup-attestation.sh" \
    --file "$backup_file" \
    --attestation "$attestation_file" \
    --signature "$signature_file" \
    --public-key "$signing_public_key_file" \
    --expected-signing-key-sha256 "$expected_signing_key_sha256" \
    --expected-sha256 "$expected_sha256" \
    --expected-source-id "$expected_source_id" \
    --expected-source-database "$expected_source_database" \
    --expected-source-bucket "$expected_source_bucket" \
    --expected-backup-tool-release "$expected_backup_tool_release")
  signature_verified=$(jq -er '.signatureVerified' <<<"$signature_result")
  attestation_sha256=$(jq -er '.attestationSha256' <<<"$signature_result")
  signing_key_fingerprint_sha256=$(jq -er '.signingKeyFingerprintSha256' <<<"$signature_result")
  backup_created_at=$(jq -er '.createdAt' "$attestation_file")
  if [[ "$signature_verified" != true ]]; then
    echo "备份签名验证未返回成功状态。" >&2
    exit 4
  fi
else
  echo "警告：该非生产恢复未验证备份创建者签名。" >&2
fi

release_manifest=$(cd "$(dirname "$release_manifest")" && pwd -P)/$(basename "$release_manifest")
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --manifest-only
"$ROOT_DIR/scripts/verify-deployment-source.sh" --expected-git-sha "$expected_git_sha"
archive_size=$(wc -c <"$backup_file" | tr -d '[:space:]')
if [[ ! "$archive_size" =~ ^[0-9]+$ ]]; then
  echo "无法读取恢复归档大小，拒绝继续。" >&2
  exit 3
fi
if [[ -z "$restore_pre_backup_dir" ]]; then
  restore_pre_backup_dir="$ROOT_DIR/tmp/restore-pre-backups"
fi
if [[ -e "$restore_pre_backup_dir" && -L "$restore_pre_backup_dir" ]]; then
  echo "RESTORE_PRE_BACKUP_DIR 不得是符号链接，拒绝继续。" >&2
  exit 2
fi
if [[ "$restore_pre_backup_dir" != /* ]]; then
  restore_pre_backup_dir="$ROOT_DIR/$restore_pre_backup_dir"
fi
if [[ -e "$restore_pre_backup_dir" && ! -d "$restore_pre_backup_dir" ]]; then
  printf 'RESTORE_PRE_BACKUP_DIR 不是目录：%s\n' "$restore_pre_backup_dir" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-development}" == production && -z "${FIATLUX_MAINTENANCE_DIR:-}" ]]; then
  echo "生产恢复要求显式设置稳定的 FIATLUX_MAINTENANCE_DIR。" >&2
  exit 2
fi
if [[ -z "${FIATLUX_MAINTENANCE_DIR:-}" ]]; then
  export FIATLUX_MAINTENANCE_DIR="$ROOT_DIR/tmp/maintenance"
fi
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}
if [[ "${FIATLUX_ENV:-development}" == production && -z "${RESTORE_SCRATCH_DIR:-}" ]]; then
  echo "生产恢复要求显式设置位于受保护加密文件系统的 RESTORE_SCRATCH_DIR。" >&2
  exit 2
fi
restore_scratch_dir=${RESTORE_SCRATCH_DIR:-$ROOT_DIR/tmp/restore-scratch}
mkdir -p "$restore_scratch_dir"
chmod 700 "$restore_scratch_dir"
restore_scratch_dir=$(cd "$restore_scratch_dir" && pwd -P)
export RESTORE_SCRATCH_DIR=$restore_scratch_dir
if paths_overlap "$operation_report_dir" "$restore_scratch_dir"; then
  echo "恢复操作报告目录必须与明文恢复 scratch 分离。" >&2
  exit 2
fi

maintenance_lock_acquire "$source_backup_dir" "restore-$backup_basename"
release_maintenance_lock() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$operation_report_partial" &&
    "$preserve_operation_report_partial" != true ]]; then
    rm -f -- "$operation_report_partial"
  fi
  if ! maintenance_lock_release && ((status == 0)); then
    status=7
  fi
  exit "$status"
}
trap release_maintenance_lock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

available_bytes() {
  local available_kib
  available_kib=$(df -Pk "$1" | awk 'END {print $4}')
  case "$available_kib" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo $((available_kib * 1024))
}

check_pre_backup_directory() {
  local directory=$1
  local label=$2
  local probe
  local free_bytes
  local required_bytes
  local capacity_margin=$((64 * 1024 * 1024))

  if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ]]; then
    printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
    return 2
  fi
  if [[ -e "$directory" ]]; then
    if [[ ! -d "$directory" ]]; then
      printf '%s 不是目录：%s\n' "$label" "$directory" >&2
      return 2
    fi
    directory=$(cd "$directory" && pwd -P)
    if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ||
      "$source_backup_dir" == "$directory/"* ]]; then
      printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
      return 2
    fi
  fi
  mkdir -p "$directory"
  directory=$(cd "$directory" && pwd -P)
  if [[ "$directory" == "$source_backup_dir" || "$directory" == "$source_backup_dir/"* ||
    "$source_backup_dir" == "$directory/"* ]]; then
    printf '%s 必须与只读恢复归档源目录分离：%s\n' "$label" "$directory" >&2
    return 2
  fi
  chmod 700 "$directory"
  probe="$directory/.fiatlux-restore-output-probe.$$"
  if [[ -e "$probe" || -L "$probe" ]]; then
    printf '%s 存在未解释的探针残留，拒绝继续：%s\n' "$label" "$probe" >&2
    return 5
  fi
  if ! (umask 077; : >"$probe") 2>/dev/null; then
    printf '%s 不可写，拒绝在破坏性恢复前继续：%s\n' "$label" "$directory" >&2
    return 2
  fi
  rm -f "$probe"
  if ((archive_size > (9223372036854775807 - capacity_margin) / 2)); then
    echo "恢复归档过大，无法安全计算恢复前备份容量下限。" >&2
    return 2
  fi
  required_bytes=$((archive_size * 2 + capacity_margin))
  if ! free_bytes=$(available_bytes "$directory") || ((free_bytes < required_bytes)); then
    printf '%s 可用空间不足：至少需要 %s bytes，实际 %s bytes。\n' \
      "$label" "$required_bytes" "${free_bytes:-unknown}" >&2
    return 2
  fi
}

if [[ "$skip_pre_backup" == false ]]; then
  check_pre_backup_directory "$restore_pre_backup_dir" "RESTORE_PRE_BACKUP_DIR"
  restore_pre_backup_dir=$(cd "$restore_pre_backup_dir" && pwd -P)
  backup_scratch_dir=${BACKUP_SCRATCH_DIR:-$ROOT_DIR/tmp/backup-scratch}
  if [[ "${FIATLUX_ENV:-development}" == production && -z "${BACKUP_SCRATCH_DIR:-}" ]]; then
    echo "生产恢复要求显式设置位于受保护加密文件系统的 BACKUP_SCRATCH_DIR。" >&2
    exit 2
  fi
  check_pre_backup_directory "$backup_scratch_dir" "BACKUP_SCRATCH_DIR"
  backup_scratch_dir=$(cd "$backup_scratch_dir" && pwd -P)
  if paths_overlap "$operation_report_dir" "$restore_pre_backup_dir" ||
    paths_overlap "$operation_report_dir" "$backup_scratch_dir"; then
    echo "恢复操作报告目录必须与恢复前输出和 backup scratch 分离。" >&2
    exit 2
  fi
  if [[ "$backup_scratch_dir" == "$restore_pre_backup_dir" ]]; then
    echo "RESTORE_PRE_BACKUP_DIR 与 BACKUP_SCRATCH_DIR 必须是不同目录。" >&2
    exit 2
  fi
  export RESTORE_PRE_BACKUP_DIR="$restore_pre_backup_dir"
  export BACKUP_SCRATCH_DIR="$backup_scratch_dir"
fi

chmod 700 "$operation_report_dir"
operation_report_dir_mode=$(stat -c '%a' "$operation_report_dir" 2>/dev/null ||
  stat -f '%Lp' "$operation_report_dir")
if [[ "$operation_report_dir_mode" != 700 ]]; then
  echo "恢复操作报告目录权限必须精确为 0700。" >&2
  exit 2
fi
operation_report_probe="$operation_report_dir/.fiatlux-restore-report-probe.$$"
if [[ -e "$operation_report_probe" || -L "$operation_report_probe" ]] ||
  ! (set -o noclobber; : >"$operation_report_probe") 2>/dev/null; then
  echo "恢复操作报告目录不可独占写入或存在未解释的探针残留。" >&2
  exit 2
fi
rm -f -- "$operation_report_probe"

operation_reports_root="$operation_report_dir/operations"
if [[ -e "$operation_reports_root" &&
  (! -d "$operation_reports_root" || -L "$operation_reports_root") ]]; then
  echo "恢复操作集合路径必须是普通目录且不能是符号链接。" >&2
  exit 2
fi
mkdir -p "$operation_reports_root"
chmod 700 "$operation_reports_root"
operation_reports_root=$(cd "$operation_reports_root" && pwd -P)
if [[ "$operation_reports_root" != "$operation_report_dir/operations" ]]; then
  echo "恢复操作集合目录解析后逃逸受控报告根目录。" >&2
  exit 2
fi
operation_evidence_dir="$operation_reports_root/$operation_id"
if [[ -e "$operation_evidence_dir" || -L "$operation_evidence_dir" ]] ||
  ! mkdir -m 700 "$operation_evidence_dir"; then
  echo "恢复 operation ID 已存在或无法原子保留，拒绝覆盖或复用。" >&2
  exit 2
fi
operation_report_path="$operation_evidence_dir/production-restore-$operation_id.json"
operation_report_partial="$operation_evidence_dir/.production-restore-$operation_id.json.partial"
technical_restore_mount_dir="$operation_evidence_dir/technical"
mkdir -m 700 "$technical_restore_mount_dir"
technical_restore_report_dir="$technical_restore_mount_dir/restore-reports"
technical_restore_report="$technical_restore_report_dir/restore-$operation_id.json"
technical_restore_report_partial="$technical_restore_report.partial"
if [[ -e "$operation_report_path" || -L "$operation_report_path" ||
  -e "$operation_report_partial" || -L "$operation_report_partial" ||
  -e "$technical_restore_report" || -L "$technical_restore_report" ||
  -e "$technical_restore_report_partial" || -L "$technical_restore_report_partial" ]]; then
  echo "新保留的恢复操作目录意外含有报告或 partial。" >&2
  exit 2
fi

# Compose mounts the source archive separately as /restore-source:ro.  The
# writable /backups mount is reserved for the pre-restore output and is reset to
# the normal deployment directory before the long-lived services are started.
export RESTORE_SOURCE_DIR="$source_backup_dir"
if [[ "$skip_pre_backup" == false ]]; then
  export BACKUP_DIR="$restore_pre_backup_dir"
else
  export BACKUP_DIR="$runtime_backup_dir"
fi

current_release=${APP_IMAGE_TAG:-unknown}
if [[ -r "$STATE_DIR/current" ]]; then
  current_release=$(<"$STATE_DIR/current")
fi

echo "拉取并核验显式选择的恢复发布七镜像。"
FIATLUX_VERSION_OVERRIDE=$restore_image_version "$COMPOSE" pull \
  api worker web caddy backup-tools minio postgres
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256"

current_postgres_version=$(postgres_current_binary_version "$COMPOSE" "$current_release")
target_postgres_version=$(postgres_release_binary_version "$COMPOSE" "$restore_image_version")
postgres_assert_release_transition \
  restore "$current_postgres_version" "$target_postgres_version" \
  "$postgres_minor_rollback_confirmation"

if [[ "$skip_pre_backup" == false ]]; then
  pre_name="pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  "$ROOT_DIR/scripts/backup.sh" --name "$pre_name" \
    --backup-image-version "$restore_image_version" --require-encryption
else
  echo "警告：已明确跳过恢复前备份。"
fi

export FIATLUX_VERSION_OVERRIDE=$restore_image_version

echo "进入维护窗口：停止入口、API 和 worker。"
"$COMPOSE" stop caddy api worker
echo "在任何数据替换前切换已核验的恢复发布 PostgreSQL。"
"$COMPOSE" up -d --wait --no-deps --force-recreate --no-build --pull never postgres

# The destructive container writes only its technical result to the dedicated
# operation evidence directory. It never writes to the approved source or the
# pre-restore backup directory.
export BACKUP_DIR="$technical_restore_mount_dir"
run_args=(
  run --rm --no-deps --pull never
  -e "BACKUP_FILE=/restore-source/$backup_basename"
  -e "BACKUP_EXPECTED_SHA256=$expected_sha256"
  -e "RESTORE_EXPECTED_SOURCE_ID=$expected_source_id"
  -e "RESTORE_EXPECTED_SOURCE_DATABASE=$expected_source_database"
  -e "RESTORE_EXPECTED_SOURCE_BUCKET=$expected_source_bucket"
  -e "RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=$expected_backup_tool_release"
  -e "RESTORE_SIGNATURE_VERIFIED=$signature_verified"
  -e "RESTORE_ATTESTATION_SHA256=$attestation_sha256"
  -e "RESTORE_SIGNING_KEY_FINGERPRINT_SHA256=$signing_key_fingerprint_sha256"
  -e "RESTORE_TOOL_RELEASE=$restore_image_version"
  -e "RESTORE_REPORT_ID=$operation_id"
  -e "RESTORE_CONFIRM_DATABASE=$target_database"
  -e "RESTORE_CONFIRM_BUCKET=$target_bucket"
  -e RESTORE_APPROVED=YES-I-UNDERSTAND
  -e PGUSER=fiatlux_restore
  -e "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD"
  -e "S3_ACCESS_KEY_ID=$restore_access_key"
  -e "S3_SECRET_ACCESS_KEY=$restore_secret_key"
)
if [[ -n "$identity_file" ]]; then
  identity_file=$(cd "$(dirname "$identity_file")" && pwd -P)/$(basename "$identity_file")
  run_args+=( -T -e BACKUP_AGE_IDENTITY_STDIN=true )
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container <"$identity_file"
else
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container
fi

if [[ ! -f "$technical_restore_report" || -L "$technical_restore_report" ]]; then
  echo "恢复容器未生成绑定 operation ID 的普通技术报告。" >&2
  exit 6
fi
if ! jq -e \
  --arg source "$backup_basename" \
  --arg archiveSha256 "$expected_sha256" \
  --arg sourceId "$expected_source_id" \
  --arg sourceDatabase "$expected_source_database" \
  --arg sourceBucket "$expected_source_bucket" \
  --arg backupToolRelease "$expected_backup_tool_release" \
  --arg restoreToolRelease "$restore_image_version" \
  --arg database "$target_database" \
  --arg bucket "$target_bucket" \
  --arg reportId "$operation_id" \
  --arg attestationSha256 "$attestation_sha256" \
  --arg signingKeyFingerprintSha256 "$signing_key_fingerprint_sha256" '
    .schemaVersion == 1 and .evidenceType == "technical_restore" and
    .result == "success" and .reportId == $reportId and
    .source == $source and .archiveSha256 == $archiveSha256 and
    .approvedDigestMatched == true and .checksumVerified == true and
    .metadataVerified == true and .objectsVerified == true and
    .sourceId == $sourceId and .sourceDatabase == $sourceDatabase and
    .sourceBucket == $sourceBucket and .backupToolRelease == $backupToolRelease and
    .restoreToolRelease == $restoreToolRelease and .database == $database and
    .bucket == $bucket and
    (.objectCount | type == "number" and . >= 0 and floor == .) and
    (.objectBytes | type == "number" and . >= 0 and floor == .) and
    (.restoredAt | type == "string" and
      test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and
    (.objectManifestSha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (if $attestationSha256 == "" then
       .signatureVerified == false and .attestationSha256 == null and
       .signingKeyFingerprintSha256 == null
     else
       .signatureVerified == true and .attestationSha256 == $attestationSha256 and
       .signingKeyFingerprintSha256 == $signingKeyFingerprintSha256
     end)
  ' "$technical_restore_report" >/dev/null; then
  echo "恢复容器技术报告与受审归档、目标或签名身份不一致。" >&2
  exit 6
fi
technical_restore_report_mode=$(stat -c '%a' "$technical_restore_report" 2>/dev/null ||
  stat -f '%Lp' "$technical_restore_report")
if [[ "$technical_restore_report_mode" != 600 ]]; then
  echo "技术恢复报告权限必须精确为 0600。" >&2
  exit 6
fi
technical_restore_report_sha256=$(sha256sum "$technical_restore_report" | awk '{print $1}')
technical_restored_at=$(jq -er '.restoredAt' "$technical_restore_report")
restored_object_count=$(jq -er '.objectCount' "$technical_restore_report")
restored_object_bytes=$(jq -er '.objectBytes' "$technical_restore_report")
restored_object_manifest_sha256=$(jq -er '.objectManifestSha256' "$technical_restore_report")

# Runtime services must continue to use the normal deployment backup volume;
# only the one-shot restore container reads the approved source mount.
export BACKUP_DIR="$runtime_backup_dir"

echo "执行显式恢复版本数据库迁移。"
"$COMPOSE" run --rm --no-deps --pull never migrate
echo "执行 pg-boss 迁移并重新收敛运行时授权。"
"$COMPOSE" run --rm --no-deps --pull never queue-migrate
"$COMPOSE" run --rm --no-deps --pull never database-permissions

echo "重新启动并等待健康检查。"
"$COMPOSE" up -d --wait --no-build --pull never minio minio-bootstrap api worker web caddy
"$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$restore_image_version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --check-running-services
"$ROOT_DIR/scripts/verify-deployment.sh"

restore_finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
restore_finished_epoch=$(date -u +%s)
restore_duration_seconds=$((restore_finished_epoch - restore_started_epoch))
if [[ "$skip_pre_backup" == true ]]; then
  pre_restore_backup_created=false
else
  pre_restore_backup_created=true
fi
if ! (set -o noclobber; umask 077; jq -n \
  --arg generatedAt "$restore_finished_at" \
  --arg operationId "$operation_id" \
  --arg environmentId "$environment_id" \
  --arg environmentClassification "${FIATLUX_ENV:-development}" \
  --arg operatorIdentity "$operator_identity" \
  --arg approvalReference "$approval_reference" \
  --arg approvalReason "$approval_reason" \
  --arg startedAt "$restore_started_at" \
  --arg finishedAt "$restore_finished_at" \
  --arg currentRelease "$current_release" \
  --arg restoreVersion "$restore_image_version" \
  --arg gitSha "$expected_git_sha" \
  --arg manifestSha256 "$manifest_sha256" \
  --arg archiveFile "$backup_basename" \
  --arg archiveSha256 "$expected_sha256" \
  --arg backupCreatedAt "$backup_created_at" \
  --arg sourceId "$expected_source_id" \
  --arg sourceDatabase "$expected_source_database" \
  --arg sourceBucket "$expected_source_bucket" \
  --arg backupToolRelease "$expected_backup_tool_release" \
  --arg attestationSha256 "$attestation_sha256" \
  --arg signingKeyFingerprintSha256 "$signing_key_fingerprint_sha256" \
  --arg targetDatabase "$target_database" \
  --arg targetBucket "$target_bucket" \
  --arg technicalRestoredAt "$technical_restored_at" \
  --arg technicalReportSha256 "$technical_restore_report_sha256" \
  --arg objectManifestSha256 "$restored_object_manifest_sha256" \
  --argjson durationSeconds "$restore_duration_seconds" \
  --argjson archiveBytes "$archive_size" \
  --argjson signatureVerified "$signature_verified" \
  --argjson preRestoreBackupCreated "$pre_restore_backup_created" \
  --argjson objectCount "$restored_object_count" \
  --argjson objectBytes "$restored_object_bytes" '
    {
      schemaVersion: 1,
      evidenceType: "production_restore_operation",
      generatedAt: $generatedAt,
      result: "success",
      operationId: $operationId,
      environment: {
        environmentId: $environmentId,
        classification: $environmentClassification
      },
      approval: {
        operatorIdentity: $operatorIdentity,
        assertedApprovalReference: $approvalReference,
        reason: $approvalReason,
        approvalIndependentlyVerified: false
      },
      candidate: {
        previousRelease: $currentRelease,
        restoreVersion: $restoreVersion,
        gitSha: $gitSha,
        releaseManifestSha256: $manifestSha256
      },
      backup: {
        archiveFile: $archiveFile,
        archiveSha256: $archiveSha256,
        archiveBytes: $archiveBytes,
        createdAt: (if $backupCreatedAt == "" then null else $backupCreatedAt end),
        sourceId: $sourceId,
        sourceDatabase: $sourceDatabase,
        sourceBucket: $sourceBucket,
        backupToolRelease: $backupToolRelease,
        signatureVerified: $signatureVerified,
        attestationSha256: (if $signatureVerified then $attestationSha256 else null end),
        signingKeyFingerprintSha256: (if $signatureVerified then $signingKeyFingerprintSha256 else null end)
      },
      target: {
        database: $targetDatabase,
        bucket: $targetBucket
      },
      execution: {
        startedAt: $startedAt,
        finishedAt: $finishedAt,
        durationSeconds: $durationSeconds,
        destructiveRestorePerformed: true,
        preRestoreBackupCreated: $preRestoreBackupCreated,
        technicalRestoreCompletedAt: $technicalRestoredAt
      },
      checks: {
        archiveDigestAndSignature: true,
        releaseManifestAndCleanSource: true,
        technicalRestoreReportSha256: $technicalReportSha256,
        objectsVerified: true,
        objectCount: $objectCount,
        objectBytes: $objectBytes,
        objectManifestSha256: $objectManifestSha256,
        migrationsPermissionsImagesHealth: true,
        releaseStateRecorded: true
      },
      boundaries: [
        "The approval reference, operator identity and reason are supplied by the operator and must be verified through an independent company approval channel.",
        "This success report proves that the restore script completed its technical checks; it does not independently prove approval authenticity, business RPO/RTO acceptance or off-host media independence.",
        "A fixture or non-production report cannot close the production_backup_restore V1 gate."
      ]
    }
  ' >"$operation_report_partial"); then
  echo "无法以不可覆盖方式创建恢复操作报告 partial。" >&2
  exit 6
fi
chmod 600 "$operation_report_partial"
operation_report_sha256=$(sha256sum "$operation_report_partial" | awk '{print $1}')

mkdir -p "$STATE_DIR/manifests"
chmod 700 "$STATE_DIR" "$STATE_DIR/manifests"
manifest_record="$STATE_DIR/manifests/$restore_image_version.tsv"
manifest_record_partial="$STATE_DIR/manifests/.$restore_image_version.tsv.partial.$$"
install -m 600 "$release_manifest" "$manifest_record_partial"
recorded_manifest_sha256=$(sha256sum "$manifest_record_partial" | awk '{print $1}')
if [[ "$recorded_manifest_sha256" != "$manifest_sha256" ]]; then
  rm -f "$manifest_record_partial"
  echo "写入本机恢复发布状态时清单发生变化，拒绝记录版本。" >&2
  exit 6
fi
mv "$manifest_record_partial" "$manifest_record"
printf '%s  %s\n' "$manifest_sha256" "$restore_image_version.tsv" \
  >"$STATE_DIR/manifests/$restore_image_version.tsv.sha256"
chmod 600 "$STATE_DIR/manifests/$restore_image_version.tsv.sha256"
printf '%s\n' "$current_release" >"$STATE_DIR/previous"
printf '%s\n' "$restore_image_version" >"$STATE_DIR/current"
printf '%s\trestore\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$current_release" "$restore_image_version" \
  "$expected_git_sha" "$manifest_sha256" "$expected_sha256" \
  "${signing_key_fingerprint_sha256:-unsigned}" "${attestation_sha256:-unsigned}" \
  "$operation_id" "$environment_id" "$operator_identity" "$approval_reference" \
  "$operation_report_sha256" \
  >>"$STATE_DIR/history.tsv"
chmod 600 "$STATE_DIR/current" "$STATE_DIR/previous" "$STATE_DIR/history.tsv"
preserve_operation_report_partial=true
if ! ln "$operation_report_partial" "$operation_report_path"; then
  echo "恢复已完成并记录状态，但无法原子发布不可覆盖操作报告；必须人工调查。" >&2
  exit 6
fi
rm -f -- "$operation_report_partial"
operation_report_partial=""
preserve_operation_report_partial=false
printf '生产恢复技术流程完成：report=%s sha256=%s approvalIndependentlyVerified=false\n' \
  "$operation_report_path" "$operation_report_sha256"
