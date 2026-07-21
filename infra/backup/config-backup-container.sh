#!/bin/sh
set -eu

umask 077

required_variables="CONFIG_BACKUP_NAME CONFIG_BACKUP_RECIPIENT CONFIG_BACKUP_SOURCE_ID CONFIG_BACKUP_SOURCE_DATABASE CONFIG_BACKUP_SOURCE_BUCKET CONFIG_BACKUP_TOOL_RELEASE"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		printf '配置备份缺少必需环境变量：%s\n' "$variable" >&2
		exit 2
	fi
done

case "$CONFIG_BACKUP_NAME" in
	*[!A-Za-z0-9._-]* | "") echo "配置备份名称格式无效。" >&2; exit 2 ;;
esac
case "$CONFIG_BACKUP_SOURCE_ID" in
	*[!A-Za-z0-9._:-]* | "") echo "配置备份来源 ID 格式无效。" >&2; exit 2 ;;
esac
case "$CONFIG_BACKUP_SOURCE_DATABASE" in
	*[!A-Za-z0-9_]* | "") echo "配置备份来源数据库格式无效。" >&2; exit 2 ;;
esac
case "$CONFIG_BACKUP_SOURCE_BUCKET" in
	*[!A-Za-z0-9._-]* | "") echo "配置备份来源桶格式无效。" >&2; exit 2 ;;
esac
case "$CONFIG_BACKUP_TOOL_RELEASE" in
	*[!A-Za-z0-9._-]* | "") echo "配置备份工具版本格式无效。" >&2; exit 2 ;;
esac
if [ "${#CONFIG_BACKUP_SOURCE_ID}" -gt 128 ] ||
	[ "${#CONFIG_BACKUP_SOURCE_DATABASE}" -gt 128 ] ||
	[ "${#CONFIG_BACKUP_SOURCE_BUCKET}" -gt 255 ] ||
	[ "${#CONFIG_BACKUP_TOOL_RELEASE}" -gt 128 ]; then
	echo "配置备份来源字段过长。" >&2
	exit 2
fi
case "${CONFIG_BACKUP_REQUIRE_SIGNATURE:-false}" in
	true | false) ;;
	*) echo "CONFIG_BACKUP_REQUIRE_SIGNATURE 必须是 true 或 false。" >&2; exit 2 ;;
esac
case "${CONFIG_BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" in
	true | false) ;;
	*) echo "CONFIG_BACKUP_SIGNING_PRIVATE_KEY_STDIN 必须是 true 或 false。" >&2; exit 2 ;;
esac
if [ "${CONFIG_BACKUP_REQUIRE_SIGNATURE:-false}" = true ] &&
	[ "${CONFIG_BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" != true ]; then
	echo "生产配置备份要求通过 stdin 提供 Ed25519 私钥。" >&2
	exit 2
fi

input_env=/run/backup-input/production.env
input_releases=/run/backup-input/releases
if [ ! -f "$input_env" ] || [ -L "$input_env" ] || [ ! -r "$input_env" ]; then
	echo "配置备份输入必须是可读普通文件且不得为符号链接。" >&2
	exit 2
fi
env_size=$(wc -c <"$input_env" | tr -d '[:space:]')
case "$env_size" in "" | *[!0-9]*) echo "无法读取生产配置大小。" >&2; exit 2 ;; esac
if [ "$env_size" -lt 1 ] || [ "$env_size" -gt 1048576 ]; then
	echo "生产配置大小必须在 1 byte 到 1 MiB 之间。" >&2
	exit 2
fi
if [ -e "$input_releases" ]; then
	if [ ! -d "$input_releases" ] || [ -L "$input_releases" ]; then
		echo "发布状态输入必须是真实目录。" >&2
		exit 2
	fi
	unsafe_release_entry=$(find "$input_releases" -mindepth 1 \
		! -type d ! -type f -print -quit)
	if [ -n "$unsafe_release_entry" ]; then
		printf '发布状态包含非普通文件/目录：%s\n' "$unsafe_release_entry" >&2
		exit 2
	fi
	release_entries=$(find "$input_releases" -mindepth 1 -print | wc -l | tr -d '[:space:]')
	release_kib=$(du -sk "$input_releases" | awk '{print $1}')
	case "$release_entries:$release_kib" in
		*[!0-9:]*) echo "无法读取发布状态资源量。" >&2; exit 2 ;;
	esac
	if [ "$release_entries" -gt 1000 ] || [ "$release_kib" -gt 16384 ]; then
		echo "发布状态超过 1000 项或 16 MiB 配置备份上限。" >&2
		exit 2
	fi
fi

backup_root=/backups
work_root=${BACKUP_WORK_ROOT:-/backup-work}
if [ ! -d "$work_root" ] || [ -L "$work_root" ]; then
	echo "配置备份工作区必须是受保护的真实目录。" >&2
	exit 2
fi
stale_work=$(find "$work_root" -mindepth 1 -maxdepth 1 -print -quit)
if [ -n "$stale_work" ]; then
	printf '配置备份工作区存在陈旧内容：%s\n' "$stale_work" >&2
	exit 4
fi

output="$backup_root/$CONFIG_BACKUP_NAME.config.tar.gz.age"
checksum="$output.sha256"
staging="$work_root/$CONFIG_BACKUP_NAME.config.staging.partial"
plain_partial="$work_root/$CONFIG_BACKUP_NAME.config.tar.gz.partial"
output_partial="$output.partial"
checksum_partial="$checksum.partial"
signing_key="$work_root/.$CONFIG_BACKUP_NAME.config-signing-key.partial"
complete=false
owns_output=false
cleanup() {
	status=$?
	trap - EXIT HUP INT TERM
	rm -rf "$staging" "$plain_partial" "$output_partial" "$checksum_partial" "$signing_key"
	if [ "$owns_output" = true ] && [ "$complete" != true ]; then
		rm -f "$output" "$checksum" "$output.attestation.json" "$output.attestation.sig"
	fi
	exit "$status"
}
trap cleanup EXIT HUP INT TERM

for candidate in \
	"$output" "$checksum" "$output.attestation.json" "$output.attestation.sig" \
	"$output_partial" "$checksum_partial"; do
	if [ -e "$candidate" ] || [ -L "$candidate" ]; then
		printf '配置备份或 sidecar 已存在，拒绝覆盖：%s\n' "$candidate" >&2
		exit 3
	fi
done
owns_output=true

if [ "${CONFIG_BACKUP_SIGNING_PRIVATE_KEY_STDIN:-false}" = true ]; then
	cat >"$signing_key"
	chmod 0600 "$signing_key"
	signing_key_size=$(wc -c <"$signing_key" | tr -d '[:space:]')
	case "$signing_key_size" in
		"" | *[!0-9]*) echo "无法读取配置备份签名私钥大小。" >&2; exit 2 ;;
	esac
	if [ "$signing_key_size" -lt 32 ] || [ "$signing_key_size" -gt 16384 ]; then
		echo "配置备份签名私钥大小无效。" >&2
		exit 2
	fi
fi

mkdir -p "$staging"
cp "$input_env" "$staging/production.env"
if [ -d "$input_releases" ]; then
	cp -R "$input_releases" "$staging/releases"
fi
tar -C "$staging" -czf "$plain_partial" .
age --recipient "$CONFIG_BACKUP_RECIPIENT" --output "$output_partial" "$plain_partial"
mv "$output_partial" "$output"
rm -rf "$staging" "$plain_partial"

created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -f "$signing_key" ]; then
	create-backup-attestation \
		--file "$output" \
		--private-key "$signing_key" \
		--source-id "$CONFIG_BACKUP_SOURCE_ID" \
		--source-database "$CONFIG_BACKUP_SOURCE_DATABASE" \
		--source-bucket "$CONFIG_BACKUP_SOURCE_BUCKET" \
		--backup-tool-release "$CONFIG_BACKUP_TOOL_RELEASE" \
		--created-at "$created_at"
elif [ "${CONFIG_BACKUP_REQUIRE_SIGNATURE:-false}" = true ]; then
	echo "生产配置备份未生成签名证明。" >&2
	exit 3
else
	echo "警告：开发配置备份没有来源签名。" >&2
fi

output_sha=$(sha256sum "$output" | awk '{print $1}')
printf '%s  %s\n' "$output_sha" "$(basename "$output")" >"$checksum_partial"
chmod 0600 "$checksum_partial"
mv "$checksum_partial" "$checksum"
rm -f "$signing_key"
complete=true
trap - EXIT HUP INT TERM
printf '配置备份完成：%s\nSHA-256：%s\n待复核清单：%s\n' \
	"$output" "$output_sha" "$checksum"
if [ -f "$output.attestation.json" ] && [ -f "$output.attestation.sig" ]; then
	printf '签名证明：%s\n签名：%s\n' \
		"$output.attestation.json" "$output.attestation.sig"
fi
