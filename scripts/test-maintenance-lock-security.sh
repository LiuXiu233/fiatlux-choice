#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
workspace=$(mktemp -d)
first_pid=""
cleanup() {
  if [[ -n "$first_pid" ]] && kill -0 "$first_pid" 2>/dev/null; then
    kill -TERM "$first_pid" 2>/dev/null || true
    wait "$first_pid" 2>/dev/null || true
  fi
  rm -rf "$workspace"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$workspace/backups" "$workspace/external-archive-dir" \
  "$workspace/backup-scratch" "$workspace/maintenance"
chmod 700 "$workspace/backups" "$workspace/external-archive-dir" \
  "$workspace/backup-scratch" "$workspace/maintenance"
compose_log="$workspace/compose.log"
fake_compose="$workspace/compose"
cat >"$fake_compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${LOCK_TEST_COMPOSE_LOG:?}"
case "${1:-}" in
  ps)
    if [[ "$*" == *'--status running --services'* ]]; then
      for service in ${LOCK_TEST_RUNNING_SERVICES:-postgres minio caddy api worker}; do
        printf '%s\n' "$service"
      done
    else
      for service in "$@"; do :; done
      if [[ "$service" == api && -e "${LOCK_TEST_REPLACED:-/nonexistent}" ]]; then
        printf 'replacement-api\n'
      else
        printf 'container-%s\n' "$service"
      fi
    fi
    ;;
  stop | up)
    ;;
  run)
    if [[ "$*" == *'backup-tools backup-container'* ]]; then
      : >"${LOCK_TEST_STARTED:?}"
      if [[ "${LOCK_TEST_TRIGGER_REPLACEMENT:-false}" == true ]]; then
        : >"${LOCK_TEST_REPLACED:?}"
      fi
      while [[ ! -e "${LOCK_TEST_RELEASE:?}" ]]; do
        sleep 0.05
      done
      if [[ "${LOCK_TEST_BACKUP_FAIL:-false}" == true ]]; then
        exit 23
      fi
    fi
    ;;
  *) exit 9 ;;
esac
EOF
chmod 0755 "$fake_compose"

export FIATLUX_ENV=development
export FIATLUX_COMPOSE_SCRIPT=$fake_compose
export BACKUP_DIR=$workspace/backups
export BACKUP_SCRATCH_DIR=$workspace/backup-scratch
export FIATLUX_MAINTENANCE_DIR=$workspace/maintenance
export BACKUP_SOURCE_ID=fiatlux-lock-test
export LOCK_TEST_COMPOSE_LOG=$compose_log
export LOCK_TEST_STARTED=$workspace/started
export LOCK_TEST_RELEASE=$workspace/release
export LOCK_TEST_REPLACED=$workspace/replaced

"$ROOT_DIR/scripts/backup.sh" --name first --quiesce >"$workspace/first.log" 2>&1 &
first_pid=$!
for _ in {1..200}; do
  [[ -e "$LOCK_TEST_STARTED" ]] && break
  sleep 0.05
done
if [[ ! -e "$LOCK_TEST_STARTED" ]]; then
  echo "第一个备份未进入受锁保护的容器阶段。" >&2
  exit 1
fi

set +e
BACKUP_DIR=$workspace/external-archive-dir \
  "$ROOT_DIR/scripts/backup.sh" --name second --quiesce >"$workspace/second.log" 2>&1
second_exit=$?
set -e
if ((second_exit != 4)); then
  printf '并发备份未被维护锁拒绝：exit=%d\n' "$second_exit" >&2
  exit 1
fi
if grep -q '^up ' "$compose_log"; then
  echo "并发拒绝期间提前恢复了写服务。" >&2
  exit 1
fi

: >"$LOCK_TEST_RELEASE"
wait "$first_pid"
first_pid=""
if [[ -e "$workspace/maintenance/.fiatlux-maintenance.lock" ]]; then
  echo "正常备份后维护锁未释放。" >&2
  exit 1
fi

: >"$compose_log"
set +e
LOCK_TEST_TRIGGER_REPLACEMENT=true \
  "$ROOT_DIR/scripts/backup.sh" --name replaced-container --quiesce \
  >"$workspace/replaced-container.log" 2>&1
replacement_exit=$?
set -e
if ((replacement_exit != 6)); then
  printf '备份期间容器被替换未失败关闭：exit=%d\n' "$replacement_exit" >&2
  exit 1
fi
if grep -q '^up ' "$compose_log"; then
  echo "容器已被替换时仍尝试启动服务。" >&2
  exit 1
fi
rm "$LOCK_TEST_REPLACED"

: >"$compose_log"
LOCK_TEST_RUNNING_SERVICES="postgres minio api" \
  "$ROOT_DIR/scripts/backup.sh" --name api-only-success --quiesce \
  >"$workspace/api-only-success.log" 2>&1
if ! grep -Fx 'stop api' "$compose_log" >/dev/null ||
  ! grep -Fx 'up -d --wait --no-deps --no-recreate --no-build --pull never api' \
    "$compose_log" >/dev/null; then
  echo "仅 api 运行时未精确暂停/恢复原集合。" >&2
  exit 1
fi
if grep -E '^(stop|up ).*(caddy|worker|web|postgres|minio)' "$compose_log" >/dev/null; then
  echo "仅 api 运行时意外操作了其他服务。" >&2
  exit 1
fi

: >"$compose_log"
set +e
LOCK_TEST_RUNNING_SERVICES="postgres minio api" LOCK_TEST_BACKUP_FAIL=true \
  "$ROOT_DIR/scripts/backup.sh" --name api-only-failure --quiesce \
  >"$workspace/api-only-failure.log" 2>&1
api_failure_exit=$?
set -e
if ((api_failure_exit != 23)); then
  printf 'backup-tools 失败退出码未保留：%d\n' "$api_failure_exit" >&2
  exit 1
fi
if ! grep -Fx 'stop api' "$compose_log" >/dev/null ||
  ! grep -Fx 'up -d --wait --no-deps --no-recreate --no-build --pull never api' \
    "$compose_log" >/dev/null; then
  echo "backup-tools 失败后未精确恢复仅 api 集合。" >&2
  exit 1
fi
if grep -E '^(stop|up ).*(caddy|worker|web|postgres|minio)' "$compose_log" >/dev/null; then
  echo "backup-tools 失败后意外操作了其他服务。" >&2
  exit 1
fi

mkdir -m 700 "$workspace/maintenance/.fiatlux-maintenance.lock"
printf 'token=stale:1:1:1\noperation=stale\n' \
  >"$workspace/maintenance/.fiatlux-maintenance.lock/owner"
set +e
"$ROOT_DIR/scripts/backup.sh" --name stale-lock >"$workspace/stale-lock.log" 2>&1
stale_lock_exit=$?
set -e
if ((stale_lock_exit != 4)); then
  echo "陈旧维护锁未失败关闭。" >&2
  exit 1
fi
rm "$workspace/maintenance/.fiatlux-maintenance.lock/owner"
rmdir "$workspace/maintenance/.fiatlux-maintenance.lock"

: >"$workspace/backups/crashed.tar.gz.age.partial"
set +e
"$ROOT_DIR/scripts/backup.sh" --name stale-partial >"$workspace/stale-partial.log" 2>&1
stale_partial_exit=$?
set -e
if ((stale_partial_exit != 5)); then
  echo "陈旧 partial 未失败关闭。" >&2
  exit 1
fi

printf '维护锁测试通过：concurrent=%d replaced=%d backupFailure=%d staleLock=%d stalePartial=%d；成功/失败均只恢复原 api 容器。\n' \
  "$second_exit" "$replacement_exit" "$api_failure_exit" "$stale_lock_exit" "$stale_partial_exit"
