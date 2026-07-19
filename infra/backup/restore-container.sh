#!/bin/sh
set -eu

umask 077

required_variables="BACKUP_FILE BACKUP_EXPECTED_SHA256 RESTORE_EXPECTED_SOURCE_ID RESTORE_EXPECTED_SOURCE_DATABASE RESTORE_EXPECTED_SOURCE_BUCKET RESTORE_EXPECTED_BACKUP_TOOL_RELEASE RESTORE_TOOL_RELEASE PGHOST PGDATABASE PGUSER PGPASSWORD S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY RESTORE_CONFIRM_DATABASE RESTORE_CONFIRM_BUCKET RESTORE_APPROVED"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

restore_report_id=${RESTORE_REPORT_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
if [ "${#restore_report_id}" -gt 128 ]; then
	echo "恢复报告标识不能超过 128 字符。" >&2
	exit 2
fi
case "$restore_report_id" in
	*[!A-Za-z0-9._-]* | "")
		echo "恢复报告标识格式无效。" >&2
		exit 2
		;;
esac

if [ "$RESTORE_APPROVED" != "YES-I-UNDERSTAND" ]; then
	echo "恢复会替换目标数据库和对象桶；审批标记不正确。" >&2
	exit 2
fi
if [ "$RESTORE_CONFIRM_DATABASE" != "$PGDATABASE" ]; then
	echo "数据库确认值与目标不一致。" >&2
	exit 2
fi
if [ "$RESTORE_CONFIRM_BUCKET" != "$S3_BUCKET" ]; then
	echo "对象桶确认值与目标不一致。" >&2
	exit 2
fi

case "$PGDATABASE" in
	*[!A-Za-z0-9_]* | "")
		echo "目标数据库名称不安全。" >&2
		exit 2
		;;
esac
case "$S3_BUCKET" in
	*[!A-Za-z0-9._-]* | "")
		echo "目标对象桶名称不安全。" >&2
		exit 2
		;;
esac
case "$RESTORE_EXPECTED_SOURCE_DATABASE" in
	*[!A-Za-z0-9_]* | "")
		echo "预期来源数据库名称不安全。" >&2
		exit 2
		;;
esac
case "$RESTORE_EXPECTED_SOURCE_BUCKET" in
	*[!A-Za-z0-9._-]* | "")
		echo "预期来源对象桶名称不安全。" >&2
		exit 2
		;;
esac
if [ "${#RESTORE_EXPECTED_SOURCE_ID}" -gt 128 ]; then
	echo "预期来源标识不能超过 128 字符。" >&2
	exit 2
fi
case "$RESTORE_EXPECTED_SOURCE_ID" in
	*[!A-Za-z0-9._:-]* | "")
		echo "预期来源标识格式不安全。" >&2
		exit 2
		;;
esac
for release_value in "$RESTORE_EXPECTED_BACKUP_TOOL_RELEASE" "$RESTORE_TOOL_RELEASE"; do
	if [ "${#release_value}" -gt 128 ]; then
		echo "备份/恢复工具发布版本不能超过 128 字符。" >&2
		exit 2
	fi
	case "$release_value" in
		*[!A-Za-z0-9._-]* | "")
			echo "备份/恢复工具发布版本格式不安全。" >&2
			exit 2
			;;
	esac
done
backup_basename=$(basename "$BACKUP_FILE")
case "$backup_basename" in
	*[!A-Za-z0-9._-]* | "")
		echo "备份文件名不安全。" >&2
		exit 2
		;;
esac
case "$BACKUP_FILE" in
	/restore-source/*)
		expected_backup_path="/restore-source/$backup_basename"
		;;
	/backups/*)
		# /backups remains accepted for direct backup-container security fixtures;
		# production restore.sh always uses the read-only /restore-source mount.
		expected_backup_path="/backups/$backup_basename"
		;;
	*)
		echo "BACKUP_FILE 必须位于 /restore-source 下的直接文件。" >&2
		exit 2
		;;
esac
if [ "$BACKUP_FILE" != "$expected_backup_path" ]; then
	echo "BACKUP_FILE 必须是受控源目录下的直接文件。" >&2
	exit 2
fi
if [ ! -f "$BACKUP_FILE" ] || [ -L "$BACKUP_FILE" ]; then
	echo "找不到备份文件：$BACKUP_FILE" >&2
	exit 3
fi
if [ "${#BACKUP_EXPECTED_SHA256}" -ne 64 ]; then
	echo "批准的备份 SHA-256 必须是 64 位小写十六进制。" >&2
	exit 2
fi
case "$BACKUP_EXPECTED_SHA256" in
	*[!0-9a-f]*)
		echo "批准的备份 SHA-256 必须是 64 位小写十六进制。" >&2
		exit 2
		;;
esac

work_root=${RESTORE_WORK_ROOT:-/restore-work}
if [ ! -d "$work_root" ] || [ -L "$work_root" ]; then
	echo "恢复明文工作区必须是受保护的真实目录：$work_root" >&2
	exit 2
fi
restore_lock="$work_root/.fiatlux-restore.lock"
if ! mkdir -m 0700 "$restore_lock" 2>/dev/null; then
	echo "已有恢复或陈旧恢复锁，拒绝并发运行：$restore_lock" >&2
	exit 4
fi
stale_work=$(find "$work_root" -mindepth 1 -maxdepth 1 ! -name .fiatlux-restore.lock -print -quit)
if [ -n "$stale_work" ]; then
	rmdir "$restore_lock"
	echo "恢复明文工作区存在陈旧内容，拒绝自动清理：$stale_work" >&2
	exit 4
fi
work=$(mktemp -d "$work_root/fiatlux-restore.XXXXXX")
mkdir "$work/payload"
s3_probe_object=""
report_partial=""
cleanup() {
	if [ -n "$s3_probe_object" ]; then
		mc rm "$s3_probe_object" >/dev/null 2>&1 || true
	fi
	if [ -n "$report_partial" ]; then
		rm -f "$report_partial"
	fi
	rm -rf "$work"
	rmdir "$restore_lock" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

available_bytes() {
	available_kib=$(df -Pk "$work_root" | awk 'END {print $4}')
	case "$available_kib" in
		*[!0-9]* | "")
			echo "无法确定恢复明文工作区可用容量。" >&2
			exit 4
			;;
	esac
	echo $((available_kib * 1024))
}

require_free_bytes() {
	required_bytes=$1
	phase=$2
	free_bytes=$(available_bytes)
	if [ "$free_bytes" -lt "$required_bytes" ]; then
		printf '恢复工作区容量不足（%s）：需要至少 %s 字节，当前 %s 字节。\n' \
			"$phase" "$required_bytes" "$free_bytes" >&2
		exit 4
	fi
}

source_size=$(wc -c <"$BACKUP_FILE" | tr -d '[:space:]')
case "$source_size" in
	*[!0-9]* | "")
		echo "无法确定备份归档大小。" >&2
		exit 4
		;;
esac
capacity_margin=67108864
if [ "$source_size" -gt 4611686018393837567 ]; then
	echo "备份归档过大，容量计算会溢出。" >&2
	exit 4
fi
require_free_bytes "$((source_size * 2 + capacity_margin))" "复制与解密"

case "$backup_basename" in
	*.tar.gz.age)
		expected_backup_name=${backup_basename%.tar.gz.age}
		encrypted_source="$work/source.tar.gz.age"
		cp "$BACKUP_FILE" "$encrypted_source"
		actual_sha256=$(sha256sum "$encrypted_source" | awk '{print $1}')
		if [ "$actual_sha256" != "$BACKUP_EXPECTED_SHA256" ]; then
			echo "备份 SHA-256 与受审值不一致，拒绝恢复。" >&2
			exit 3
		fi
		identity=/run/secrets/backup_age_identity
		if [ -r "$identity" ]; then
			:
		elif [ "${BACKUP_AGE_IDENTITY_STDIN:-false}" = true ]; then
			identity="$work/backup-age-identity"
			cat >"$identity"
			chmod 0600 "$identity"
		else
			echo "加密备份需要提供 age 身份文件。" >&2
			exit 3
		fi
		archive="$work/backup.tar.gz"
		age --decrypt --identity "$identity" --output "$archive" "$encrypted_source"
		rm -f "$encrypted_source"
		;;
	*.tar.gz)
		expected_backup_name=${backup_basename%.tar.gz}
		archive="$work/backup.tar.gz"
		cp "$BACKUP_FILE" "$archive"
		actual_sha256=$(sha256sum "$archive" | awk '{print $1}')
		if [ "$actual_sha256" != "$BACKUP_EXPECTED_SHA256" ]; then
			echo "备份 SHA-256 与受审值不一致，拒绝恢复。" >&2
			exit 3
		fi
		;;
	*)
		echo "仅支持 .tar.gz 或 .tar.gz.age 备份。" >&2
		exit 3
		;;
esac

echo "[1/7] 检查归档并按实际展开量预检磁盘容量"
inspection=$(archive-guard inspect \
	--archive "$archive" \
	--max-members "${RESTORE_MAX_ARCHIVE_MEMBERS:-200000}" \
	--max-expanded-bytes "${RESTORE_MAX_EXPANDED_BYTES:-107374182400}")
expanded_bytes=${inspection##*expandedBytes=}
case "$expanded_bytes" in
	*[!0-9]* | "")
		echo "归档守卫未返回有效展开大小。" >&2
		exit 4
		;;
esac
if [ "$expanded_bytes" -gt 9223372036787666943 ]; then
	echo "归档展开大小导致容量计算溢出。" >&2
	exit 4
fi
require_free_bytes "$((expanded_bytes + capacity_margin))" "安全提取"

echo "[2/7] 检查成员类型、路径、链接、数量与展开大小后安全提取"
archive-guard extract \
	--archive "$archive" \
	--destination "$work/payload" \
	--max-members "${RESTORE_MAX_ARCHIVE_MEMBERS:-200000}" \
	--max-expanded-bytes "${RESTORE_MAX_EXPANDED_BYTES:-107374182400}"

for required_file in database.dump metadata.json manifest.sha256; do
	if [ ! -f "$work/payload/$required_file" ]; then
		echo "备份缺少 $required_file。" >&2
		exit 4
	fi
done
if [ ! -d "$work/payload/objects" ]; then
	echo "备份缺少 objects 目录。" >&2
	exit 4
fi

echo "[3/7] 校验覆盖全部普通文件的内部 SHA-256 清单与来源 metadata"
archive-guard verify-manifest \
	--root "$work/payload" \
	--manifest manifest.sha256 \
	--max-entries "${RESTORE_MAX_ARCHIVE_MEMBERS:-200000}"

metadata_size=$(wc -c <"$work/payload/metadata.json" | tr -d '[:space:]')
case "$metadata_size" in
	*[!0-9]* | "")
		echo "备份 metadata.json 大小无效。" >&2
		exit 4
		;;
esac
if [ "$metadata_size" -gt 65536 ]; then
	echo "备份 metadata.json 超过 65536 字节。" >&2
	exit 4
fi
if ! jq -e \
	--arg source_id "$RESTORE_EXPECTED_SOURCE_ID" \
	--arg backup_name "$expected_backup_name" \
	--arg database "$RESTORE_EXPECTED_SOURCE_DATABASE" \
	--arg bucket "$RESTORE_EXPECTED_SOURCE_BUCKET" \
	--arg backup_tool_release "$RESTORE_EXPECTED_BACKUP_TOOL_RELEASE" \
	'type == "object" and
	 .formatVersion == "2" and
	 .sourceId == $source_id and
	 .backupName == $backup_name and
	 .database == $database and
	 .bucket == $bucket and
	 (.createdAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and
	 (.tools | type == "object") and
	 .tools.backupRelease == $backup_tool_release and
	 (.tools.postgres | type == "string" and length > 0 and length <= 512) and
	 (.tools.minioClient | type == "string" and length > 0 and length <= 512)' \
	"$work/payload/metadata.json" >/dev/null; then
	echo "备份 metadata.json 的格式版本或受审来源不匹配，拒绝破坏性恢复。" >&2
	exit 4
fi
backup_tool_release=$(jq -er '.tools.backupRelease' "$work/payload/metadata.json")

echo "[4/7] 在任何破坏前验证 PostgreSQL dump/角色与 MinIO 读写删除能力"
export PGPASSWORD
pg_restore --list "$work/payload/database.dump" >/dev/null
role_capabilities=$(psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align --quiet \
	--command "SELECT rolcreatedb, pg_has_role(current_user, 'fiatlux_migrator', 'MEMBER'), pg_has_role(current_user, 'pg_signal_backend', 'MEMBER') FROM pg_roles WHERE rolname = current_user")
if [ "$role_capabilities" != "t|t|t" ]; then
	printf '恢复数据库角色能力不满足要求：%s。\n' "$role_capabilities" >&2
	exit 5
fi
set_role_result=$(psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align --quiet \
	--command "SET ROLE fiatlux_migrator; SELECT current_user")
if [ "$set_role_result" != "fiatlux_migrator" ]; then
	echo "恢复身份无法受控 SET ROLE fiatlux_migrator。" >&2
	exit 5
fi

mc alias set target "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
if ! mc stat "target/$S3_BUCKET" >/dev/null 2>&1; then
	echo "目标对象桶不存在或恢复凭据不可读；数据库尚未修改。" >&2
	exit 5
fi
probe_key=".fiatlux-restore-preflight/$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf 'fiatlux restore permission probe\n' >"$work/s3-probe"
s3_probe_object="target/$S3_BUCKET/$probe_key"
mc cp "$work/s3-probe" "$s3_probe_object" >/dev/null
if [ "$(mc cat "$s3_probe_object")" != "fiatlux restore permission probe" ]; then
	echo "恢复凭据对象读回校验失败；数据库尚未修改。" >&2
	exit 5
fi
mc rm "$s3_probe_object" >/dev/null
s3_probe_object=""

if [ "${RESTORE_PREFLIGHT_ONLY:-false}" = true ]; then
	echo "恢复非破坏性前置检查通过；按要求未替换数据库或对象桶。"
	exit 0
fi

echo "[5/7] 替换 PostgreSQL 数据库和 MinIO 对象桶"
psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=target_db="$PGDATABASE" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db' AND pid <> pg_backend_pid();
SQL
dropdb --if-exists "$PGDATABASE"
createdb --owner=fiatlux_migrator "$PGDATABASE"
pg_restore \
	--exit-on-error \
	--no-owner \
	--no-privileges \
	--role=fiatlux_migrator \
	--dbname="$PGDATABASE" \
	"$work/payload/database.dump"
mc rm --recursive --force "target/$S3_BUCKET"
mc mirror "$work/payload/objects" "target/$S3_BUCKET"

echo "[6/7] 从目标桶逐对象读回并核对路径、字节数与 SHA-256"
object_verification_manifest="$work/restored-objects.jsonl"
EXPECTED_OBJECT_ROOT="$work/payload/objects" \
	TARGET_OBJECT_ALIAS=target \
	TARGET_OBJECT_BUCKET="$S3_BUCKET" \
	OBJECT_VERIFICATION_MANIFEST="$object_verification_manifest" \
	OBJECT_VERIFICATION_WORK_ROOT="$work" \
	verify-restored-objects
object_count=$(wc -l <"$object_verification_manifest" | tr -d '[:space:]')
object_bytes=$(jq -s 'map(.sizeBytes) | add // 0' "$object_verification_manifest")
object_manifest_sha256=$(sha256sum "$object_verification_manifest" | awk '{print $1}')
case "$object_count:$object_bytes" in
	*[!0-9:]* | :* | *:)
		echo "恢复对象核验摘要格式无效。" >&2
		exit 5
		;;
esac
if [ "${#object_manifest_sha256}" -ne 64 ]; then
	echo "恢复对象核验清单 SHA-256 长度无效。" >&2
	exit 5
fi
case "$object_manifest_sha256" in
	*[!0-9a-f]*)
		echo "恢复对象核验清单 SHA-256 格式无效。" >&2
		exit 5
		;;
esac

echo "[7/7] 写入恢复报告"
report_dir=/backups/restore-reports
mkdir -p "$report_dir"
report="$report_dir/restore-$restore_report_id.json"
report_partial="$report.partial"
if [ -e "$report" ] || [ -L "$report" ] || [ -e "$report_partial" ] || [ -L "$report_partial" ]; then
	echo "恢复报告目标已存在，拒绝覆盖。" >&2
	exit 5
fi
jq -n \
	--arg restored_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	--arg source "$(basename "$BACKUP_FILE")" \
	--arg archive_sha256 "$actual_sha256" \
	--arg source_id "$RESTORE_EXPECTED_SOURCE_ID" \
	--arg source_database "$RESTORE_EXPECTED_SOURCE_DATABASE" \
	--arg source_bucket "$RESTORE_EXPECTED_SOURCE_BUCKET" \
	--arg backup_tool_release "$backup_tool_release" \
	--arg restore_tool_release "$RESTORE_TOOL_RELEASE" \
	--arg database "$PGDATABASE" \
	--arg bucket "$S3_BUCKET" \
	--argjson object_count "$object_count" \
	--argjson object_bytes "$object_bytes" \
	--arg object_manifest_sha256 "$object_manifest_sha256" \
	'{restoredAt: $restored_at, source: $source, archiveSha256: $archive_sha256, approvedDigestMatched: true, sourceId: $source_id, sourceDatabase: $source_database, sourceBucket: $source_bucket, backupToolRelease: $backup_tool_release, restoreToolRelease: $restore_tool_release, database: $database, bucket: $bucket, checksumVerified: true, metadataVerified: true, objectsVerified: true, objectCount: $object_count, objectBytes: $object_bytes, objectManifestSha256: $object_manifest_sha256}' \
	>"$report_partial"
mv "$report_partial" "$report"
report_partial=""

printf '数据恢复完成；尚需执行数据库迁移和应用健康检查。\n恢复报告：%s\n' "$report"
