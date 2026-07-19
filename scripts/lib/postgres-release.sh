#!/usr/bin/env bash

POSTGRES_MINOR_ROLLBACK_CONFIRMATION=POSTGRES-MINOR-ROLLBACK-REVIEWED

postgres_parse_binary_version() {
  local raw=${1:-}
  if [[ "$raw" =~ ([0-9]+)\.([0-9]+) ]]; then
    printf '%s\t%s\t%s.%s\n' \
      "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" \
      "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  printf '无法从 PostgreSQL 版本输出解析 major/minor：%s\n' "$raw" >&2
  return 2
}

postgres_release_binary_version() {
  local compose=$1
  local version=$2
  FIATLUX_VERSION_OVERRIDE=$version "$compose" run --rm --no-deps --pull never \
    --entrypoint postgres postgres --version
}

postgres_current_binary_version() {
  local compose=$1
  local current_release=${2:-}
  local output

  if output=$("$compose" exec -T postgres postgres --version 2>/dev/null); then
    printf '%s\n' "$output"
    return 0
  fi
  if [[ ! "$current_release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "无法从运行容器读取 PostgreSQL 版本，且当前发布版本无效。" >&2
    return 2
  fi
  postgres_release_binary_version "$compose" "$current_release"
}

postgres_assert_release_transition() {
  local operation=$1
  local current_output=$2
  local target_output=$3
  local minor_rollback_confirmation=${4:-}
  local current_major current_minor current_version
  local target_major target_minor target_version

  IFS=$'\t' read -r current_major current_minor current_version \
    < <(postgres_parse_binary_version "$current_output")
  IFS=$'\t' read -r target_major target_minor target_version \
    < <(postgres_parse_binary_version "$target_output")
  if [[ -z "$current_major" || -z "$target_major" ]]; then
    echo "PostgreSQL 版本解析失败，拒绝发布转换。" >&2
    return 2
  fi
  if [[ "$current_major" != "$target_major" ]]; then
    printf '常规 %s 禁止 PostgreSQL major 变化：current=%s target=%s；必须使用单独受审的数据迁移方案。\n' \
      "$operation" "$current_version" "$target_version" >&2
    return 3
  fi

  case "$operation" in
    upgrade)
      if ((10#$target_minor < 10#$current_minor)); then
        printf '常规升级禁止 PostgreSQL minor 回退：current=%s target=%s。\n' \
          "$current_version" "$target_version" >&2
        return 3
      fi
      ;;
    rollback | restore)
      if ((10#$target_minor < 10#$current_minor)); then
        if [[ "$minor_rollback_confirmation" != "$POSTGRES_MINOR_ROLLBACK_CONFIRMATION" ]]; then
          printf '%s 会把 PostgreSQL minor 从 %s 回退到 %s；须先完成外部兼容性复核，并显式传入 --confirm-postgres-minor-rollback %s。\n' \
            "$operation" "$current_version" "$target_version" \
            "$POSTGRES_MINOR_ROLLBACK_CONFIRMATION" >&2
          return 3
        fi
        echo "已收到 PostgreSQL minor 回退兼容复核确认；该 token 只解锁脚本，不替代外部审批记录。"
      fi
      ;;
    *)
      printf '未知 PostgreSQL 发布转换：%s。\n' "$operation" >&2
      return 2
      ;;
  esac

  printf 'PostgreSQL 二进制兼容门禁通过：operation=%s current=%s target=%s。\n' \
    "$operation" "$current_version" "$target_version"
}
