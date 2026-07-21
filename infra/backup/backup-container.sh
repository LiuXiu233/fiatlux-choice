#!/bin/sh
set -eu

umask 077

required_variables="BACKUP_SOURCE_ID BACKUP_TOOL_RELEASE PGHOST PGDATABASE PGUSER PGPASSWORD S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

if [ "${#BACKUP_SOURCE_ID}" -gt 128 ]; then
	echo "BACKUP_SOURCE_ID 不能超过 128 字符。" >&2
	exit 2
fi
case "$BACKUP_SOURCE_ID" in
	*[!A-Za-z0-9._:-]* | "")
		echo "BACKUP_SOURCE_ID 只能包含字母、数字、点、下划线、冒号和连字符。" >&2
		exit 2
		;;
esac
if [ "${#BACKUP_TOOL_RELEASE}" -gt 128 ]; then
	echo "BACKUP_TOOL_RELEASE 不能超过 128 字符。" >&2
	exit 2
fi
case "$BACKUP_TOOL_RELEASE" in
	*[!A-Za-z0-9._-]* | "")
		echo "BACKUP_TOOL_RELEASE 只能包含字母、数字、点、下划线和连字符。" >&2
		exit 2
		;;
esac

if [ "${BACKUP_REQUIRE_ENCRYPTION:-false}" = "true" ] && [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
	echo "生产备份要求设置 BACKUP_AGE_RECIPIENT。" >&2
	exit 2
fi
case "${BACKUP_REQUIRE_SIGNATURE:-false}" in
	true | false) ;;
	*) echo "BACKUP_REQUIRE_SIGNATURE 必须是 true 或 false。" >&2; exit 2 ;;
esac
case "${BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" in
	true | false) ;;
	*) echo "BACKUP_SIGNING_PRIVATE_KEY_STDIN 必须是 true 或 false。" >&2; exit 2 ;;
esac
if [ "${BACKUP_REQUIRE_SIGNATURE:-false}" = "true" ] &&
	[ "${BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" != "true" ]; then
	echo "生产备份要求通过 stdin 提供 Ed25519 签名私钥。" >&2
	exit 2
fi

backup_name=${BACKUP_NAME:-fiatlux-$(date -u +%Y%m%dT%H%M%SZ)}
case "$backup_name" in
	*[!A-Za-z0-9._-]* | "")
		echo "备份名称只能包含字母、数字、点、下划线和连字符。" >&2
		exit 2
		;;
esac

backup_root=/backups
work_root=${BACKUP_WORK_ROOT:-/backup-work}
if [ ! -d "$work_root" ] || [ -L "$work_root" ]; then
	echo "备份明文工作区必须是受保护的真实目录：$work_root" >&2
	exit 2
fi
stale_work=$(find "$work_root" -mindepth 1 -maxdepth 1 -print -quit)
if [ -n "$stale_work" ]; then
	echo "备份明文工作区存在陈旧内容，拒绝自动清理：$stale_work" >&2
	exit 4
fi

staging="$work_root/$backup_name.staging.partial"
archive_partial="$work_root/$backup_name.tar.gz.partial"
archive="$backup_root/$backup_name.tar.gz"
encrypted_partial="$archive.age.partial"
encrypted="$archive.age"
signing_key_partial="$work_root/.$backup_name.signing-key.partial"
backup_completed=false
owns_output=false

cleanup() {
	status=$?
	trap - EXIT HUP INT TERM
	rm -rf "$staging" "$archive_partial" "$encrypted_partial" \
		"$archive.partial" "$archive.sha256.partial" "$encrypted.sha256.partial" \
		"$signing_key_partial"
	if [ "$owns_output" = true ] && [ "$backup_completed" != true ]; then
		rm -f "$archive" "$archive.sha256" "$archive.attestation.json" \
			"$archive.attestation.sig" "$encrypted" "$encrypted.sha256" \
			"$encrypted.attestation.json" "$encrypted.attestation.sig"
	fi
	exit "$status"
}
trap cleanup EXIT HUP INT TERM

if [ -e "$archive" ] || [ -e "$encrypted" ] || [ -e "$archive.sha256" ] ||
	[ -e "$encrypted.sha256" ] || [ -e "$archive.attestation.json" ] ||
	[ -e "$archive.attestation.sig" ] || [ -e "$encrypted.attestation.json" ] ||
	[ -e "$encrypted.attestation.sig" ]; then
	echo "备份文件已存在，拒绝覆盖：$backup_name" >&2
	exit 3
fi
owns_output=true

if [ "${BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" = "true" ]; then
	cat >"$signing_key_partial"
	chmod 0600 "$signing_key_partial"
	signing_key_size=$(wc -c <"$signing_key_partial" | tr -d '[:space:]')
	case "$signing_key_size" in
		"" | *[!0-9]*) echo "无法读取备份签名私钥大小。" >&2; exit 2 ;;
	esac
	if [ "$signing_key_size" -lt 32 ] || [ "$signing_key_size" -gt 16384 ]; then
		echo "备份签名私钥大小无效。" >&2
		exit 2
	fi
fi

mkdir -p "$staging/objects"

echo "[1/5] 导出 PostgreSQL（自定义格式）"
export PGPASSWORD
pg_dump \
	--format=custom \
	--compress=9 \
	--no-owner \
	--no-privileges \
	--file="$staging/database.dump" \
	"$PGDATABASE"

echo "[2/5] 镜像 MinIO 对象"
mc alias set source "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
mc stat "source/$S3_BUCKET" >/dev/null
mc mirror "source/$S3_BUCKET" "$staging/objects"

created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pg_version=$(pg_dump --version)
mc_version=$(mc --version | sed -n '1p')
jq -n \
	--arg source_id "$BACKUP_SOURCE_ID" \
	--arg backup_name "$backup_name" \
	--arg created_at "$created_at" \
	--arg database "$PGDATABASE" \
	--arg bucket "$S3_BUCKET" \
	--arg backup_tool_release "$BACKUP_TOOL_RELEASE" \
	--arg postgres_tool "$pg_version" \
	--arg minio_tool "$mc_version" \
	'{formatVersion: "2", sourceId: $source_id, backupName: $backup_name, createdAt: $created_at, database: $database, bucket: $bucket, tools: {backupRelease: $backup_tool_release, postgres: $postgres_tool, minioClient: $minio_tool}}' \
	>"$staging/metadata.json"

echo "[3/5] 生成完整性清单"
(
	cd "$staging"
	find . -type f ! -path ./manifest.sha256 -print0 | sort -z | xargs -0 sha256sum
) >"$staging/manifest.sha256"

echo "[4/5] 创建归档"
tar -C "$staging" -czf "$archive_partial" .

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
	echo "[5/5] 使用 age 加密归档"
	age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_partial" "$archive_partial"
	mv "$encrypted_partial" "$encrypted"
	# The tarball is plaintext even though its name ends in .partial. Remove it before disabling
	# the cleanup trap; otherwise every successful encrypted backup leaves a hidden cleartext copy.
	rm -f "$archive_partial"
	final_file=$encrypted
else
	echo "[5/5] 未设置 age 接收者；保留未加密归档（仅允许开发环境）"
	cp "$archive_partial" "$archive.partial"
	mv "$archive.partial" "$archive"
	rm -f "$archive_partial"
	final_file=$archive
fi

rm -rf "$staging"

final_sha256=$(sha256sum "$final_file" | awk '{print $1}')
checksum_file="$final_file.sha256"
checksum_partial="$checksum_file.partial"
printf '%s  %s\n' "$final_sha256" "$(basename "$final_file")" >"$checksum_partial"
chmod 0600 "$checksum_partial"
if [ "${BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" = "true" ]; then
	create-backup-attestation \
		--file "$final_file" \
		--private-key "$signing_key_partial" \
		--source-id "$BACKUP_SOURCE_ID" \
		--source-database "$PGDATABASE" \
		--source-bucket "$S3_BUCKET" \
		--backup-tool-release "$BACKUP_TOOL_RELEASE" \
		--created-at "$created_at"
elif [ "${BACKUP_REQUIRE_SIGNATURE:-false}" = "true" ]; then
	echo "生产备份未生成签名证明，拒绝完成。" >&2
	exit 3
else
	echo "警告：未提供备份签名私钥；该开发备份没有来源真实性证明。" >&2
fi
mv "$checksum_partial" "$checksum_file"
rm -f "$signing_key_partial"
backup_completed=true
trap - EXIT HUP INT TERM
printf '备份完成：%s\nSHA-256：%s\n待复核清单：%s\n' "$final_file" "$final_sha256" "$checksum_file"
if [ -f "$final_file.attestation.json" ] && [ -f "$final_file.attestation.sig" ]; then
	printf '签名证明：%s\n签名：%s\n' \
		"$final_file.attestation.json" "$final_file.attestation.sig"
fi
