#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
backup_dir=${BACKUP_DIR:-$ROOT_DIR/backups}
identity_file=${BACKUP_AGE_IDENTITY_FILE:-}
expected_sha256=${BACKUP_EXPECTED_SHA256:-}
approved_manifest_dir=${BACKUP_APPROVED_MANIFEST_DIR:-}
expected_backup_tool_release=${RESTORE_EXPECTED_BACKUP_TOOL_RELEASE:-}
attestation_file=${BACKUP_ATTESTATION_FILE:-}
signature_file=${BACKUP_SIGNATURE_FILE:-}
signing_public_key_file=${BACKUP_SIGNING_PUBLIC_KEY_FILE:-}
expected_signing_key_sha256=${BACKUP_SIGNING_PUBLIC_KEY_SHA256:-}

path_mode() {
  local mode
  mode=$(stat -c '%a' "$1" 2>/dev/null || true)
  if [[ -n "$mode" ]]; then
    printf '%s\n' "$mode"
  else
    stat -f '%Lp' "$1"
  fi
}

path_uid() {
  local uid
  uid=$(stat -c '%u' "$1" 2>/dev/null || true)
  if [[ -n "$uid" ]]; then
    printf '%s\n' "$uid"
  else
    stat -f '%u' "$1"
  fi
}

assert_approval_path_trusted() {
  local candidate=$1
  local current=$candidate
  local mode owner_uid numeric_mode parent

  while :; do
    if [[ ! -e "$current" || -L "$current" ]]; then
      printf '批准清单信任路径缺失或包含符号链接：%s\n' "$current" >&2
      return 4
    fi
    mode=$(path_mode "$current")
    owner_uid=$(path_uid "$current")
    if [[ ! "$mode" =~ ^[0-7]{3,4}$ || ! "$owner_uid" =~ ^[0-9]+$ ]]; then
      printf '无法验证批准清单信任路径的所有者或权限：%s\n' "$current" >&2
      return 4
    fi
    numeric_mode=$((8#$mode))
    if ((numeric_mode & 8#022)); then
      printf '批准清单信任路径不得由 group/other 写入：%s（mode=%s）\n' \
        "$current" "$mode" >&2
      return 4
    fi
    if ((EUID == 0)); then
      if ((owner_uid != 0)); then
        printf 'root 执行时批准清单信任路径必须由 root 所有：%s（uid=%s）\n' \
          "$current" "$owner_uid" >&2
        return 4
      fi
    elif ((owner_uid == EUID)) || [[ -w "$current" ]]; then
      printf '批准清单信任路径可由当前部署用户篡改：%s\n' "$current" >&2
      return 4
    fi

    parent=$(dirname "$current")
    [[ "$parent" == "$current" ]] && break
    current=$parent
  done
}

if [[ ! -d "$backup_dir" ]]; then
  printf '备份目录不存在：%s\n' "$backup_dir" >&2
  exit 3
fi

latest=""
while IFS= read -r -d '' candidate; do
  case "$candidate" in
    *.config.tar.gz | *.config.tar.gz.age) continue ;;
  esac
  if [[ -z "$latest" || "$candidate" -nt "$latest" ]]; then
    latest=$candidate
  fi
done < <(find "$backup_dir" -maxdepth 1 -type f \( -name 'fiatlux-*.tar.gz.age' -o -name 'fiatlux-*.tar.gz' \) -print0)
if [[ -z "$latest" ]]; then
  printf '未在 %s 找到可演练备份。\n' "$backup_dir" >&2
  exit 3
fi

args=(--file "$latest")
backup_basename=$(basename "$latest")
attestation_file=${attestation_file:-$latest.attestation.json}
signature_file=${signature_file:-$latest.attestation.sig}
if [[ ! -f "$attestation_file" || -L "$attestation_file" ||
  ! -f "$signature_file" || -L "$signature_file" ]]; then
  echo "最新备份演练要求归档对应的签名 attestation 与 Ed25519 签名。" >&2
  exit 3
fi
if [[ -z "$signing_public_key_file" || ! -f "$signing_public_key_file" ||
  -L "$signing_public_key_file" ||
  ! "$expected_signing_key_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "最新备份演练要求 BACKUP_SIGNING_PUBLIC_KEY_FILE 和独立批准的 BACKUP_SIGNING_PUBLIC_KEY_SHA256。" >&2
  exit 2
fi
args+=(
  --attestation "$attestation_file"
  --signature "$signature_file"
  --signing-public-key "$signing_public_key_file"
  --expected-signing-key-sha256 "$expected_signing_key_sha256"
)
if [[ -z "$expected_sha256" ]]; then
  if [[ -z "$approved_manifest_dir" || ! -d "$approved_manifest_dir" ]]; then
    echo "最新备份演练要求 BACKUP_EXPECTED_SHA256 或 BACKUP_APPROVED_MANIFEST_DIR。" >&2
    exit 2
  fi
  if [[ -L "$approved_manifest_dir" ]]; then
    echo "批准清单目录不得是符号链接。" >&2
    exit 3
  fi
  approved_manifest_dir=$(cd "$approved_manifest_dir" && pwd -P)
  backup_dir_canonical=$(cd "$backup_dir" && pwd -P)
  if [[ "$approved_manifest_dir" == "$backup_dir_canonical" ||
    "$approved_manifest_dir" == "$backup_dir_canonical/"* ]]; then
    echo "批准清单目录不得等于或位于可写备份目录树中。" >&2
    exit 2
  fi
  approved_manifest="$approved_manifest_dir/$backup_basename.sha256"
  if [[ ! -f "$approved_manifest" || -L "$approved_manifest" ]]; then
    printf '找不到独立受审清单：%s\n' "$approved_manifest" >&2
    exit 3
  fi
  assert_approval_path_trusted "$approved_manifest"
  approved_manifest_size=$(wc -c <"$approved_manifest" | tr -d '[:space:]')
  if [[ ! "$approved_manifest_size" =~ ^[0-9]+$ ]] || ((approved_manifest_size > 256)); then
    echo "独立受审清单大小无效。" >&2
    exit 3
  fi
  manifest_line=$(<"$approved_manifest")
  if [[ ! "$manifest_line" =~ ^([0-9a-f]{64})[[:space:]]{2}([A-Za-z0-9._-]+)$ ]] || \
    [[ "${BASH_REMATCH[2]}" != "$backup_basename" ]]; then
    echo "独立受审清单格式或文件名不匹配。" >&2
    exit 3
  fi
  expected_sha256=${BASH_REMATCH[1]}
fi
if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "批准的备份 SHA-256 格式无效。" >&2
  exit 2
fi
args+=(--expected-sha256 "$expected_sha256")
if [[ ! "$expected_backup_tool_release" =~ ^[A-Za-z0-9._-]+$ ]] ||
  ((${#expected_backup_tool_release} > 128)); then
  echo "最新备份演练要求设置受审的 RESTORE_EXPECTED_BACKUP_TOOL_RELEASE。" >&2
  exit 2
fi
args+=(--expected-backup-tool-release "$expected_backup_tool_release")
if [[ "$latest" == *.age ]]; then
  if [[ -z "$identity_file" ]]; then
    echo "加密备份演练要求设置 BACKUP_AGE_IDENTITY_FILE。" >&2
    exit 2
  fi
  args+=(--identity "$identity_file")
fi

exec "$ROOT_DIR/scripts/restore-drill.sh" "${args[@]}"
