#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
IMAGE=${BACKUP_SECURITY_TEST_IMAGE:-fiatlux-backup-security:test}
mkdir -p "$ROOT_DIR/tmp"
workspace=$(mktemp -d "$ROOT_DIR/tmp/backup-security.XXXXXX")
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT HUP INT TERM

if [[ "${BACKUP_SECURITY_TEST_SKIP_BUILD:-0}" != 1 ]]; then
  docker build --quiet --file "$ROOT_DIR/Dockerfile.backup" --tag "$IMAGE" "$ROOT_DIR" >/dev/null
fi

mkdir -p "$workspace/fakebin" "$workspace/backups" "$workspace/backup-work" "$workspace/restore-work"
chmod 0700 "$workspace/backups" "$workspace/backup-work" "$workspace/restore-work"
cat >"$workspace/fakebin/pg_dump" <<'EOF'
#!/bin/sh
set -eu
case " $* " in
  *" --version "*)
    echo "pg_dump (PostgreSQL) security-test"
    exit 0
    ;;
esac
output=""
for argument in "$@"; do
  case "$argument" in
    --file=*) output=${argument#--file=} ;;
  esac
done
[ -n "$output" ] || { echo "fake pg_dump did not receive --file" >&2; exit 9; }
printf 'FIAT LUX test database dump\n' >"$output"
EOF

cat >"$workspace/fakebin/mc" <<'EOF'
#!/bin/sh
set -eu
case "${1:-}" in
  --version)
    echo "mc version SECURITY.TEST"
    ;;
  alias | stat)
    ;;
  mirror)
    target=${3:?target required}
    mkdir -p "$target/nested"
    printf 'FIAT LUX test object\n' >"$target/nested/object.bin"
    ;;
  cp)
    cp "${2:?source required}" /work/fake-s3-object
    ;;
  cat)
    cat /work/fake-s3-object
    ;;
  rm)
    rm -f /work/fake-s3-object
    ;;
  *)
    echo "unexpected fake mc command: ${1:-}" >&2
    exit 9
    ;;
esac
EOF

cat >"$workspace/fakebin/pg_restore" <<'EOF'
#!/bin/sh
set -eu
case " $* " in
  *" --list "*) exit 0 ;;
esac
: >/work/destructive-called
exit 9
EOF

cat >"$workspace/fakebin/psql" <<'EOF'
#!/bin/sh
set -eu
case " $* " in
  *"rolcreatedb"*) printf 't|t|t\n' ;;
  *"SET ROLE fiatlux_migrator"*) printf 'fiatlux_migrator\n' ;;
  *)
    : >/work/destructive-called
    exit 9
    ;;
esac
EOF

for command in dropdb createdb; do
  cat >"$workspace/fakebin/$command" <<'EOF'
#!/bin/sh
set -eu
: >/work/destructive-called
exit 9
EOF
done

cat >"$workspace/fakebin/age" <<'EOF'
#!/bin/sh
set -eu
if [ "${FAKE_AGE_INTERRUPT:-false}" = true ]; then
  : > /work/interrupt-started
  kill -TERM "$PPID"
  exit 143
fi
exec /usr/bin/age "$@"
EOF
chmod 0700 "$workspace/fakebin/pg_dump" "$workspace/fakebin/mc" "$workspace/fakebin/age" \
  "$workspace/fakebin/pg_restore" "$workspace/fakebin/psql" \
  "$workspace/fakebin/dropdb" "$workspace/fakebin/createdb"

uid=$(id -u)
gid=$(id -g)
docker run --rm --user "$uid:$gid" \
  --volume "$workspace:/work" \
  --entrypoint /usr/bin/age-keygen \
  "$IMAGE" -o /work/identity.txt >/dev/null 2>&1
recipient=$(docker run --rm --user "$uid:$gid" \
  --volume "$workspace:/work:ro" \
  --entrypoint /usr/bin/age-keygen \
  "$IMAGE" -y /work/identity.txt)

run_backup() {
  local name=$1
  local age_recipient=$2
  local interrupt=${3:-false}
  docker run --rm --user "$uid:$gid" \
    --volume "$workspace:/work" \
    --volume "$workspace/backups:/backups" \
    --volume "$workspace/backup-work:/backup-work" \
    --env PATH=/work/fakebin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    --env PGHOST=test --env PGDATABASE=fiatlux --env PGUSER=backup --env PGPASSWORD=test \
    --env S3_ENDPOINT=http://test --env S3_BUCKET=fiatlux \
    --env S3_ACCESS_KEY_ID=test --env S3_SECRET_ACCESS_KEY=test \
    --env "BACKUP_NAME=$name" \
    --env BACKUP_SOURCE_ID=fiatlux-security-test \
    --env BACKUP_TOOL_RELEASE=v9.8.7-test \
    --env "BACKUP_AGE_RECIPIENT=$age_recipient" \
    --env BACKUP_REQUIRE_ENCRYPTION=true \
    --env "FAKE_AGE_INTERRUPT=$interrupt" \
    --entrypoint /usr/local/bin/backup-container \
    "$IMAGE"
}

assert_no_residue() {
  local name=$1
  local candidate
  for candidate in \
    "$workspace/backups/.$name.partial" \
    "$workspace/backups/.$name.tar.gz.partial" \
    "$workspace/backups/$name.tar.gz.age.partial" \
    "$workspace/backups/$name.tar.gz.age.sha256.partial"; do
    if [[ -e "$candidate" || -L "$candidate" ]]; then
      printf '发现备份残留：%s\n' "$candidate" >&2
      exit 1
    fi
  done
  if find "$workspace/backup-work" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "备份明文工作区存在残留。" >&2
    exit 1
  fi
}

run_backup success "$recipient" >/dev/null
assert_no_residue success
[[ -f "$workspace/backups/success.tar.gz.age" ]]
[[ -f "$workspace/backups/success.tar.gz.age.sha256" ]]
[[ ! -e "$workspace/backups/success.tar.gz" ]]
(
  cd "$workspace/backups"
  sha256sum --check success.tar.gz.age.sha256 >/dev/null
)
docker run --rm --user "$uid:$gid" \
  --volume "$workspace:/work" \
  --volume "$workspace/backups:/backups:ro" \
  --entrypoint /usr/bin/age \
  "$IMAGE" --decrypt --identity /work/identity.txt \
  --output /work/decrypted.tar.gz /backups/success.tar.gz.age
tar -tzf "$workspace/decrypted.tar.gz" | grep -qx './manifest.sha256'
tar -tzf "$workspace/decrypted.tar.gz" | grep -qx './database.dump'
tar -tzf "$workspace/decrypted.tar.gz" | grep -qx './objects/nested/object.bin'
tar -xOzf "$workspace/decrypted.tar.gz" ./metadata.json |
  jq -e '
    .formatVersion == "2" and
    .sourceId == "fiatlux-security-test" and
    .backupName == "success" and
    .database == "fiatlux" and
    .bucket == "fiatlux" and
    .tools.backupRelease == "v9.8.7-test"
  ' >/dev/null

set +e
run_backup failure not-an-age-recipient >/dev/null 2>&1
failure_exit=$?
set -e
if ((failure_exit == 0)); then
  echo "无效 age recipient 未使备份失败。" >&2
  exit 1
fi
assert_no_residue failure
[[ ! -e "$workspace/backups/failure.tar.gz.age" ]]
[[ ! -e "$workspace/backups/failure.tar.gz.age.sha256" ]]

set +e
run_backup interrupted "$recipient" true >/dev/null 2>&1
interrupt_exit=$?
set -e
if ((interrupt_exit == 0)); then
  echo "中断场景未使备份失败。" >&2
  exit 1
fi
[[ -f "$workspace/interrupt-started" ]]
assert_no_residue interrupted
[[ ! -e "$workspace/backups/interrupted.tar.gz.age" ]]
[[ ! -e "$workspace/backups/interrupted.tar.gz.age.sha256" ]]

make_metadata_archive() {
  local name=$1
  local filter=$2
  local payload="$workspace/$name-payload"
  mkdir -p "$payload"
  tar -xzf "$workspace/decrypted.tar.gz" -C "$payload"
  jq --arg name "$name" "$filter | .backupName = \$name" \
    "$payload/metadata.json" >"$payload/metadata.json.next"
  mv "$payload/metadata.json.next" "$payload/metadata.json"
  (
    cd "$payload"
    find . -type f ! -path ./manifest.sha256 -print0 | sort -z | xargs -0 sha256sum >manifest.sha256
  )
  tar -C "$payload" -czf "$workspace/backups/$name.tar.gz" .
}

assert_metadata_rejected() {
  local name=$1
  local digest
  local output
  local restore_exit
  digest=$(sha256sum "$workspace/backups/$name.tar.gz" | awk '{print $1}')
  set +e
  output=$(docker run --rm --user "$uid:$gid" \
    --volume "$workspace/backups:/restore-source:ro" \
    --volume "$workspace/restore-work:/restore-work" \
    --env "BACKUP_FILE=/restore-source/$name.tar.gz" \
    --env "BACKUP_EXPECTED_SHA256=$digest" \
    --env RESTORE_EXPECTED_SOURCE_ID=fiatlux-security-test \
    --env RESTORE_EXPECTED_SOURCE_DATABASE=fiatlux \
    --env RESTORE_EXPECTED_SOURCE_BUCKET=fiatlux \
    --env RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=v9.8.7-test \
    --env RESTORE_TOOL_RELEASE=v9.8.7-test \
    --env PGHOST=unreachable --env PGDATABASE=fiatlux --env PGUSER=restore --env PGPASSWORD=test \
    --env S3_ENDPOINT=http://unreachable --env S3_BUCKET=fiatlux \
    --env S3_ACCESS_KEY_ID=restore --env S3_SECRET_ACCESS_KEY=test \
    --env RESTORE_CONFIRM_DATABASE=fiatlux --env RESTORE_CONFIRM_BUCKET=fiatlux \
    --env RESTORE_APPROVED=YES-I-UNDERSTAND \
    --entrypoint /usr/local/bin/restore-container \
    "$IMAGE" 2>&1)
  restore_exit=$?
  set -e
  if ((restore_exit != 4)) || [[ "$output" != *"metadata.json 的格式版本或受审来源不匹配"* ]]; then
    printf 'metadata 负向测试失败：name=%s exit=%d output=%s\n' \
      "$name" "$restore_exit" "$output" >&2
    exit 1
  fi
}

make_metadata_archive wrong-source '.sourceId = "unapproved-source"'
assert_metadata_rejected wrong-source
make_metadata_archive legacy-format '.formatVersion = "1" | del(.sourceId)'
assert_metadata_rejected legacy-format
make_metadata_archive future-format '.formatVersion = "3"'
assert_metadata_rejected future-format

large_payload="$workspace/large-capacity-payload"
mkdir -p "$large_payload"
tar -xzf "$workspace/decrypted.tar.gz" -C "$large_payload"
jq '.backupName = "large-capacity"' "$large_payload/metadata.json" >"$large_payload/metadata.json.next"
mv "$large_payload/metadata.json.next" "$large_payload/metadata.json"
dd if=/dev/zero of="$large_payload/objects/large-300m.bin" bs=1048576 count=300 status=none
(
  cd "$large_payload"
  find . -type f ! -path ./manifest.sha256 -print0 | sort -z | xargs -0 sha256sum >manifest.sha256
)
tar -C "$large_payload" -czf "$workspace/backups/large-capacity.tar.gz" .
large_digest=$(sha256sum "$workspace/backups/large-capacity.tar.gz" | awk '{print $1}')

restore_preflight_args=(
  --rm --user "$uid:$gid"
  --volume "$workspace:/work"
  --volume "$workspace/backups:/restore-source:ro"
  --env PATH=/work/fakebin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  --env BACKUP_FILE=/restore-source/large-capacity.tar.gz
  --env "BACKUP_EXPECTED_SHA256=$large_digest"
  --env RESTORE_EXPECTED_SOURCE_ID=fiatlux-security-test
  --env RESTORE_EXPECTED_SOURCE_DATABASE=fiatlux
  --env RESTORE_EXPECTED_SOURCE_BUCKET=fiatlux
  --env RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=v9.8.7-test
  --env RESTORE_TOOL_RELEASE=v9.8.7-test
  --env PGHOST=test --env PGDATABASE=fiatlux --env PGUSER=restore --env PGPASSWORD=test
  --env S3_ENDPOINT=http://test --env S3_BUCKET=fiatlux
  --env S3_ACCESS_KEY_ID=restore --env S3_SECRET_ACCESS_KEY=test
  --env RESTORE_CONFIRM_DATABASE=fiatlux --env RESTORE_CONFIRM_BUCKET=fiatlux
  --env RESTORE_APPROVED=YES-I-UNDERSTAND
  --env RESTORE_PREFLIGHT_ONLY=true
  --entrypoint /usr/local/bin/restore-container
)

docker run "${restore_preflight_args[@]}" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --volume "$workspace/restore-work:/restore-work" \
  "$IMAGE" >/dev/null
[[ ! -e "$workspace/destructive-called" ]]
if find "$workspace/restore-work" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "大归档 preflight 后恢复工作区未清理。" >&2
  exit 1
fi

set +e
capacity_output=$(docker run "${restore_preflight_args[@]}" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --tmpfs /restore-work:rw,nosuid,nodev,noexec,size=128m \
  "$IMAGE" 2>&1)
capacity_exit=$?
set -e
if ((capacity_exit != 4)) || [[ "$capacity_output" != *"恢复工作区容量不足（安全提取）"* ]]; then
  printf '恢复容量负向测试失败：exit=%d output=%s\n' "$capacity_exit" "$capacity_output" >&2
  exit 1
fi
[[ ! -e "$workspace/destructive-called" ]]

# Run restore-latest as an unprivileged deployment operator inside the already-built backup
# image.  The fixture is copied into the container so root can model the documented
# root:fiatlux 0750/0640 approval channel without requiring sudo on the host or CI runner.
approval_fixture="$workspace/approval-fixture"
mkdir -p "$approval_fixture/scripts/lib"
install -m 0755 "$ROOT_DIR/scripts/restore-latest-drill.sh" \
  "$approval_fixture/scripts/restore-latest-drill.sh"
install -m 0644 "$ROOT_DIR/scripts/lib/runtime-env.sh" \
  "$approval_fixture/scripts/lib/runtime-env.sh"
cat >"$approval_fixture/scripts/restore-drill.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'RESTORE_CALLED %s\n' "$*"
EOF
chmod 0755 "$approval_fixture/scripts/restore-drill.sh"
cat >"$approval_fixture/run-approval-tests.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

root=/approval-test
cp -R /fixture-input "$root"
chown -R root:root "$root"
chmod 0755 "$root" "$root/scripts" "$root/scripts/lib"
chmod 0755 "$root/scripts/restore-latest-drill.sh" "$root/scripts/restore-drill.sh"
chmod 0644 "$root/scripts/lib/runtime-env.sh"
adduser -D -H -u 2000 operator >/dev/null

backup_dir="$root/backups"
archive_name=fiatlux-approval-security.tar.gz
archive="$backup_dir/$archive_name"
mkdir -p "$backup_dir"
chmod 0777 "$backup_dir"
printf 'approved archive fixture\n' >"$archive"
chmod 0444 "$archive"
archive_sha=$(sha256sum "$archive" | awk '{print $1}')

make_approval() {
  local directory=$1
  local directory_mode=${2:-0555}
  local file_mode=${3:-0444}
  mkdir -p "$directory"
  printf '%s  %s\n' "$archive_sha" "$archive_name" >"$directory/$archive_name.sha256"
  chown -R root:root "$directory"
  chmod "$directory_mode" "$directory"
  chmod "$file_mode" "$directory/$archive_name.sha256"
}

run_as_operator() {
  local approved_dir=$1
  export BACKUP_DIR="$backup_dir"
  export BACKUP_APPROVED_MANIFEST_DIR="$approved_dir"
  export BACKUP_SOURCE_ID=fiatlux-approval-security
  export RESTORE_EXPECTED_BACKUP_TOOL_RELEASE=finalqa
  unset BACKUP_EXPECTED_SHA256 FIATLUX_ENV_FILE
  su -m -s /bin/bash operator -c "$root/scripts/restore-latest-drill.sh"
}

trusted="$root/trusted/approved"
make_approval "$trusted"
trusted_output=$(run_as_operator "$trusted")
if [[ "$trusted_output" != *RESTORE_CALLED* ]]; then
  printf 'root-owned read-only approval path was not accepted: %s\n' "$trusted_output" >&2
  exit 1
fi

expect_rejected() {
  local label=$1
  local approved_dir=$2
  local output status
  set +e
  output=$(run_as_operator "$approved_dir" 2>&1)
  status=$?
  set -e
  if ((status == 0)) || [[ "$output" == *RESTORE_CALLED* ]]; then
    printf 'untrusted approval path was accepted: %s output=%s\n' "$label" "$output" >&2
    exit 1
  fi
}

child_of_backup="$backup_dir/approved"
make_approval "$child_of_backup"
expect_rejected child-of-writable-backup "$child_of_backup"

writable_approval="$root/writable-approved"
make_approval "$writable_approval" 0777 0444
expect_rejected group-other-writable-directory "$writable_approval"

writable_file="$root/writable-file-approved"
make_approval "$writable_file" 0555 0666
expect_rejected group-other-writable-file "$writable_file"

operator_owned="$root/operator-owned-approved"
make_approval "$operator_owned"
chown -R operator:operator "$operator_owned"
expect_rejected operator-owned-path "$operator_owned"

mutable_parent="$root/mutable-parent"
mutable_parent_approval="$mutable_parent/approved"
make_approval "$mutable_parent_approval"
chown operator:operator "$mutable_parent"
chmod 0555 "$mutable_parent"
expect_rejected operator-owned-ancestor "$mutable_parent_approval"

ln -s "$trusted" "$root/symlink-approved"
expect_rejected symlink-directory "$root/symlink-approved"

echo '批准清单信任路径正/负向测试通过。'
EOF
chmod 0755 "$approval_fixture/run-approval-tests.sh"

docker run --rm --pull never --user 0:0 \
  --volume "$approval_fixture:/fixture-input:ro" \
  --entrypoint /bin/bash \
  "$IMAGE" /fixture-input/run-approval-tests.sh >/dev/null

printf '备份安全测试通过：success=0 failure=%d interrupted=%d；无明文/partial 残留，来源/v1/未来格式拒绝，300MiB scratch 与批准清单信任路径正/负向通过。\n' \
  "$failure_exit" "$interrupt_exit"
