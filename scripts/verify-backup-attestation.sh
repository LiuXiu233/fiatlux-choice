#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: verify-backup-attestation.sh --file FILE --attestation FILE --signature FILE \
  --public-key FILE --expected-signing-key-sha256 SHA256 --expected-sha256 SHA256 \
  --expected-source-id ID --expected-source-database DB --expected-source-bucket BUCKET \
  --expected-backup-tool-release VERSION
EOF
}

archive=""
attestation=""
signature=""
public_key=""
expected_key_sha256=""
expected_sha256=""
expected_source_id=""
expected_source_database=""
expected_source_bucket=""
expected_backup_tool_release=""
while (($#)); do
  case "$1" in
    --file) archive=${2:?--file requires a value}; shift 2 ;;
    --attestation) attestation=${2:?--attestation requires a value}; shift 2 ;;
    --signature) signature=${2:?--signature requires a value}; shift 2 ;;
    --public-key) public_key=${2:?--public-key requires a value}; shift 2 ;;
    --expected-signing-key-sha256)
      expected_key_sha256=${2:?--expected-signing-key-sha256 requires a value}; shift 2 ;;
    --expected-sha256) expected_sha256=${2:?--expected-sha256 requires a value}; shift 2 ;;
    --expected-source-id) expected_source_id=${2:?--expected-source-id requires a value}; shift 2 ;;
    --expected-source-database)
      expected_source_database=${2:?--expected-source-database requires a value}; shift 2 ;;
    --expected-source-bucket)
      expected_source_bucket=${2:?--expected-source-bucket requires a value}; shift 2 ;;
    --expected-backup-tool-release)
      expected_backup_tool_release=${2:?--expected-backup-tool-release requires a value}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown verify-backup-attestation option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

for command in cmp jq od openssl sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'verify-backup-attestation requires %s\n' "$command" >&2
    exit 127
  }
done
for candidate in "$archive" "$attestation" "$signature" "$public_key"; do
  if [[ -z "$candidate" || ! -f "$candidate" || -L "$candidate" || ! -r "$candidate" ]]; then
    printf 'backup signature input must be a readable regular file and not a symlink: %s\n' \
      "${candidate:-missing}" >&2
    exit 2
  fi
done
for digest in "$expected_key_sha256" "$expected_sha256"; do
  if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
    echo "approved SHA-256 values must be 64 lowercase hexadecimal characters" >&2
    exit 2
  fi
done
if [[ ! "$expected_source_id" =~ ^[A-Za-z0-9._:-]+$ ]] ||
  [[ ! "$expected_source_database" =~ ^[A-Za-z0-9_]+$ ]] ||
  [[ ! "$expected_source_bucket" =~ ^[A-Za-z0-9._-]+$ ]] ||
  [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "approved backup identity values are invalid" >&2
  exit 2
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/fiatlux-backup-verify.XXXXXX")
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

openssl pkey -pubin -in "$public_key" -outform DER -out "$work/public.der" >/dev/null 2>&1
public_der_hex=$(od -An -tx1 "$work/public.der" | tr -d '[:space:]')
if [[ ! "$public_der_hex" =~ ^302a300506032b6570032100[0-9a-f]{64}$ ]]; then
  echo "backup signing public key must be Ed25519" >&2
  exit 4
fi
actual_key_sha256=$(sha256sum "$work/public.der" | awk '{print $1}')
if [[ "$actual_key_sha256" != "$expected_key_sha256" ]]; then
  echo "backup signing public key does not match the independently approved fingerprint" >&2
  exit 4
fi
signature_size=$(wc -c <"$signature" | tr -d '[:space:]')
if [[ "$signature_size" != 64 ]]; then
  echo "backup Ed25519 signature must be exactly 64 bytes" >&2
  exit 4
fi
attestation_size=$(wc -c <"$attestation" | tr -d '[:space:]')
if [[ ! "$attestation_size" =~ ^[0-9]+$ ]] ||
  ((attestation_size == 0 || attestation_size > 4096)); then
  echo "backup attestation size is invalid" >&2
  exit 4
fi

jq -S -c . "$attestation" >"$work/canonical.json"
if ! cmp -s "$attestation" "$work/canonical.json"; then
  echo "backup attestation is not canonical single-line JSON" >&2
  exit 4
fi
if ! jq -e \
  --arg archive_file "$(basename "$archive")" \
  --arg archive_sha256 "$expected_sha256" \
  --arg key_fingerprint_sha256 "$expected_key_sha256" \
  --arg source_id "$expected_source_id" \
  --arg source_database "$expected_source_database" \
  --arg source_bucket "$expected_source_bucket" \
  --arg backup_tool_release "$expected_backup_tool_release" '
    type == "object" and
    keys == ["algorithm", "archiveFile", "archiveSha256", "archiveSizeBytes", "backupToolRelease", "createdAt", "formatVersion", "keyFingerprintSha256", "sourceBucket", "sourceDatabase", "sourceId"] and
    .formatVersion == 1 and .algorithm == "Ed25519" and
    .archiveFile == $archive_file and .archiveSha256 == $archive_sha256 and
    .keyFingerprintSha256 == $key_fingerprint_sha256 and .sourceId == $source_id and
    .sourceDatabase == $source_database and .sourceBucket == $source_bucket and
    .backupToolRelease == $backup_tool_release and
    (.archiveSizeBytes | type == "number" and . > 0 and . <= 9007199254740991 and floor == .) and
    (.createdAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  ' "$attestation" >/dev/null; then
  echo "backup attestation does not match the independently approved archive identity" >&2
  exit 4
fi

actual_archive_sha256=$(sha256sum "$archive" | awk '{print $1}')
actual_archive_size=$(wc -c <"$archive" | tr -d '[:space:]')
attested_archive_size=$(jq -r '.archiveSizeBytes' "$attestation")
if [[ "$actual_archive_sha256" != "$expected_sha256" ||
  "$actual_archive_size" != "$attested_archive_size" ]]; then
  echo "backup archive bytes do not match the approved signed attestation" >&2
  exit 4
fi
if ! openssl pkeyutl -verify -rawin -pubin -inkey "$public_key" \
  -in "$attestation" -sigfile "$signature" >/dev/null 2>&1; then
  echo "backup Ed25519 signature verification failed" >&2
  exit 4
fi

attestation_sha256=$(sha256sum "$attestation" | awk '{print $1}')
jq -c -n \
  --arg attestationSha256 "$attestation_sha256" \
  --arg signingKeyFingerprintSha256 "$actual_key_sha256" \
  '{signatureVerified: true, attestationSha256: $attestationSha256, signingKeyFingerprintSha256: $signingKeyFingerprintSha256}'
