#!/bin/sh
set -eu

umask 077

required_variables="PGHOST PGDATABASE PGUSER PGPASSWORD S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

if [ "${BACKUP_REQUIRE_ENCRYPTION:-false}" = "true" ] && [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
	echo "生产备份要求设置 BACKUP_AGE_RECIPIENT。" >&2
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
staging="$backup_root/.$backup_name.partial"
archive_partial="$backup_root/.$backup_name.tar.gz.partial"
archive="$backup_root/$backup_name.tar.gz"
encrypted_partial="$archive.age.partial"
encrypted="$archive.age"

cleanup() {
	rm -rf "$staging" "$archive_partial" "$encrypted_partial"
}
trap cleanup EXIT HUP INT TERM

if [ -e "$archive" ] || [ -e "$encrypted" ]; then
	echo "备份文件已存在，拒绝覆盖：$backup_name" >&2
	exit 3
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
	--arg format_version "1" \
	--arg created_at "$created_at" \
	--arg database "$PGDATABASE" \
	--arg bucket "$S3_BUCKET" \
	--arg postgres_tool "$pg_version" \
	--arg minio_tool "$mc_version" \
	'{formatVersion: $format_version, createdAt: $created_at, database: $database, bucket: $bucket, tools: {postgres: $postgres_tool, minioClient: $minio_tool}}' \
	>"$staging/metadata.json"

echo "[3/5] 生成完整性清单"
(
	cd "$staging"
	find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum
) >"$staging/manifest.sha256"

echo "[4/5] 创建归档"
tar -C "$staging" -czf "$archive_partial" .

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
	echo "[5/5] 使用 age 加密归档"
	age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_partial" "$archive_partial"
	mv "$encrypted_partial" "$encrypted"
	final_file=$encrypted
else
	echo "[5/5] 未设置 age 接收者；保留未加密归档（仅允许开发环境）"
	mv "$archive_partial" "$archive"
	final_file=$archive
fi

rm -rf "$staging"
trap - EXIT HUP INT TERM

final_sha256=$(sha256sum "$final_file" | awk '{print $1}')
printf '备份完成：%s\nSHA-256：%s\n' "$final_file" "$final_sha256"
