#!/usr/bin/env bash
set -euo pipefail

umask 077

expected_root=${EXPECTED_OBJECT_ROOT:-}
target_alias=${TARGET_OBJECT_ALIAS:-}
target_bucket=${TARGET_OBJECT_BUCKET:-}
output_manifest=${OBJECT_VERIFICATION_MANIFEST:-}
work_root=${OBJECT_VERIFICATION_WORK_ROOT:-}

if [[ -z "$expected_root" || -z "$target_alias" || -z "$target_bucket" ||
  -z "$output_manifest" || -z "$work_root" ]]; then
  echo "对象恢复核验缺少必需环境变量。" >&2
  exit 2
fi
if [[ ! -d "$expected_root" || -L "$expected_root" ]]; then
  printf '对象恢复核验源必须是真实目录：%s\n' "$expected_root" >&2
  exit 2
fi
if [[ ! -d "$work_root" || -L "$work_root" ]]; then
  printf '对象恢复核验工作区必须是真实目录：%s\n' "$work_root" >&2
  exit 2
fi
case "$target_alias" in
  *[!A-Za-z0-9._-]* | "")
    echo "对象恢复核验 alias 格式无效。" >&2
    exit 2
    ;;
esac
case "$target_bucket" in
  *[!A-Za-z0-9._-]* | "")
    echo "对象恢复核验桶名格式无效。" >&2
    exit 2
    ;;
esac
if [[ "$output_manifest" != /* || -e "$output_manifest" || -L "$output_manifest" ]]; then
  echo "对象恢复核验清单必须是尚不存在的绝对路径。" >&2
  exit 2
fi

object_list="$work_root/.restored-object-list.$$"
target_bytes_file="$work_root/.restored-object-bytes.$$"
target_sha256_file="$work_root/.restored-object-sha256.$$"
manifest_partial="$output_manifest.partial"
for residue in "$object_list" "$target_bytes_file" "$target_sha256_file" "$manifest_partial"; do
  if [[ -e "$residue" || -L "$residue" ]]; then
    printf '对象恢复核验存在未解释残留：%s\n' "$residue" >&2
    exit 4
  fi
done

cleanup() {
  rm -f "$object_list" "$target_bytes_file" "$target_sha256_file" "$manifest_partial"
}
trap cleanup EXIT HUP INT TERM

LC_ALL=C find "$expected_root" -type f -print0 | LC_ALL=C sort -z >"$object_list"
: >"$manifest_partial"

while IFS= read -r -d '' source_file; do
  relative_path=${source_file#"$expected_root"/}
  if [[ "$relative_path" == "$source_file" || -z "$relative_path" ]]; then
    printf '无法派生对象相对路径：%s\n' "$source_file" >&2
    exit 4
  fi
  expected_bytes=$(wc -c <"$source_file" | tr -d '[:space:]')
  expected_sha256=$(sha256sum "$source_file" | awk '{print $1}')
  if [[ ! "$expected_bytes" =~ ^[0-9]+$ || ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    printf '无法计算对象源证据：%s\n' "$relative_path" >&2
    exit 4
  fi

  if ! mc cat "$target_alias/$target_bucket/$relative_path" |
    tee >(wc -c >"$target_bytes_file") | sha256sum >"$target_sha256_file"; then
    printf '目标桶缺少或无法读取对象：%s\n' "$relative_path" >&2
    exit 5
  fi
  actual_bytes=$(tr -d '[:space:]' <"$target_bytes_file")
  actual_sha256=$(awk '{print $1}' "$target_sha256_file")
  rm -f "$target_bytes_file" "$target_sha256_file"
  if [[ "$actual_bytes" != "$expected_bytes" || "$actual_sha256" != "$expected_sha256" ]]; then
    printf '恢复对象字节不一致：path=%s expectedBytes=%s actualBytes=%s expectedSha256=%s actualSha256=%s\n' \
      "$relative_path" "$expected_bytes" "$actual_bytes" \
      "$expected_sha256" "$actual_sha256" >&2
    exit 5
  fi
  jq -cn \
    --arg path "$relative_path" \
    --argjson size_bytes "$expected_bytes" \
    --arg sha256 "$expected_sha256" \
    '{path: $path, sizeBytes: $size_bytes, sha256: $sha256}' >>"$manifest_partial"
done <"$object_list"

target_count=$(mc ls --recursive --json "$target_alias/$target_bucket" |
  jq -s '[.[] | select(.type == "file")] | length')
expected_count=$(wc -l <"$manifest_partial" | tr -d '[:space:]')
if [[ ! "$target_count" =~ ^[0-9]+$ || "$target_count" != "$expected_count" ]]; then
  printf '恢复目标桶路径集合不一致：expected=%s actual=%s\n' \
    "$expected_count" "${target_count:-invalid}" >&2
  exit 5
fi

mv "$manifest_partial" "$output_manifest"
trap - EXIT HUP INT TERM
rm -f "$object_list" "$target_bytes_file" "$target_sha256_file"
object_bytes=$(jq -s 'map(.sizeBytes) | add // 0' "$output_manifest")
printf '恢复对象逐项核验通过：count=%s bytes=%s manifest=%s\n' \
  "$expected_count" "$object_bytes" "$output_manifest"
