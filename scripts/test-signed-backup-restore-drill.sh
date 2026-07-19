#!/usr/bin/env bash
set -euo pipefail

# Manual, destructive-to-a-local-test-stack acceptance exercise. It briefly quiesces the selected
# stack, temporarily points its one-shot backup image tag at a caller-built working-tree image,
# creates an encrypted/signed backup, restores it into fresh random volumes, emits sanitized JSON,
# then removes all generated archives/keys/volumes and restores the original image tag.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"

usage() {
  cat <<'EOF'
用法：
  FIATLUX_ENV_FILE=/path/to/production-like.env \
  COMPOSE_PROJECT_NAME=existing-test-project \
  SIGNED_DRILL_BACKUP_IMAGE=local-working-tree-backup:image \
  SIGNED_DRILL_CONFIRM=YES-I-UNDERSTAND \
  ./scripts/test-signed-backup-restore-drill.sh

仅用于本地受控验收栈。脚本会短暂停止该项目的 caddy/api/worker；不得指向真实生产环境。
EOF
}

if [[ "${SIGNED_DRILL_CONFIRM:-}" != YES-I-UNDERSTAND ]]; then
  usage >&2
  exit 2
fi
if [[ -z "${FIATLUX_ENV_FILE:-}" || ! -f "$FIATLUX_ENV_FILE" ||
  -z "${COMPOSE_PROJECT_NAME:-}" || -z "${SIGNED_DRILL_BACKUP_IMAGE:-}" ]]; then
  usage >&2
  exit 2
fi
if [[ "${FIATLUX_ENV:-production}" != production ]]; then
  echo "签名恢复演练只接受 production-like 配置。" >&2
  exit 2
fi
export FIATLUX_ENV=production
load_runtime_env

for utility in docker jq node openssl sha256sum; do
  command -v "$utility" >/dev/null 2>&1 || {
    printf '签名恢复演练需要 %s。\n' "$utility" >&2
    exit 127
  }
done
for required_value in \
  "${APP_IMAGE_TAG:-}" "${BACKUP_SOURCE_ID:-}" "${POSTGRES_DB:-}" \
  "${S3_BUCKET:-}" "${BACKUP_AGE_IDENTITY_FILE:-}"; do
  [[ -n "$required_value" ]] || {
    echo "production-like 配置缺少签名恢复演练必需值。" >&2
    exit 2
  }
done
if [[ ! -f "$BACKUP_AGE_IDENTITY_FILE" || -L "$BACKUP_AGE_IDENTITY_FILE" ||
  ! -r "$BACKUP_AGE_IDENTITY_FILE" ]]; then
  echo "签名恢复演练需要可读且非符号链接的 age identity。" >&2
  exit 2
fi

target_backup_image="${IMAGE_PREFIX:-ghcr.io/liuxiu233/fiatlux-choice}-backup:$APP_IMAGE_TAG"
old_backup_image_id=""
if docker image inspect "$target_backup_image" >/dev/null 2>&1; then
  old_backup_image_id=$(docker image inspect --format '{{.Id}}' "$target_backup_image")
fi
signed_drill_backup_image_id=$(docker image inspect --format '{{.Id}}' \
  "$SIGNED_DRILL_BACKUP_IMAGE")
if [[ ! "$signed_drill_backup_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "无法确定本地签名备份镜像的不可变 image ID。" >&2
  exit 3
fi

release_state=${FIATLUX_STATE_DIR:-$ROOT_DIR/data/releases}/current
if [[ -r "$release_state" ]]; then
  expected_backup_tool_release=$(<"$release_state")
else
  expected_backup_tool_release=$APP_IMAGE_TAG
fi
if [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "无法从部署发布状态独立确定 backup tool release。" >&2
  exit 3
fi

services=(postgres minio caddy api worker web)
before_service_ids=""
for service in "${services[@]}"; do
  container_id=$("$ROOT_DIR/scripts/compose.sh" ps -q "$service")
  if [[ -z "$container_id" || "$container_id" == *$'\n'* ]]; then
    printf '演练前服务 %s 必须恰好有一个容器。\n' "$service" >&2
    exit 3
  fi
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "$container_id")
  if [[ "$health" != healthy ]]; then
    printf '演练前服务 %s 不健康：%s。\n' "$service" "$health" >&2
    exit 3
  fi
  before_service_ids+="$service=$container_id"$'\n'
done

before_restore_containers=$(docker ps -aq --filter name=fiatlux-restore- | sort)
before_restore_volumes=$(docker volume ls --format '{{.Name}}' |
  awk '/^fiatlux-restore-/ {print}' | sort)
mkdir -p "$ROOT_DIR/tmp"
work=$(mktemp -d "$ROOT_DIR/tmp/signed-restore-drill.XXXXXX")
case "$work" in
  "$ROOT_DIR"/tmp/signed-restore-drill.*) ;;
  *) echo "签名恢复演练临时目录边界无效。" >&2; exit 4 ;;
esac
tag_replaced=false
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$tag_replaced" == true ]]; then
    if [[ -n "$old_backup_image_id" ]]; then
      docker tag "$old_backup_image_id" "$target_backup_image" >/dev/null 2>&1 || true
    else
      docker image rm "$target_backup_image" >/dev/null 2>&1 || true
    fi
  fi
  chmod -R u+w "$work" 2>/dev/null || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker tag "$SIGNED_DRILL_BACKUP_IMAGE" "$target_backup_image"
tag_replaced=true

mkdir -p "$work/backups" "$work/backup-scratch" "$work/restore-scratch" \
  "$work/restore-reports" "$work/pre-restore" "$work/maintenance"
chmod 0700 "$work/backups" "$work/backup-scratch" "$work/restore-scratch" \
  "$work/restore-reports" "$work/pre-restore" "$work/maintenance"

signing_private="$work/backup-signing-private.pem"
signing_public="$work/backup-signing-public.pem"
signing_public_der="$work/backup-signing-public.der"
openssl genpkey -algorithm ED25519 -out "$signing_private"
chmod 0600 "$signing_private"
openssl pkey -in "$signing_private" -passin pass: -pubout -out "$signing_public"
openssl pkey -pubin -in "$signing_public" -outform DER -out "$signing_public_der"
signing_fingerprint=$(sha256sum "$signing_public_der" | awk '{print $1}')

export BACKUP_DIR="$work/backups"
export BACKUP_SCRATCH_DIR="$work/backup-scratch"
export RESTORE_SCRATCH_DIR="$work/restore-scratch"
export RESTORE_DRILL_REPORT_DIR="$work/restore-reports"
export RESTORE_PRE_BACKUP_DIR="$work/pre-restore"
export FIATLUX_MAINTENANCE_DIR="$work/maintenance"
export BACKUP_SIGNING_PRIVATE_KEY_FILE="$signing_private"
export BACKUP_SIGNING_PUBLIC_KEY_FILE="$signing_public"
export BACKUP_SIGNING_PUBLIC_KEY_SHA256="$signing_fingerprint"

name="signed-drill-$(date -u +%Y%m%dT%H%M%SZ)"
backup_started_epoch=$(date +%s)
"$ROOT_DIR/scripts/backup.sh" \
  --name "$name" --require-encryption --require-signature --quiesce
backup_finished_epoch=$(date +%s)

archive="$work/backups/$name.tar.gz.age"
attestation="$archive.attestation.json"
signature="$archive.attestation.sig"
config_archive="$work/backups/$name.config.tar.gz.age"
for required_file in \
  "$archive" "$archive.sha256" "$attestation" "$signature" \
  "$config_archive" "$config_archive.sha256" "$config_archive.attestation.json" \
  "$config_archive.attestation.sig"; do
  if [[ ! -f "$required_file" || -L "$required_file" ]]; then
    printf '签名备份缺少预期产物：%s\n' "$required_file" >&2
    exit 5
  fi
done

archive_sha=$(sha256sum "$archive" | awk '{print $1}')
config_sha=$(sha256sum "$config_archive" | awk '{print $1}')
backup_tool_release=$(jq -er '.backupToolRelease' "$attestation")
created_at=$(jq -er '.createdAt' "$attestation")

data_checksum_sidecar_verified=false
configuration_checksum_sidecar_verified=false
(
  cd "$(dirname "$archive")"
  sha256sum --check "$(basename "$archive.sha256")" >/dev/null
)
data_checksum_sidecar_verified=true
(
  cd "$(dirname "$config_archive")"
  sha256sum --check "$(basename "$config_archive.sha256")" >/dev/null
)
configuration_checksum_sidecar_verified=true

verify_common=(
  --public-key "$signing_public"
  --expected-signing-key-sha256 "$signing_fingerprint"
  --expected-source-id "$BACKUP_SOURCE_ID"
  --expected-source-database "$POSTGRES_DB"
  --expected-source-bucket "$S3_BUCKET"
  --expected-backup-tool-release "$expected_backup_tool_release"
)
"$ROOT_DIR/scripts/verify-backup-attestation.sh" \
  --file "$archive" --attestation "$attestation" --signature "$signature" \
  --expected-sha256 "$archive_sha" "${verify_common[@]}" >/dev/null
"$ROOT_DIR/scripts/verify-backup-attestation.sh" \
  --file "$config_archive" \
  --attestation "$config_archive.attestation.json" \
  --signature "$config_archive.attestation.sig" \
  --expected-sha256 "$config_sha" "${verify_common[@]}" >/dev/null

drill_started_epoch=$(date +%s)
"$ROOT_DIR/scripts/restore-drill.sh" \
  --file "$archive" \
  --expected-sha256 "$archive_sha" \
  --expected-source-id "$BACKUP_SOURCE_ID" \
  --expected-source-database "$POSTGRES_DB" \
  --expected-source-bucket "$S3_BUCKET" \
  --expected-backup-tool-release "$expected_backup_tool_release" \
  --attestation "$attestation" \
  --signature "$signature" \
  --signing-public-key "$signing_public" \
  --expected-signing-key-sha256 "$signing_fingerprint" \
  --identity "$BACKUP_AGE_IDENTITY_FILE"
drill_finished_epoch=$(date +%s)

restore_report=$(find "$work/restore-reports/restore-reports" -maxdepth 1 -type f \
  -name 'restore-*.json' -print | sort | tail -n 1)
if [[ -z "$restore_report" || ! -f "$restore_report" || -L "$restore_report" ]]; then
  echo "签名恢复演练报告缺失。" >&2
  exit 6
fi
jq -e --arg archive_sha "$archive_sha" --arg fingerprint "$signing_fingerprint" '
  .archiveSha256 == $archive_sha and .approvedDigestMatched == true and
  .signatureVerified == true and .signingKeyFingerprintSha256 == $fingerprint and
  .checksumVerified == true and .metadataVerified == true and .objectsVerified == true
' "$restore_report" >/dev/null

after_restore_containers=$(docker ps -aq --filter name=fiatlux-restore- | sort)
after_restore_volumes=$(docker volume ls --format '{{.Name}}' |
  awk '/^fiatlux-restore-/ {print}' | sort)
if [[ "$after_restore_containers" != "$before_restore_containers" ||
  "$after_restore_volumes" != "$before_restore_volumes" ]]; then
  echo "隔离恢复演练留下了额外容器或卷。" >&2
  exit 7
fi
if [[ -n "$(find "$work/backup-scratch" -mindepth 1 -print -quit)" ||
  -n "$(find "$work/restore-scratch" -mindepth 1 -print -quit)" ]]; then
  echo "签名备份或恢复 scratch 未清空。" >&2
  exit 7
fi

after_service_ids=""
healthy_services=0
for service in "${services[@]}"; do
  container_id=$("$ROOT_DIR/scripts/compose.sh" ps -q "$service")
  after_service_ids+="$service=$container_id"$'\n'
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "$container_id")
  [[ "$health" == healthy ]] && ((healthy_services += 1))
done
if [[ "$after_service_ids" != "$before_service_ids" || "$healthy_services" != 6 ]]; then
  echo "签名备份后原 production-like 栈的容器身份或健康状态改变。" >&2
  exit 7
fi

created_epoch=$(node -e \
  'process.stdout.write(String(Math.floor(Date.parse(process.argv[1]) / 1000)))' \
  "$created_at")
rpo_seconds=$((drill_started_epoch - created_epoch))
rto_seconds=$((drill_finished_epoch - drill_started_epoch))
attestation_sha=$(sha256sum "$attestation" | awk '{print $1}')
evidence=$(jq -c -n \
  --arg executedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg localBackupImageId "$signed_drill_backup_image_id" \
  --arg archiveSha256 "$archive_sha" \
  --arg configurationArchiveSha256 "$config_sha" \
  --arg attestationSha256 "$attestation_sha" \
  --arg signingKeyFingerprintSha256 "$signing_fingerprint" \
  --arg sourceId "$BACKUP_SOURCE_ID" \
  --arg backupToolRelease "$backup_tool_release" \
  --argjson dataChecksumSidecarVerified "$data_checksum_sidecar_verified" \
  --argjson configurationChecksumSidecarVerified \
    "$configuration_checksum_sidecar_verified" \
  --argjson backupSeconds "$((backup_finished_epoch - backup_started_epoch))" \
  --argjson rpoSeconds "$rpo_seconds" \
  --argjson rtoSeconds "$rto_seconds" \
  --argjson objectCount "$(jq '.objectCount' "$restore_report")" \
  --argjson objectBytes "$(jq '.objectBytes' "$restore_report")" \
  --arg objectManifestSha256 "$(jq -r '.objectManifestSha256' "$restore_report")" \
  --argjson publicTables "$(jq '.publicTables | length' \
    "$ROOT_DIR/packages/db/restore-acceptance.json")" \
  --argjson migrations "$(jq '.entries | length' \
    "$ROOT_DIR/packages/db/migrations/meta/_journal.json")" \
  --argjson pgBossSchemaVersion "$(jq '.pgBossSchemaVersion' \
    "$ROOT_DIR/packages/db/restore-acceptance.json")" \
  '{executedAt: $executedAt, scope: "local-working-tree-signed-isolated-drill",
    localBackupImageId: $localBackupImageId, archiveSha256: $archiveSha256,
    configurationArchiveSha256: $configurationArchiveSha256,
    attestationSha256: $attestationSha256,
    signingKeyFingerprintSha256: $signingKeyFingerprintSha256, sourceId: $sourceId,
    backupToolRelease: $backupToolRelease, backupSeconds: $backupSeconds,
    dataChecksumSidecarVerified: $dataChecksumSidecarVerified,
    configurationChecksumSidecarVerified: $configurationChecksumSidecarVerified,
    configurationAttestationVerified: true,
    rpoSeconds: $rpoSeconds, rtoSeconds: $rtoSeconds, publicTables: $publicTables,
    migrations: $migrations, pgBossSchemaVersion: $pgBossSchemaVersion,
    objectCount: $objectCount, objectBytes: $objectBytes,
    objectManifestSha256: $objectManifestSha256, signatureVerified: true,
    resourcesCleaned: true, originalHealthyServices: 6,
    productionRestoreEntrypointExecuted: false}')

if [[ -n "$old_backup_image_id" ]]; then
  docker tag "$old_backup_image_id" "$target_backup_image"
else
  docker image rm "$target_backup_image" >/dev/null
fi
tag_replaced=false
chmod -R u+w "$work"
rm -rf "$work"
work="$ROOT_DIR/tmp/.signed-restore-drill-cleaned"
trap - EXIT HUP INT TERM
printf '%s\n' "$evidence"
