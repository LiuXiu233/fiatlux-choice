#!/bin/sh
set -eu

umask 077

usage() {
	cat <<'EOF'
usage: create-backup-attestation --file FILE --private-key FILE \
  --source-id ID --source-database DB --source-bucket BUCKET \
  --backup-tool-release VERSION --created-at TIMESTAMP
EOF
}

archive=""
private_key=""
source_id=""
source_database=""
source_bucket=""
backup_tool_release=""
created_at=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--file) archive=${2:?--file requires a value}; shift 2 ;;
		--private-key) private_key=${2:?--private-key requires a value}; shift 2 ;;
		--source-id) source_id=${2:?--source-id requires a value}; shift 2 ;;
		--source-database) source_database=${2:?--source-database requires a value}; shift 2 ;;
		--source-bucket) source_bucket=${2:?--source-bucket requires a value}; shift 2 ;;
		--backup-tool-release) backup_tool_release=${2:?--backup-tool-release requires a value}; shift 2 ;;
		--created-at) created_at=${2:?--created-at requires a value}; shift 2 ;;
		-h | --help) usage; exit 0 ;;
		*) printf 'unknown create-backup-attestation option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
	esac
done

for command in jq od openssl sha256sum; do
	command -v "$command" >/dev/null 2>&1 || {
		printf 'create-backup-attestation requires %s\n' "$command" >&2
		exit 127
	}
done
if [ ! -f "$archive" ] || [ -L "$archive" ] || [ ! -r "$archive" ]; then
	echo "archive must be a readable regular file and not a symlink" >&2
	exit 2
fi
if [ ! -f "$private_key" ] || [ -L "$private_key" ] || [ ! -r "$private_key" ]; then
	echo "Ed25519 private key must be a readable regular file and not a symlink" >&2
	exit 2
fi
case "$source_id" in *[!A-Za-z0-9._:-]* | "") echo "source ID is invalid" >&2; exit 2 ;; esac
case "$source_database" in *[!A-Za-z0-9_]* | "") echo "source database is invalid" >&2; exit 2 ;; esac
case "$source_bucket" in *[!A-Za-z0-9._-]* | "") echo "source bucket is invalid" >&2; exit 2 ;; esac
case "$backup_tool_release" in *[!A-Za-z0-9._-]* | "") echo "backup tool release is invalid" >&2; exit 2 ;; esac
case "$created_at" in
	????-??-??T??:??:??Z) ;;
	*) echo "created-at must be a UTC second timestamp" >&2; exit 2 ;;
esac
if [ "${#source_id}" -gt 128 ] || [ "${#source_database}" -gt 128 ] ||
	[ "${#source_bucket}" -gt 255 ] || [ "${#backup_tool_release}" -gt 128 ]; then
	echo "backup attestation identity field is too long" >&2
	exit 2
fi

archive_dir=$(dirname -- "$archive")
archive_dir=$(cd -- "$archive_dir" && pwd -P)
archive_basename=$(basename -- "$archive")
archive="$archive_dir/$archive_basename"
attestation="$archive.attestation.json"
signature="$archive.attestation.sig"
attestation_partial="$attestation.partial.$$"
signature_partial="$signature.partial.$$"
public_pem_partial="$attestation.public.pem.partial.$$"
public_der_partial="$attestation.public.der.partial.$$"
published=false
owns_output=false
cleanup() {
	status=$?
	trap - EXIT HUP INT TERM
	rm -f "$attestation_partial" "$signature_partial" "$public_pem_partial" "$public_der_partial"
	if [ "$owns_output" = true ] && [ "$published" != true ]; then
		rm -f "$attestation" "$signature"
	fi
	exit "$status"
}
trap cleanup EXIT HUP INT TERM

if [ -e "$attestation" ] || [ -L "$attestation" ] || [ -e "$signature" ] || [ -L "$signature" ]; then
	echo "backup attestation or signature already exists; refusing to overwrite" >&2
	exit 3
fi
owns_output=true

if ! openssl pkey -in "$private_key" -passin pass: -pubout \
	-out "$public_pem_partial" >/dev/null 2>&1; then
	echo "signing key must be an unencrypted Ed25519 private key" >&2
	exit 2
fi
openssl pkey -pubin -in "$public_pem_partial" -outform DER -out "$public_der_partial" >/dev/null 2>&1
public_der_hex=$(od -An -tx1 "$public_der_partial" | tr -d '[:space:]')
case "$public_der_hex" in
	302a300506032b6570032100????????????????????????????????????????????????????????????????) ;;
	*) echo "signing key must be an Ed25519 private key" >&2; exit 2 ;;
esac
key_fingerprint=$(sha256sum "$public_der_partial" | awk '{print $1}')
case "$key_fingerprint" in
	????????????????????????????????????????????????????????????????) ;;
	*) echo "unable to derive signing-key fingerprint" >&2; exit 3 ;;
esac
archive_sha256=$(sha256sum "$archive" | awk '{print $1}')
archive_size=$(wc -c <"$archive" | tr -d '[:space:]')
case "$archive_size" in "" | *[!0-9]*) echo "unable to read archive size" >&2; exit 3 ;; esac

jq -S -c -n \
	--arg algorithm Ed25519 \
	--arg archive_file "$archive_basename" \
	--arg archive_sha256 "$archive_sha256" \
	--argjson archive_size_bytes "$archive_size" \
	--arg backup_tool_release "$backup_tool_release" \
	--arg created_at "$created_at" \
	--arg key_fingerprint_sha256 "$key_fingerprint" \
	--arg source_bucket "$source_bucket" \
	--arg source_database "$source_database" \
	--arg source_id "$source_id" \
	'{algorithm: $algorithm, archiveFile: $archive_file, archiveSha256: $archive_sha256, archiveSizeBytes: $archive_size_bytes, backupToolRelease: $backup_tool_release, createdAt: $created_at, formatVersion: 1, keyFingerprintSha256: $key_fingerprint_sha256, sourceBucket: $source_bucket, sourceDatabase: $source_database, sourceId: $source_id}' \
	>"$attestation_partial"
openssl pkeyutl -sign -rawin -inkey "$private_key" -passin pass: \
	-in "$attestation_partial" -out "$signature_partial"
signature_size=$(wc -c <"$signature_partial" | tr -d '[:space:]')
if [ "$signature_size" != 64 ]; then
	echo "Ed25519 signature must be exactly 64 bytes" >&2
	exit 3
fi
openssl pkeyutl -verify -rawin -pubin -inkey "$public_pem_partial" \
	-in "$attestation_partial" -sigfile "$signature_partial" >/dev/null
chmod 0600 "$attestation_partial" "$signature_partial"
mv "$attestation_partial" "$attestation"
mv "$signature_partial" "$signature"
published=true
trap - EXIT HUP INT TERM
rm -f "$public_pem_partial" "$public_der_partial"
printf 'backup attestation signed: archive=%s keyFingerprintSha256=%s\n' \
	"$archive_basename" "$key_fingerprint"
