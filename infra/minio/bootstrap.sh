#!/bin/sh
set -eu

required_variables="MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BACKUP_ACCESS_KEY_ID S3_BACKUP_SECRET_ACCESS_KEY S3_RESTORE_ACCESS_KEY_ID S3_RESTORE_SECRET_ACCESS_KEY"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

case "$S3_BUCKET" in
	*[!A-Za-z0-9._-]* | "")
		echo "S3_BUCKET 只能包含字母、数字、点、下划线和连字符。" >&2
		exit 2
		;;
esac

validate_access_key() {
	key=$1
	label=$2
	case "$key" in
		*[!A-Za-z0-9._-]* | "")
			echo "$label 只能包含字母、数字、点、下划线和连字符。" >&2
			exit 2
			;;
	esac
	if [ "${#key}" -lt 3 ] || [ "${#key}" -gt 64 ]; then
		echo "$label 长度必须为 3–64 个字符。" >&2
		exit 2
	fi
}

validate_secret() {
	secret=$1
	label=$2
	if [ "${#secret}" -lt 16 ]; then
		echo "$label 必须至少包含 16 个字符。" >&2
		exit 2
	fi
}

validate_access_key "$S3_ACCESS_KEY_ID" S3_ACCESS_KEY_ID
validate_access_key "$S3_BACKUP_ACCESS_KEY_ID" S3_BACKUP_ACCESS_KEY_ID
validate_access_key "$S3_RESTORE_ACCESS_KEY_ID" S3_RESTORE_ACCESS_KEY_ID
validate_secret "$S3_SECRET_ACCESS_KEY" S3_SECRET_ACCESS_KEY
validate_secret "$S3_BACKUP_SECRET_ACCESS_KEY" S3_BACKUP_SECRET_ACCESS_KEY
validate_secret "$S3_RESTORE_SECRET_ACCESS_KEY" S3_RESTORE_SECRET_ACCESS_KEY

if [ "$S3_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ] || \
	[ "$S3_BACKUP_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ] || \
	[ "$S3_RESTORE_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ]; then
	echo "运行时、备份或恢复账号不得复用 MinIO root 身份。" >&2
	exit 2
fi
if [ "$S3_ACCESS_KEY_ID" = "$S3_BACKUP_ACCESS_KEY_ID" ] || \
	[ "$S3_ACCESS_KEY_ID" = "$S3_RESTORE_ACCESS_KEY_ID" ] || \
	[ "$S3_BACKUP_ACCESS_KEY_ID" = "$S3_RESTORE_ACCESS_KEY_ID" ]; then
	echo "应用、备份和恢复必须使用三个不同的 MinIO 账号。" >&2
	exit 2
fi
if [ "$S3_SECRET_ACCESS_KEY" = "$MINIO_ROOT_PASSWORD" ] || \
	[ "$S3_BACKUP_SECRET_ACCESS_KEY" = "$MINIO_ROOT_PASSWORD" ] || \
	[ "$S3_RESTORE_SECRET_ACCESS_KEY" = "$MINIO_ROOT_PASSWORD" ]; then
	echo "应用、备份或恢复 secret 不得复用 MinIO root secret。" >&2
	exit 2
fi
if [ "$S3_SECRET_ACCESS_KEY" = "$S3_BACKUP_SECRET_ACCESS_KEY" ] || \
	[ "$S3_SECRET_ACCESS_KEY" = "$S3_RESTORE_SECRET_ACCESS_KEY" ] || \
	[ "$S3_BACKUP_SECRET_ACCESS_KEY" = "$S3_RESTORE_SECRET_ACCESS_KEY" ]; then
	echo "应用、备份和恢复必须使用三个不同的 MinIO secret。" >&2
	exit 2
fi

mc alias set admin http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
mc mb --ignore-existing "admin/$S3_BUCKET" >/dev/null
mc anonymous set none "admin/$S3_BUCKET" >/dev/null

render_policy() {
	template=$1
	output=$2
	sed "s/__BUCKET__/$S3_BUCKET/g" "$template" >"$output"
}

render_policy /policies/app-policy.json /tmp/app-policy.json
render_policy /policies/backup-policy.json /tmp/backup-policy.json
render_policy /policies/restore-policy.json /tmp/restore-policy.json

ensure_user() {
	access_key=$1
	secret_key=$2
	policy=$3
	policy_file=$4
	mc admin policy create admin "$policy" "$policy_file" >/dev/null
	if mc admin user info admin "$access_key" >/dev/null 2>&1; then
		# Recreate the stable identity so a previously attached wider policy cannot survive bootstrap.
		mc admin user remove admin "$access_key" >/dev/null
	fi
	mc admin user add admin "$access_key" "$secret_key" >/dev/null
	mc admin policy attach admin "$policy" --user "$access_key" >/dev/null
	user_info=$(mc admin user info admin "$access_key" --json)
	case "$user_info" in
		*\"policyName\":\"$policy\"*) ;;
		*)
			echo "MinIO 用户 $access_key 未精确附加预期策略 $policy。" >&2
			exit 3
			;;
	esac
}

ensure_user "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" fiatlux-choice-app /tmp/app-policy.json
ensure_user "$S3_BACKUP_ACCESS_KEY_ID" "$S3_BACKUP_SECRET_ACCESS_KEY" fiatlux-choice-backup /tmp/backup-policy.json
ensure_user "$S3_RESTORE_ACCESS_KEY_ID" "$S3_RESTORE_SECRET_ACCESS_KEY" fiatlux-choice-restore /tmp/restore-policy.json

echo "MinIO 桶及应用/备份/恢复最小权限账号已收敛。"
