#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env
backup_dir=${BACKUP_DIR:-$ROOT_DIR/backups}
identity_file=${BACKUP_AGE_IDENTITY_FILE:-}

if [[ ! -d "$backup_dir" ]]; then
  printf '备份目录不存在：%s\n' "$backup_dir" >&2
  exit 3
fi

latest=""
while IFS= read -r -d '' candidate; do
  if [[ -z "$latest" || "$candidate" -nt "$latest" ]]; then
    latest=$candidate
  fi
done < <(find "$backup_dir" -maxdepth 1 -type f \( -name 'fiatlux-*.tar.gz.age' -o -name 'fiatlux-*.tar.gz' \) -print0)
if [[ -z "$latest" ]]; then
  printf '未在 %s 找到可演练备份。\n' "$backup_dir" >&2
  exit 3
fi

args=(--file "$latest")
if [[ "$latest" == *.age ]]; then
  if [[ -z "$identity_file" ]]; then
    echo "加密备份演练要求设置 BACKUP_AGE_IDENTITY_FILE。" >&2
    exit 2
  fi
  args+=(--identity "$identity_file")
fi

exec "$ROOT_DIR/scripts/restore-drill.sh" "${args[@]}"
