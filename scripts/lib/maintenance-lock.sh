#!/usr/bin/env bash

maintenance_lock_acquire() {
  local requested_root=${1:?maintenance lock root required}
  local operation=${2:?maintenance lock operation required}
  local existing_token
  local host

  if [[ ! "$operation" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "维护锁操作名格式无效。" >&2
    return 2
  fi
  if [[ "${FIATLUX_ENV:-development}" == production && -z "${FIATLUX_MAINTENANCE_DIR:-}" ]]; then
    echo "生产维护操作要求显式设置稳定的 FIATLUX_MAINTENANCE_DIR。" >&2
    return 2
  fi
  requested_root=${FIATLUX_MAINTENANCE_DIR:-$requested_root}
  mkdir -p "$requested_root"
  chmod 700 "$requested_root"
  FIATLUX_MAINTENANCE_ROOT=$(cd "$requested_root" && pwd -P)
  FIATLUX_MAINTENANCE_LOCK_DIR="$FIATLUX_MAINTENANCE_ROOT/.fiatlux-maintenance.lock"
  FIATLUX_MAINTENANCE_LOCK_OWNED=false
  export FIATLUX_MAINTENANCE_ROOT FIATLUX_MAINTENANCE_LOCK_DIR

  if [[ -n "${FIATLUX_MAINTENANCE_LOCK_TOKEN:-}" ]]; then
    if [[ ! "$FIATLUX_MAINTENANCE_LOCK_TOKEN" =~ ^[A-Za-z0-9._:-]+$ ]] ||
      [[ ! -f "$FIATLUX_MAINTENANCE_LOCK_DIR/owner" ]]; then
      echo "维护锁继承标记无效或锁已消失，拒绝继续。" >&2
      return 4
    fi
    existing_token=$(awk -F= '$1 == "token" {print substr($0, 7); exit}' \
      "$FIATLUX_MAINTENANCE_LOCK_DIR/owner")
    if [[ "$existing_token" != "$FIATLUX_MAINTENANCE_LOCK_TOKEN" ]]; then
      echo "维护锁继承标记与 owner 不一致，拒绝继续。" >&2
      return 4
    fi
    return 0
  fi

  if ! mkdir -m 700 "$FIATLUX_MAINTENANCE_LOCK_DIR" 2>/dev/null; then
    echo "已有维护操作或陈旧锁，拒绝并发运行：$FIATLUX_MAINTENANCE_LOCK_DIR" >&2
    echo "不得自动删除；先核对 owner、进程、服务状态和明文/partial 残留。" >&2
    return 4
  fi
  host=$(hostname 2>/dev/null || printf unknown)
  FIATLUX_MAINTENANCE_LOCK_TOKEN="${operation}:$$:$(date -u +%s):${RANDOM:-0}"
  printf 'token=%s\noperation=%s\npid=%s\nhost=%s\nstartedAt=%s\n' \
    "$FIATLUX_MAINTENANCE_LOCK_TOKEN" "$operation" "$$" "$host" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$FIATLUX_MAINTENANCE_LOCK_DIR/owner"
  chmod 600 "$FIATLUX_MAINTENANCE_LOCK_DIR/owner"
  FIATLUX_MAINTENANCE_LOCK_OWNED=true
  export FIATLUX_MAINTENANCE_LOCK_TOKEN FIATLUX_MAINTENANCE_LOCK_OWNED
}

maintenance_lock_release() {
  if [[ "${FIATLUX_MAINTENANCE_LOCK_OWNED:-false}" != true ]]; then
    return 0
  fi
  rm -f "$FIATLUX_MAINTENANCE_LOCK_DIR/owner"
  if ! rmdir "$FIATLUX_MAINTENANCE_LOCK_DIR"; then
    echo "无法释放维护锁，需要人工检查：$FIATLUX_MAINTENANCE_LOCK_DIR" >&2
    return 7
  fi
  FIATLUX_MAINTENANCE_LOCK_OWNED=false
  unset FIATLUX_MAINTENANCE_LOCK_TOKEN
  export FIATLUX_MAINTENANCE_LOCK_OWNED
}
