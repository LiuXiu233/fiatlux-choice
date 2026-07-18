#!/bin/sh
set -eu

umask 077

backup_id=${1:-}
scope=${2:-}
backup_dir=${3:-}

case "$backup_id" in
	*[!A-Za-z0-9-]* | "")
		echo "invalid backup id" >&2
		exit 2
		;;
esac
if [ "$scope" != "database" ]; then
	echo "Web backups support database scope only; use backup.sh for a quiesced full backup" >&2
	exit 2
fi
if [ "$backup_dir" != "/backups" ]; then
	echo "worker backup directory must be /backups" >&2
	exit 2
fi

required_variables="PGHOST PGDATABASE PGUSER PGPASSWORD"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "missing required variable: $variable" >&2
		exit 2
	fi
done

mkdir -p "$backup_dir"
partial="$backup_dir/.$backup_id.dump.partial"
plain="$backup_dir/$backup_id.dump"
encrypted_partial="$backup_dir/.$backup_id.dump.age.partial"
encrypted="$backup_dir/$backup_id.dump.age"

cleanup() {
	rm -f "$partial" "$encrypted_partial"
}
trap cleanup EXIT HUP INT TERM

if [ -e "$plain" ] || [ -e "$encrypted" ]; then
	echo "backup target already exists" >&2
	exit 3
fi

export PGPASSWORD
pg_dump \
	--format=custom \
	--compress=9 \
	--no-owner \
	--no-privileges \
	--file="$partial" \
	"$PGDATABASE" >&2

if [ "${BACKUP_REQUIRE_ENCRYPTION:-false}" = "true" ]; then
	if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
		echo "production worker backups require BACKUP_AGE_RECIPIENT" >&2
		exit 2
	fi
	age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_partial" "$partial"
	mv "$encrypted_partial" "$encrypted"
	rm -f "$partial"
	final_file=$encrypted
else
	mv "$partial" "$plain"
	final_file=$plain
fi

trap - EXIT HUP INT TERM
size_bytes=$(wc -c <"$final_file" | tr -d ' ')
checksum=$(sha256sum "$final_file" | awk '{print $1}')
printf '{"storageKey":"%s","sizeBytes":%s,"checksumSha256":"%s"}\n' \
	"$final_file" "$size_bytes" "$checksum"
