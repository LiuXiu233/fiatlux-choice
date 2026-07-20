#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
expected_source_id=${RESTORE_EXPECTED_SOURCE_ID:-${BACKUP_SOURCE_ID:-}}
expected_source_database=${RESTORE_EXPECTED_SOURCE_DATABASE:-${POSTGRES_DB:-fiatlux_choice}}
expected_source_bucket=${RESTORE_EXPECTED_SOURCE_BUCKET:-${S3_BUCKET:-fiatlux-choice}}
expected_backup_tool_release=${RESTORE_EXPECTED_BACKUP_TOOL_RELEASE:-}
restore_drill_report_dir=${RESTORE_DRILL_REPORT_DIR:-}
unset FIATLUX_ENV_FILE LLM_BASE_URL LLM_API_KEY LLM_MODEL GITHUB_TOKEN
export LLM_DRIVER=mock
export GITHUB_INTEGRATION_MODE=manual

usage() {
  cat <<'EOF'
用法：./scripts/restore-drill.sh --file FILE --expected-sha256 SHA256 \
       [--expected-source-id SOURCE_ID --expected-source-database DB \
        --expected-source-bucket BUCKET] --expected-backup-tool-release VERSION \
       --attestation FILE --signature FILE --signing-public-key FILE \
       --expected-signing-key-sha256 SHA256 \
       [--identity AGE_IDENTITY]

在随机 Compose 项目和全新卷中恢复；默认结束后销毁演练环境。
设置 KEEP_RESTORE_STACK=1 可在故障调查时保留环境。
EOF
}

backup_file=""
identity_file=""
attestation_file=${BACKUP_ATTESTATION_FILE:-}
signature_file=${BACKUP_SIGNATURE_FILE:-}
signing_public_key_file=${BACKUP_SIGNING_PUBLIC_KEY_FILE:-}
expected_signing_key_sha256=${BACKUP_SIGNING_PUBLIC_KEY_SHA256:-}
expected_sha256=${BACKUP_EXPECTED_SHA256:-}
while (($#)); do
  case "$1" in
    --file)
      backup_file=${2:?--file 需要值}
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
    --expected-backup-tool-release)
      expected_backup_tool_release=${2:?--expected-backup-tool-release 需要值}
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

if [[ -z "$backup_file" || ! -f "$backup_file" || -L "$backup_file" ]]; then
  usage >&2
  exit 2
fi
if [[ -z "$attestation_file" || -z "$signature_file" || -z "$signing_public_key_file" ||
  ! "$expected_signing_key_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "恢复演练要求完整提供签名 attestation、Ed25519 签名、公钥和独立批准的公钥指纹。" >&2
  exit 2
fi
if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "恢复演练要求提供来自受控审批记录的 64 位小写 --expected-sha256。" >&2
  exit 2
fi
if ((${#expected_source_id} > 128)) || [[ ! "$expected_source_id" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "恢复演练要求 BACKUP_SOURCE_ID 或 --expected-source-id。" >&2
  exit 2
fi
if [[ ! "$expected_source_database" =~ ^[A-Za-z0-9_]+$ ]] ||
  [[ ! "$expected_source_bucket" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "恢复演练的预期来源数据库或对象桶格式无效。" >&2
  exit 2
fi
if [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]] ||
  ((${#expected_backup_tool_release} > 128)); then
  echo "恢复演练要求提供受审的 --expected-backup-tool-release。" >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-development}" == production && -z "$restore_drill_report_dir" ]]; then
  echo "生产恢复演练要求显式设置独立的 RESTORE_DRILL_REPORT_DIR。" >&2
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

acceptance_manifest="$ROOT_DIR/packages/db/restore-acceptance.json"
migration_journal="$ROOT_DIR/packages/db/migrations/meta/_journal.json"
if ! command -v jq >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
  echo "精确恢复演练要求主机安装 jq 与 sha256sum。" >&2
  exit 127
fi
if [[ ! -f "$acceptance_manifest" || -L "$acceptance_manifest" ]] ||
  ! jq -e '
    .formatVersion == 1 and
    (.publicTables | type == "array" and length > 0) and
    all(.publicTables[]; type == "string" and test("^[a-z][a-z0-9_]*$")) and
    ((.publicTables | unique | length) == (.publicTables | length)) and
    .publicTables == (.publicTables | sort) and
    ((.pgBossSchemaVersion | type) == "number") and
    .pgBossSchemaVersion > 0 and
    (.pgBossSchemaVersion | floor) == .pgBossSchemaVersion
  ' "$acceptance_manifest" >/dev/null; then
  echo "版本化恢复验收清单缺失或格式无效。" >&2
  exit 4
fi
if [[ ! -f "$migration_journal" || -L "$migration_journal" ]] ||
  ! jq -e '
    .dialect == "postgresql" and
    (.entries | type == "array" and length > 0) and
    all(.entries[]; (.idx | type == "number") and (.when | type == "number") and
      (.tag | type == "string" and test("^[0-9]{4}_[A-Za-z0-9_]+$"))) and
    all(.entries | to_entries[]; .key == .value.idx)
  ' "$migration_journal" >/dev/null; then
  echo "Drizzle migration journal 缺失、非连续或格式无效。" >&2
  exit 4
fi
expected_public_tables_json=$(jq -c '.publicTables' "$acceptance_manifest")
expected_public_table_count=$(jq '.publicTables | length' "$acceptance_manifest")
expected_pgboss_version=$(jq -r '.pgBossSchemaVersion' "$acceptance_manifest")

stamp=$(date -u +%Y%m%d%H%M%S)
export COMPOSE_PROJECT_NAME="fiatlux-restore-$stamp-$$"
if [[ ! "$COMPOSE_PROJECT_NAME" =~ ^fiatlux-restore-[A-Za-z0-9-]+$ ]]; then
  echo "演练项目名安全检查失败。" >&2
  exit 4
fi

source_backup_dir=$(cd "$(dirname "$backup_file")" && pwd -P)
backup_basename=$(basename "$backup_file")
backup_file="$source_backup_dir/$backup_basename"
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
if [[ "$signature_verified" != true ]]; then
  echo "恢复演练的备份签名验证未返回成功状态。" >&2
  exit 4
fi
if [[ -z "$restore_drill_report_dir" ]]; then
  restore_drill_report_dir="$ROOT_DIR/tmp/restore-drill-reports"
fi
if [[ "$restore_drill_report_dir" != /* ]]; then
  restore_drill_report_dir="$ROOT_DIR/$restore_drill_report_dir"
fi
if [[ -e "$restore_drill_report_dir" && -L "$restore_drill_report_dir" ]]; then
  echo "RESTORE_DRILL_REPORT_DIR 不得是符号链接。" >&2
  exit 2
fi
if [[ -e "$restore_drill_report_dir" && ! -d "$restore_drill_report_dir" ]]; then
  echo "RESTORE_DRILL_REPORT_DIR 不是目录。" >&2
  exit 2
fi
mkdir -p "$restore_drill_report_dir"
chmod 700 "$restore_drill_report_dir"
restore_drill_report_dir=$(cd "$restore_drill_report_dir" && pwd -P)
if [[ "$restore_drill_report_dir" == "$source_backup_dir" ||
  "$restore_drill_report_dir" == "$source_backup_dir/"* ||
  "$source_backup_dir" == "$restore_drill_report_dir/"* ]]; then
  echo "RESTORE_DRILL_REPORT_DIR 必须与只读恢复归档源目录分离。" >&2
  exit 2
fi
report_probe="$restore_drill_report_dir/.fiatlux-restore-drill-probe.$$"
if [[ -e "$report_probe" || -L "$report_probe" ]] || ! (umask 077; : >"$report_probe"); then
  echo "RESTORE_DRILL_REPORT_DIR 不可写。" >&2
  exit 2
fi
rm -f "$report_probe"
export BACKUP_DIR="$restore_drill_report_dir"
export RESTORE_SOURCE_DIR="$source_backup_dir"
restore_scratch_parent=${RESTORE_SCRATCH_DIR:-$ROOT_DIR/tmp/restore-scratch}
mkdir -p "$restore_scratch_parent"
chmod 700 "$restore_scratch_parent"
restore_scratch_parent=$(cd "$restore_scratch_parent" && pwd -P)
restore_scratch_dir=$(mktemp -d "$restore_scratch_parent/restore-drill.XXXXXX")
chmod 700 "$restore_scratch_dir"
export RESTORE_SCRATCH_DIR=$restore_scratch_dir
expected_migrations_file=""
export FIATLUX_ENV=development
export HOST_UID=${HOST_UID:-$(id -u)}
export HOST_GID=${HOST_GID:-$(id -g)}
export POSTGRES_DB=fiatlux_restore
export POSTGRES_BOOTSTRAP_USER=fiatlux_bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=$(openssl rand -hex 24)
POSTGRES_MIGRATION_PASSWORD=$(openssl rand -hex 24)
POSTGRES_RUNTIME_PASSWORD=$(openssl rand -hex 24)
POSTGRES_BACKUP_PASSWORD=$(openssl rand -hex 24)
POSTGRES_RESTORE_PASSWORD=$(openssl rand -hex 24)
export POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATION_PASSWORD POSTGRES_RUNTIME_PASSWORD
export POSTGRES_BACKUP_PASSWORD POSTGRES_RESTORE_PASSWORD
export S3_BUCKET=fiatlux-restore
export MINIO_ROOT_USER=fiatluxrestore
MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
export S3_ACCESS_KEY_ID=fiatlux-restore-app
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
export S3_BACKUP_ACCESS_KEY_ID=fiatlux-restore-backup
S3_BACKUP_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
export S3_RESTORE_ACCESS_KEY_ID=fiatlux-restore-operator
S3_RESTORE_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
export MINIO_ROOT_PASSWORD S3_SECRET_ACCESS_KEY S3_BACKUP_SECRET_ACCESS_KEY
export S3_RESTORE_SECRET_ACCESS_KEY SESSION_SECRET
export INITIAL_ADMIN_EMAIL=restore-drill@fiatlux.local
INITIAL_ADMIN_PASSWORD=$(openssl rand -hex 24)
export INITIAL_ADMIN_PASSWORD

report="$restore_drill_report_dir/restore-drill-$stamp.log"
exec > >(tee -a "$report") 2>&1

path_mode() {
  local mode
  mode=$(stat -c '%a' "$1" 2>/dev/null || true)
  if [[ -n "$mode" ]]; then
    printf '%s\n' "$mode"
  else
    stat -f '%Lp' "$1"
  fi
}

path_uid() {
  local uid
  uid=$(stat -c '%u' "$1" 2>/dev/null || true)
  if [[ -n "$uid" ]]; then
    printf '%s\n' "$uid"
  else
    stat -f '%u' "$1"
  fi
}

path_links() {
  local links
  links=$(stat -c '%h' "$1" 2>/dev/null || true)
  if [[ -n "$links" ]]; then
    printf '%s\n' "$links"
  else
    stat -f '%l' "$1"
  fi
}

assert_contract_tmp_parent_safe() {
  local candidate=$1
  local current=$candidate
  local mode numeric_mode parent
  if [[ ! -d "$candidate" || -L "$candidate" || ! -w "$candidate" ]]; then
    printf '恢复契约临时目录必须是可写真实目录：%s\n' "$candidate" >&2
    return 4
  fi
  while :; do
    if [[ ! -d "$current" || -L "$current" ]]; then
      printf '恢复契约临时目录父链缺失或包含符号链接：%s\n' "$current" >&2
      return 4
    fi
    mode=$(path_mode "$current")
    if [[ ! "$mode" =~ ^[0-7]{3,4}$ ]]; then
      printf '无法验证恢复契约临时目录父链权限：%s\n' "$current" >&2
      return 4
    fi
    numeric_mode=$((8#$mode))
    if ((numeric_mode & 8#022)) && ! ((numeric_mode & 8#1000)); then
      printf '恢复契约临时目录父链可由他人写入且无 sticky bit：%s（mode=%s）\n' \
        "$current" "$mode" >&2
      return 4
    fi
    parent=$(dirname "$current")
    [[ "$parent" == "$current" ]] && break
    current=$parent
  done
}

cleanup_expected_migrations() {
  local owner links
  [[ -n "$expected_migrations_file" ]] || return 0
  if [[ ! -f "$expected_migrations_file" || -L "$expected_migrations_file" ]]; then
    printf '恢复契约临时文件消失或被替换，拒绝跟随删除：%s\n' \
      "$expected_migrations_file" >&2
    return 7
  fi
  owner=$(path_uid "$expected_migrations_file")
  links=$(path_links "$expected_migrations_file")
  if [[ "$owner" != "$EUID" || "$links" != 1 ]]; then
    printf '恢复契约临时文件 owner/link 状态改变，拒绝删除：%s\n' \
      "$expected_migrations_file" >&2
    return 7
  fi
  rm -f "$expected_migrations_file"
  expected_migrations_file=""
}

cleanup() {
  status=$?
  if [[ "${KEEP_RESTORE_STACK:-0}" == 1 ]]; then
    printf '保留演练环境：COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
  else
    if [[ "$COMPOSE_PROJECT_NAME" == fiatlux-restore-* ]]; then
      "$COMPOSE" down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
  fi
  if ! cleanup_expected_migrations && ((status == 0)); then
    status=7
  fi
  rm -rf "$restore_scratch_dir"
  printf '恢复演练报告：%s\n' "$report"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

contract_tmp_parent=$(cd "${TMPDIR:-/tmp}" && pwd -P)
assert_contract_tmp_parent_safe "$contract_tmp_parent"
for forbidden_tree in \
  "$source_backup_dir" "$restore_drill_report_dir" \
  "$restore_scratch_parent" "$restore_scratch_dir"; do
  if [[ "$contract_tmp_parent" == "$forbidden_tree" ||
    "$contract_tmp_parent" == "$forbidden_tree/"* ]]; then
    printf '恢复契约临时目录不得位于备份、报告或 restore scratch 树中：%s\n' \
      "$contract_tmp_parent" >&2
    exit 4
  fi
done
if [[ -n "${BACKUP_APPROVED_MANIFEST_DIR:-}" && -d "$BACKUP_APPROVED_MANIFEST_DIR" ]]; then
  approved_manifest_dir_canonical=$(cd "$BACKUP_APPROVED_MANIFEST_DIR" && pwd -P)
  if [[ "$contract_tmp_parent" == "$approved_manifest_dir_canonical" ||
    "$contract_tmp_parent" == "$approved_manifest_dir_canonical/"* ]]; then
    echo "恢复契约临时目录不得位于批准清单树中。" >&2
    exit 4
  fi
fi

previous_umask=$(umask)
umask 077
expected_migrations_file=$(mktemp "$contract_tmp_parent/fiatlux-restore-contract.XXXXXX")
umask "$previous_umask"
chmod 0600 "$expected_migrations_file"
expected_file_mode=$(path_mode "$expected_migrations_file")
expected_file_owner=$(path_uid "$expected_migrations_file")
expected_file_links=$(path_links "$expected_migrations_file")
if [[ ! -f "$expected_migrations_file" || -L "$expected_migrations_file" ||
  "$expected_file_mode" != 600 || "$expected_file_owner" != "$EUID" ||
  "$expected_file_links" != 1 ]]; then
  echo "恢复契约临时文件 owner/mode/link 验证失败。" >&2
  exit 4
fi

expected_index=0
while IFS=$'\t' read -r migration_index migration_when migration_tag; do
  if [[ "$migration_index" != "$expected_index" ]]; then
    printf 'Drizzle migration journal idx 不连续：expected=%s actual=%s。\n' \
      "$expected_index" "$migration_index" >&2
    exit 4
  fi
  printf -v expected_prefix '%04d' "$expected_index"
  if [[ "$migration_tag" != "$expected_prefix"_* ]]; then
    printf 'Drizzle migration tag 与 idx 不匹配：idx=%s tag=%s。\n' \
      "$migration_index" "$migration_tag" >&2
    exit 4
  fi
  migration_file="$ROOT_DIR/packages/db/migrations/$migration_tag.sql"
  if [[ ! -f "$migration_file" || -L "$migration_file" ]]; then
    printf 'Drizzle migration journal 对应 SQL 缺失：%s。\n' "$migration_file" >&2
    exit 4
  fi
  migration_sha256=$(sha256sum "$migration_file" | awk '{print $1}')
  printf '%s\t%s\t%s\n' "$migration_when" "$migration_sha256" "$migration_tag" \
    >>"$expected_migrations_file"
  ((expected_index += 1))
done < <(jq -r '.entries[] | [.idx, .when, .tag] | @tsv' "$migration_journal")
expected_migration_count=$(jq '.entries | length' "$migration_journal")
if ((expected_index != expected_migration_count)); then
  echo "派生的 Drizzle migration 数与 journal 不一致。" >&2
  exit 4
fi
expected_migrations_json=$(jq -Rn '
  [inputs | split("\t") | {createdAt: .[0], hash: .[1]}]
' <"$expected_migrations_file")
expected_first_migration=$(awk -F '\t' 'NR == 1 {print $3}' "$expected_migrations_file")
expected_last_migration=$(awk -F '\t' 'END {print $3}' "$expected_migrations_file")

echo "启动隔离的 PostgreSQL 与 MinIO：$COMPOSE_PROJECT_NAME"
"$COMPOSE" up -d --wait --no-build --pull never postgres minio
"$COMPOSE" run --rm --no-deps --pull never db-bootstrap
"$COMPOSE" run --rm --no-deps --pull never minio-bootstrap

"$COMPOSE" run --rm --no-deps --pull never \
  -e PGUSER=fiatlux_restore -e "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD" \
  backup-tools sh -ec \
  'psql --set=ON_ERROR_STOP=1 --command "SET ROLE fiatlux_migrator; CREATE TABLE restore_preflight_sentinel(value text NOT NULL); INSERT INTO restore_preflight_sentinel VALUES ('\''database-unchanged'\'')"'
# Variables in the single-quoted program intentionally expand inside backup-tools.
# shellcheck disable=SC2016
"$COMPOSE" run --rm --no-deps --pull never \
  -e "S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID" -e "S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY" \
  backup-tools sh -ec '
    printf object-unchanged >/tmp/restore-preflight-sentinel
    mc alias set sentinel "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
    mc cp /tmp/restore-preflight-sentinel "sentinel/$S3_BUCKET/restore-preflight-sentinel" >/dev/null
  '

restore_report_id="drill-$stamp-$$"
restore_report_path="$restore_drill_report_dir/restore-reports/restore-$restore_report_id.json"
run_args=(
  run --rm --no-deps --pull never
  -e "BACKUP_FILE=/restore-source/$backup_basename"
  -e "BACKUP_EXPECTED_SHA256=$expected_sha256"
  -e "RESTORE_EXPECTED_SOURCE_ID=$expected_source_id"
  -e "RESTORE_EXPECTED_SOURCE_DATABASE=$expected_source_database"
  -e "RESTORE_EXPECTED_SOURCE_BUCKET=$expected_source_bucket"
  -e "RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=$expected_backup_tool_release"
  -e RESTORE_SIGNATURE_VERIFIED=true
  -e "RESTORE_ATTESTATION_SHA256=$attestation_sha256"
  -e "RESTORE_SIGNING_KEY_FINGERPRINT_SHA256=$signing_key_fingerprint_sha256"
  -e "RESTORE_TOOL_RELEASE=${APP_IMAGE_TAG:-local}"
  -e "RESTORE_REPORT_ID=$restore_report_id"
  -e "RESTORE_CONFIRM_DATABASE=$POSTGRES_DB"
  -e "RESTORE_CONFIRM_BUCKET=$S3_BUCKET"
  -e RESTORE_APPROVED=YES-I-UNDERSTAND
  -e PGUSER=fiatlux_restore
  -e "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD"
  -e "S3_ACCESS_KEY_ID=$S3_RESTORE_ACCESS_KEY_ID"
  -e "S3_SECRET_ACCESS_KEY=$S3_RESTORE_SECRET_ACCESS_KEY"
)

negative_args=("${run_args[@]}" -e S3_SECRET_ACCESS_KEY=invalid-restore-secret -e RESTORE_PREFLIGHT_ONLY=true)
set +e
if [[ -n "$identity_file" ]]; then
  identity_file=$(cd "$(dirname "$identity_file")" && pwd -P)/$(basename "$identity_file")
  "$COMPOSE" "${negative_args[@]}" -T -e BACKUP_AGE_IDENTITY_STDIN=true \
    backup-tools restore-container <"$identity_file" >/dev/null 2>&1
else
  "$COMPOSE" "${negative_args[@]}" backup-tools restore-container >/dev/null 2>&1
fi
negative_restore_exit=$?
set -e
if ((negative_restore_exit == 0)); then
  echo "错误 S3 恢复凭据未使破坏前置检查失败。" >&2
  exit 5
fi
database_sentinel=$("$COMPOSE" run --rm --no-deps --pull never \
  -e PGUSER=fiatlux_restore -e "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD" \
  backup-tools sh -ec \
  'psql --quiet --tuples-only --no-align --command "SET ROLE fiatlux_migrator; SELECT value FROM restore_preflight_sentinel"')
# Variables in the single-quoted program intentionally expand inside backup-tools.
# shellcheck disable=SC2016
object_sentinel=$("$COMPOSE" run --rm --no-deps --pull never \
  -e "S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID" -e "S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY" \
  backup-tools sh -ec '
    mc alias set sentinel "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
    mc cat "sentinel/$S3_BUCKET/restore-preflight-sentinel"
  ')
if [[ "$database_sentinel" != database-unchanged || "$object_sentinel" != object-unchanged ]]; then
  printf '错误 S3 凭据后目标发生变化：database=%s object=%s\n' \
    "$database_sentinel" "$object_sentinel" >&2
  exit 5
fi
echo "错误 S3 恢复凭据负向测试通过：数据库与对象桶均未改变。"

if [[ -n "$identity_file" ]]; then
  run_args+=( -T -e BACKUP_AGE_IDENTITY_STDIN=true )
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container <"$identity_file"
else
  "$COMPOSE" "${run_args[@]}" backup-tools restore-container
fi

echo "在恢复数据上执行当前迁移。"
"$COMPOSE" run --rm --no-deps --pull never migrate
"$COMPOSE" run --rm --no-deps --pull never queue-migrate
"$COMPOSE" run --rm --no-deps --pull never database-permissions

echo "启动 API 与 worker，等待应用健康。"
"$COMPOSE" up -d --wait --no-build --pull never api worker
ready_output=$("$COMPOSE" exec -T api node -e '
  fetch("http://127.0.0.1:3000/health/ready")
    .then(async (response) => {
      const body = await response.json();
      const checks = body?.data?.checks;
      if (!response.ok || body?.data?.status !== "ready" ||
          checks?.database !== "ready" || checks?.queue !== "ready" ||
          checks?.objectStorage !== "ready") process.exit(1);
      process.stdout.write(JSON.stringify(body));
    })
    .catch((error) => { console.error(error); process.exit(1); });
')
printf 'ready=%s\n' "$ready_output"

worker_container_id=$("$COMPOSE" ps -q worker)
worker_health=$(docker inspect --format \
  '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$worker_container_id")
if [[ "$worker_health" != healthy ]]; then
  printf '恢复 worker 健康检查未通过：%s。\n' "$worker_health" >&2
  exit 5
fi

# JavaScript template parameters intentionally remain inside the single-quoted Node program.
# shellcheck disable=SC2016
database_verification=$("$COMPOSE" exec -T api node --input-type=module -e '
  import postgres from "/app/packages/db/node_modules/postgres/src/index.js";
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const publicTableRows = await sql`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = ${"public"} ORDER BY tablename
    `;
    const migrationRows = await sql`
      SELECT created_at::text AS "createdAt", hash
      FROM drizzle.__drizzle_migrations ORDER BY created_at
    `;
    const [pgBossVersion] = await sql`SELECT version FROM pgboss.version`;
    const pgBossTableRows = await sql`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = ${"pgboss"} ORDER BY tablename
    `;
    const [runtimePosture] = await sql`
      SELECT
        current_user AS role,
        r.rolsuper AS superuser,
        r.rolcreatedb AS createdb,
        r.rolcreaterole AS createrole,
        r.rolbypassrls AS bypassrls,
        has_schema_privilege(current_user, ${"public"}, ${"CREATE"}) AS "schemaCreate",
        has_table_privilege(current_user, ${"public.audit_events"}, ${"UPDATE"}) AS "auditUpdate",
        has_table_privilege(current_user, ${"public.audit_events"}, ${"DELETE"}) AS "auditDelete",
        pg_has_role(current_user, ${"fiatlux_migrator"}, ${"MEMBER"}) AS "migratorMember",
        t.tgenabled AS "triggerMode",
        pg_get_userbyid(c.relowner) AS "auditOwner"
      FROM pg_roles r
      JOIN pg_trigger t ON t.tgname = ${"audit_events_prevent_update_delete"}
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE r.rolname = current_user
    `;
    const [privileges] = await sql`
      SELECT
        has_table_privilege(${"fiatlux_runtime"}, ${"public.organizations"}, ${"SELECT"}) AS "runtimeSelect",
        has_table_privilege(${"fiatlux_runtime"}, ${"public.organizations"}, ${"INSERT"}) AS "runtimeInsert",
        has_table_privilege(${"fiatlux_backup"}, ${"public.organizations"}, ${"SELECT"}) AS "backupSelect",
        has_table_privilege(${"fiatlux_backup"}, ${"public.organizations"}, ${"INSERT"}) AS "backupInsert",
        has_schema_privilege(${"fiatlux_backup"}, ${"public"}, ${"CREATE"}) AS "backupSchemaCreate"
    `;
    const allRoles = await sql`
      SELECT rolname AS name, rolsuper AS superuser, rolcreatedb AS createdb,
             rolcreaterole AS createrole, rolbypassrls AS bypassrls
      FROM pg_roles ORDER BY rolname
    `;
    const expectedRoleNames = new Set([
      "fiatlux_backup", "fiatlux_migrator", "fiatlux_restore", "fiatlux_runtime",
    ]);
    const roles = allRoles.filter((row) => expectedRoleNames.has(row.name));
    const allMemberships = await sql`
      SELECT granted.rolname AS granted, member.rolname AS member
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      ORDER BY granted.rolname, member.rolname
    `;
    const memberships = allMemberships.filter((row) => row.member === "fiatlux_restore");
    process.stdout.write(JSON.stringify({
      publicTables: publicTableRows.map((row) => row.name),
      migrations: migrationRows,
      pgBossVersion: pgBossVersion?.version,
      pgBossTables: pgBossTableRows.map((row) => row.name),
      runtimePosture,
      privileges,
      roles,
      memberships,
    }));
  } finally {
    await sql.end();
  }
')

actual_public_tables_json=$(jq -c '.publicTables' <<<"$database_verification")
if [[ "$actual_public_tables_json" != "$expected_public_tables_json" ]]; then
  printf '恢复业务表集合不匹配：expected=%s actual=%s\n' \
    "$expected_public_tables_json" "$actual_public_tables_json" >&2
  exit 5
fi
actual_migrations_json=$(jq -c '.migrations' <<<"$database_verification")
expected_migrations_json=$(jq -c . <<<"$expected_migrations_json")
if [[ "$actual_migrations_json" != "$expected_migrations_json" ]]; then
  printf '恢复 migration journal/hash 不匹配：expected=%s actual=%s\n' \
    "$expected_migrations_json" "$actual_migrations_json" >&2
  exit 5
fi
if ! jq -e --argjson expected_version "$expected_pgboss_version" '
  .pgBossVersion == $expected_version and (.pgBossTables | length > 0) and
  .runtimePosture == {
    role: "fiatlux_runtime", superuser: false, createdb: false, createrole: false,
    bypassrls: false, schemaCreate: false, auditUpdate: false, auditDelete: false,
    migratorMember: false, triggerMode: "A", auditOwner: "fiatlux_migrator"
  } and
  .privileges == {
    runtimeSelect: true, runtimeInsert: true, backupSelect: true,
    backupInsert: false, backupSchemaCreate: false
  } and
  .roles == [
    {name: "fiatlux_backup", superuser: false, createdb: false, createrole: false, bypassrls: false},
    {name: "fiatlux_migrator", superuser: false, createdb: false, createrole: false, bypassrls: false},
    {name: "fiatlux_restore", superuser: false, createdb: true, createrole: false, bypassrls: false},
    {name: "fiatlux_runtime", superuser: false, createdb: false, createrole: false, bypassrls: false}
  ] and
  .memberships == [
    {granted: "fiatlux_migrator", member: "fiatlux_restore"},
    {granted: "pg_signal_backend", member: "fiatlux_restore"}
  ]
' <<<"$database_verification" >/dev/null; then
  printf '恢复后的 pg-boss 或数据库最小权限姿态不匹配：%s\n' \
    "$database_verification" >&2
  exit 5
fi

if [[ ! -f "$restore_report_path" || -L "$restore_report_path" ]] ||
  ! jq -e \
    --arg report_id "$restore_report_id" \
    --arg archive_sha256 "$expected_sha256" \
    --arg source_id "$expected_source_id" \
    --arg source_database "$expected_source_database" \
    --arg source_bucket "$expected_source_bucket" \
    --arg target_database "$POSTGRES_DB" \
    --arg target_bucket "$S3_BUCKET" \
    --arg attestation_sha256 "$attestation_sha256" \
    --arg signing_key_fingerprint_sha256 "$signing_key_fingerprint_sha256" '
      .schemaVersion == 1 and .evidenceType == "technical_restore" and
      .result == "success" and .reportId == $report_id and
      .archiveSha256 == $archive_sha256 and .approvedDigestMatched == true and
      .signatureVerified == true and .attestationSha256 == $attestation_sha256 and
      .signingKeyFingerprintSha256 == $signing_key_fingerprint_sha256 and
      .sourceId == $source_id and .sourceDatabase == $source_database and
      .sourceBucket == $source_bucket and .database == $target_database and
      .bucket == $target_bucket and .checksumVerified == true and
      .metadataVerified == true and .objectsVerified == true and
      ((.objectCount | type) == "number") and .objectCount >= 0 and
      (.objectCount | floor) == .objectCount and
      ((.objectBytes | type) == "number") and .objectBytes >= 0 and
      (.objectBytes | floor) == .objectBytes and
      (.objectManifestSha256 | type == "string" and test("^[0-9a-f]{64}$"))
    ' "$restore_report_path" >/dev/null; then
  echo "恢复报告缺失或未证明逐对象路径/字节/SHA-256 核验。" >&2
  exit 6
fi
verified_object_count=$(jq -r '.objectCount' "$restore_report_path")
verified_object_bytes=$(jq -r '.objectBytes' "$restore_report_path")
verified_object_manifest_sha256=$(jq -r '.objectManifestSha256' "$restore_report_path")

# Variables in this command are intentionally expanded inside backup-tools.
# shellcheck disable=SC2016
object_output=$("$COMPOSE" run --rm --no-deps --pull never backup-tools sh -ec \
  'set -o pipefail; mc alias set verify "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null; mc ls --recursive --json "verify/$S3_BUCKET" | jq -s '\''[.[] | select(.type == "file")] | length'\''')
object_count=$(awk '/^[0-9]+$/{value=$0} END{print value}' <<<"$object_output")
if [[ ! "$object_count" =~ ^[0-9]+$ ]]; then
  printf '恢复对象计数无效：%s\n' "$object_count" >&2
  exit 6
fi
if [[ "$object_count" != "$verified_object_count" ]]; then
  printf '恢复报告与目标桶对象数不一致：report=%s target=%s\n' \
    "$verified_object_count" "$object_count" >&2
  exit 6
fi

"$ROOT_DIR/scripts/verify-minio-permissions.sh"

printf '恢复演练通过：业务表=%s，迁移=%s（%s..%s），pg-boss=%s，worker=healthy，对象=%s/%s bytes，对象清单SHA-256=%s。\n' \
  "$expected_public_table_count" "$expected_migration_count" \
  "$expected_first_migration" "$expected_last_migration" "$expected_pgboss_version" \
  "$verified_object_count" "$verified_object_bytes" "$verified_object_manifest_sha256"
