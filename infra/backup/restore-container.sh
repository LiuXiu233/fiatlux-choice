#!/bin/sh
set -eu

umask 077

required_variables="BACKUP_FILE PGHOST PGDATABASE PGUSER PGPASSWORD S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY RESTORE_CONFIRM_DATABASE RESTORE_CONFIRM_BUCKET RESTORE_APPROVED"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

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
case "$BACKUP_FILE" in
	/backups/*) ;;
	*)
		echo "BACKUP_FILE 必须位于 /backups。" >&2
		exit 2
		;;
esac
if [ ! -f "$BACKUP_FILE" ]; then
	echo "找不到备份文件：$BACKUP_FILE" >&2
	exit 3
fi

work=/tmp/fiatlux-restore-$$
archive=$BACKUP_FILE
mkdir -p "$work/payload"
cleanup() {
	rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

case "$BACKUP_FILE" in
	*.age)
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
		age --decrypt --identity "$identity" --output "$archive" "$BACKUP_FILE"
		;;
	*.tar.gz) ;;
	*)
		echo "仅支持 .tar.gz 或 .tar.gz.age 备份。" >&2
		exit 3
		;;
esac

if tar -tzf "$archive" | awk '/^\// || /(^|\/)\.\.($|\/)/ { unsafe=1 } END { exit unsafe ? 0 : 1 }'; then
	echo "归档包含不安全路径，拒绝提取。" >&2
	exit 4
fi
tar -xzf "$archive" -C "$work/payload"

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

echo "[1/4] 校验备份清单"
(
	cd "$work/payload"
	sha256sum --check manifest.sha256
)

echo "[2/4] 替换 PostgreSQL 数据库"
export PGPASSWORD
psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=target_db="$PGDATABASE" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db' AND pid <> pg_backend_pid();
SQL
dropdb --if-exists "$PGDATABASE"
createdb "$PGDATABASE"
pg_restore \
	--exit-on-error \
	--no-owner \
	--no-privileges \
	--dbname="$PGDATABASE" \
	"$work/payload/database.dump"

echo "[3/4] 替换 MinIO 对象桶"
mc alias set target "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null
if mc stat "target/$S3_BUCKET" >/dev/null 2>&1; then
	mc rm --recursive --force "target/$S3_BUCKET"
else
	mc mb "target/$S3_BUCKET"
fi
mc mirror "$work/payload/objects" "target/$S3_BUCKET"
mc anonymous set none "target/$S3_BUCKET"

echo "[4/4] 写入恢复报告"
report_dir=/backups/restore-reports
mkdir -p "$report_dir"
report="$report_dir/restore-$(date -u +%Y%m%dT%H%M%SZ).json"
jq -n \
	--arg restored_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	--arg source "$(basename "$BACKUP_FILE")" \
	--arg database "$PGDATABASE" \
	--arg bucket "$S3_BUCKET" \
	'{restoredAt: $restored_at, source: $source, database: $database, bucket: $bucket, checksumVerified: true}' \
	>"$report"

printf '数据恢复完成；尚需执行数据库迁移和应用健康检查。\n恢复报告：%s\n' "$report"
