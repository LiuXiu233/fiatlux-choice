#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
POSTGRES_IMAGE='postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4'

stamp=$(date -u +%Y%m%d%H%M%S)
export COMPOSE_PROJECT_NAME=${DB_PRIVILEGE_TEST_PROJECT:-"fiatlux-db-privileges-$stamp-$$"}
if [[ ! "$COMPOSE_PROJECT_NAME" =~ ^fiatlux-db-privileges-[A-Za-z0-9-]+$ ]]; then
  echo "测试项目名必须以 fiatlux-db-privileges- 开头。" >&2
  exit 2
fi

export FIATLUX_ENV=development
unset FIATLUX_ENV_FILE
export IMAGE_PREFIX=${DB_PRIVILEGE_TEST_IMAGE_PREFIX:-fiatlux-db-privilege-test}
export POSTGRES_DB=fiatlux_privileges_qa
export POSTGRES_BOOTSTRAP_USER=fiatlux_bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=$(openssl rand -hex 24)
POSTGRES_MIGRATION_PASSWORD=$(openssl rand -hex 24)
POSTGRES_RUNTIME_PASSWORD=$(openssl rand -hex 24)
POSTGRES_BACKUP_PASSWORD=$(openssl rand -hex 24)
POSTGRES_RESTORE_PASSWORD=$(openssl rand -hex 24)
export POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATION_PASSWORD POSTGRES_RUNTIME_PASSWORD
export POSTGRES_BACKUP_PASSWORD POSTGRES_RESTORE_PASSWORD

network="${COMPOSE_PROJECT_NAME}_backend"
runtime_url="postgresql://fiatlux_runtime:$POSTGRES_RUNTIME_PASSWORD@postgres:5432/$POSTGRES_DB"
bootstrap_url="postgresql://$POSTGRES_BOOTSTRAP_USER:$POSTGRES_BOOTSTRAP_PASSWORD@postgres:5432/$POSTGRES_DB"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$COMPOSE_PROJECT_NAME" == fiatlux-db-privileges-* ]]; then
    "$COMPOSE" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

psql_as() {
  local user=$1
  local password=$2
  local sql=$3
  docker run --rm \
    --network "$network" \
    --env "PGPASSWORD=$password" \
    "$POSTGRES_IMAGE" \
    psql --no-password --set=ON_ERROR_STOP=1 --host postgres --username "$user" \
      --dbname "$POSTGRES_DB" --tuples-only --no-align --command "$sql"
}

expect_value() {
  local label=$1
  local expected=$2
  local actual=$3
  if [[ "$actual" != "$expected" ]]; then
    printf '%s：期望 %q，实际 %q。\n' "$label" "$expected" "$actual" >&2
    exit 4
  fi
  printf 'PASS %s\n' "$label"
}

expect_failure() {
  local label=$1
  local user=$2
  local password=$3
  local sql=$4
  local expected_pattern=$5
  local output status
  set +e
  output=$(psql_as "$user" "$password" "$sql" 2>&1)
  status=$?
  set -e
  if ((status == 0)); then
    printf '%s：操作意外成功。\n' "$label" >&2
    exit 4
  fi
  if ! grep -Eiq "$expected_pattern" <<<"$output"; then
    printf '%s：失败原因不符合预期：%s\n' "$label" "$output" >&2
    exit 4
  fi
  printf 'PASS %s（按预期拒绝）\n' "$label"
}

if [[ "${DB_PRIVILEGE_TEST_SKIP_BUILD:-0}" != 1 ]]; then
  "$COMPOSE" build api postgres
  expect_value "PostgreSQL 发布镜像默认用户" \
    postgres \
    "$(docker image inspect --format '{{.Config.User}}' "$IMAGE_PREFIX-postgres:local")"
  docker run --rm --pull never --entrypoint sh "$IMAGE_PREFIX-postgres:local" -ec '
    test "$(id -un)" = postgres
    test ! -e /usr/local/bin/gosu
    postgres --version | grep -E "^postgres \(PostgreSQL\) 17\."
  '
  echo "PASS PostgreSQL 发布镜像 rootless 入口且不携带 gosu"
fi
if [[ "${DB_PRIVILEGE_TEST_SIMULATE_LEGACY:-0}" == 1 ]]; then
  "$COMPOSE" up -d --wait --no-build --pull never postgres
  "$COMPOSE" run --rm --no-deps --pull never \
    --env "DATABASE_URL=$bootstrap_url" migrate >/dev/null
  "$COMPOSE" run --rm --no-deps --pull never \
    --env "DATABASE_URL=$bootstrap_url" queue-migrate >/dev/null
  echo "已建立旧版单一超级用户持有业务/pg-boss 对象的升级测试前置状态。"
fi
"$ROOT_DIR/scripts/bootstrap-database.sh"

old_bootstrap_password=$POSTGRES_BOOTSTRAP_PASSWORD
POSTGRES_BOOTSTRAP_PASSWORD=$(openssl rand -hex 24)
export POSTGRES_BOOTSTRAP_PASSWORD
export POSTGRES_BOOTSTRAP_CURRENT_PASSWORD=$old_bootstrap_password
"$COMPOSE" run --rm --no-deps --pull never db-bootstrap >/dev/null
unset POSTGRES_BOOTSTRAP_CURRENT_PASSWORD
expect_value "bootstrap 新口令认证" \
  'fiatlux_bootstrap|t' \
  "$(psql_as fiatlux_bootstrap "$POSTGRES_BOOTSTRAP_PASSWORD" "SELECT current_user, rolsuper FROM pg_roles WHERE rolname=current_user")"
expect_failure "bootstrap 旧口令撤销" fiatlux_bootstrap "$old_bootstrap_password" \
  'SELECT 1' 'password authentication failed'
unset old_bootstrap_password

config_json=$($COMPOSE --profile operations config --format json)
jq -e '
  (.services.api.environment.DATABASE_URL | startswith("postgresql://fiatlux_runtime:")) and
  (.services.worker.environment.DATABASE_URL | startswith("postgresql://fiatlux_runtime:")) and
  (.services.worker.environment.PGUSER == "fiatlux_runtime") and
  (.services.migrate.environment.DATABASE_URL | startswith("postgresql://fiatlux_migrator:")) and
  (.services["queue-migrate"].environment.DATABASE_URL | startswith("postgresql://fiatlux_migrator:")) and
  (.services["backup-tools"].environment.PGUSER == "fiatlux_backup") and
  (.services.postgres.environment | has("POSTGRES_BOOTSTRAP_CURRENT_PASSWORD") | not) and
  (.services["db-bootstrap"].environment.POSTGRES_BOOTSTRAP_CURRENT_PASSWORD == "")
' >/dev/null <<<"$config_json"
unset config_json
echo "PASS Compose 数据库身份映射"

expect_value "runtime 角色属性" \
  'fiatlux_runtime|f|f|f|f' \
  "$(psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user")"
expect_value "migrator 角色属性" \
  'fiatlux_migrator|f|f|f|f' \
  "$(psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user")"
expect_value "backup 角色属性" \
  'fiatlux_backup|f|f|f|f' \
  "$(psql_as fiatlux_backup "$POSTGRES_BACKUP_PASSWORD" "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user")"
expect_value "restore 角色属性" \
  'fiatlux_restore|f|t|f|f' \
  "$(psql_as fiatlux_restore "$POSTGRES_RESTORE_PASSWORD" "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user")"
expect_value "角色继承边界" \
  'f|f|t|f|t' \
  "$(psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" "
    SELECT
      pg_has_role('fiatlux_runtime','fiatlux_migrator','MEMBER'),
      pg_has_role('fiatlux_backup','fiatlux_migrator','MEMBER'),
      pg_has_role('fiatlux_restore','fiatlux_migrator','MEMBER'),
      pg_has_role('fiatlux_backup','pg_read_all_data','MEMBER'),
      pg_has_role('fiatlux_restore','pg_signal_backend','MEMBER')
  ")"
expect_value "既有应用对象所有权已转移" \
  '0' \
  "$(psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" "
    SELECT count(*) FROM (
      SELECT c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle','pgboss')
        AND c.relkind IN ('r','p','f','S','v','m')
        AND pg_get_userbyid(c.relowner) <> 'fiatlux_migrator'
      UNION ALL
      SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','drizzle','pgboss')
        AND p.prokind IN ('f','p','w')
        AND pg_get_userbyid(p.proowner) <> 'fiatlux_migrator'
      UNION ALL
      SELECT t.oid
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname IN ('public','drizzle','pgboss')
        AND t.typtype='e'
        AND pg_get_userbyid(t.typowner) <> 'fiatlux_migrator'
    ) ownership_violations
  ")"

qa_org=00000000-0000-4000-8000-000000000901
qa_audit=00000000-0000-4000-8000-000000000902
expect_value "runtime 业务引用链事务锁" \
  'lock-ok' \
  "$(psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" "
    SELECT 'lock-ok'
    FROM (
      SELECT pg_advisory_xact_lock(
        hashtext('fiatlux-reference-chain'),
        hashtext('$qa_org')
      )
    ) locked
  ")"
psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" "
  INSERT INTO organizations (id,name,slug) VALUES ('$qa_org','DB privilege QA','db-privilege-qa');
  UPDATE organizations SET name='DB privilege QA updated' WHERE id='$qa_org';
  INSERT INTO audit_events (id,org_id,action,resource_type,resource_id,request_id,metadata)
    VALUES ('$qa_audit','$qa_org','qa','database-role','qa','db-role-test','{}'::jsonb);
" >/dev/null
expect_value "runtime 业务 DML 与 audit append" \
  'DB privilege QA updated|1' \
  "$(psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" "SELECT o.name, count(a.id) FROM organizations o JOIN audit_events a ON a.org_id=o.id WHERE o.id='$qa_org' GROUP BY o.name")"

expect_failure "runtime CREATE TABLE" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'CREATE TABLE runtime_must_not_create(id integer)' 'permission denied'
expect_failure "runtime CREATE TEMP TABLE" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'CREATE TEMP TABLE runtime_must_not_create_temp(id integer)' 'permission denied'
expect_failure "runtime CREATE DATABASE" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'CREATE DATABASE runtime_must_not_create' 'permission denied'
expect_failure "runtime CREATE ROLE" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'CREATE ROLE runtime_must_not_create' 'permission denied'
expect_failure "runtime SET ROLE migrator" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'SET ROLE fiatlux_migrator' 'permission denied'
expect_failure "runtime replica bypass" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "SET session_replication_role='replica'" 'permission denied'
expect_failure "runtime disable audit trigger" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'ALTER TABLE audit_events DISABLE TRIGGER audit_events_prevent_update_delete' 'must be owner|permission denied'
expect_failure "runtime UPDATE audit" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "UPDATE audit_events SET action='tampered' WHERE id='$qa_audit'" 'permission denied'
expect_failure "runtime DELETE audit" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "DELETE FROM audit_events WHERE id='$qa_audit'" 'permission denied'
expect_failure "runtime TRUNCATE audit" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  'TRUNCATE audit_events' 'permission denied'

psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" \
  'GRANT UPDATE, DELETE ON audit_events TO fiatlux_runtime' >/dev/null
expect_failure "ALWAYS trigger blocks accidental UPDATE grant" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "UPDATE audit_events SET action='tampered' WHERE id='$qa_audit'" 'append-only'
expect_failure "ALWAYS trigger blocks accidental DELETE grant" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "DELETE FROM audit_events WHERE id='$qa_audit'" 'append-only'
psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" \
  'REVOKE UPDATE, DELETE ON audit_events FROM fiatlux_runtime' >/dev/null
expect_value "audit trigger ENABLE ALWAYS 且所有者隔离" \
  'A|fiatlux_migrator|f|f' \
  "$(psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" "
    SELECT t.tgenabled, pg_get_userbyid(c.relowner),
      has_table_privilege('fiatlux_runtime','audit_events','UPDATE'),
      has_table_privilege('fiatlux_runtime','audit_events','DELETE')
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE t.tgname='audit_events_prevent_update_delete'
  ")"

psql_as fiatlux_migrator "$POSTGRES_MIGRATION_PASSWORD" \
  'CREATE TABLE public.migration_owner_qa (id integer PRIMARY KEY, note text)' >/dev/null
"$COMPOSE" run --rm --no-deps --pull never database-permissions >/dev/null
psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "INSERT INTO migration_owner_qa VALUES (1,'runtime dml')" >/dev/null
expect_value "migrator DDL 后 runtime DML" 'runtime dml' \
  "$(psql_as fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" 'SELECT note FROM migration_owner_qa WHERE id=1')"

queue_output=$(docker run --rm \
  --network "$network" \
  --env "DATABASE_URL=$runtime_url" \
  --entrypoint node \
  "$IMAGE_PREFIX-api:local" \
  --input-type=module --eval '
    import { JobQueue } from "/app/packages/integrations/dist/index.js";
    const queue = new JobQueue(process.env.DATABASE_URL, { migrate: false, provisionQueues: false });
    try {
      await queue.start();
      const id = await queue.send("notification.deliver", { orgId: "qa", notificationId: "qa" });
      const count = await queue.getQueueSize("notification.deliver");
      if (!id || count < 1) process.exit(4);
      console.log("queue-ok");
    } finally {
      await queue.stop();
    }
  ')
expect_value "runtime pg-boss 无 DDL 启动与入队" 'queue-ok' "$queue_output"
expect_failure "runtime 不可创建未知 pg-boss 队列" fiatlux_runtime "$POSTGRES_RUNTIME_PASSWORD" \
  "SELECT pgboss.create_queue('runtime.unknown','{}'::json)" 'permission denied'
docker run --rm \
  --network "$network" \
  --env "PGPASSWORD=$POSTGRES_RUNTIME_PASSWORD" \
  "$POSTGRES_IMAGE" sh -ec \
  'pg_dump --host postgres --username fiatlux_runtime --dbname "$1" --format=custom --file=/tmp/runtime.dump && test -s /tmp/runtime.dump' \
  sh "$POSTGRES_DB"
echo "PASS worker runtime 角色数据库备份所需只读覆盖"

expect_value "backup 可读取业务与审计" '1|1' \
  "$(psql_as fiatlux_backup "$POSTGRES_BACKUP_PASSWORD" "SELECT (SELECT count(*) FROM organizations WHERE id='$qa_org'), (SELECT count(*) FROM audit_events WHERE id='$qa_audit')")"
expect_failure "backup 不可写业务" fiatlux_backup "$POSTGRES_BACKUP_PASSWORD" \
  "UPDATE organizations SET name='backup tamper' WHERE id='$qa_org'" 'permission denied'
expect_failure "backup 不可执行 DDL" fiatlux_backup "$POSTGRES_BACKUP_PASSWORD" \
  'CREATE TABLE backup_must_not_create(id integer)' 'permission denied'
docker run --rm \
  --network "$network" \
  --env "PGPASSWORD=$POSTGRES_BACKUP_PASSWORD" \
  "$POSTGRES_IMAGE" sh -ec \
  'pg_dump --host postgres --username fiatlux_backup --dbname "$1" --format=custom --file=/tmp/qa.dump && test -s /tmp/qa.dump' \
  sh "$POSTGRES_DB"
echo "PASS backup 角色 pg_dump"

scratch_database=fiatlux_restore_scratch
docker run --rm \
  --network "$network" \
  --env "PGPASSWORD=$POSTGRES_RESTORE_PASSWORD" \
  "$POSTGRES_IMAGE" sh -ec '
    createdb --host postgres --username fiatlux_restore --owner fiatlux_migrator "$1"
    psql --host postgres --username fiatlux_restore --dbname "$1" --set=ON_ERROR_STOP=1 \
      --command "SET ROLE fiatlux_migrator; CREATE TABLE restore_role_qa(id integer)" >/dev/null
    dropdb --host postgres --username fiatlux_restore "$1"
  ' sh "$scratch_database"
echo "PASS restore 角色受控建库、SET ROLE migrator 与销毁"
expect_failure "restore 不可创建角色" fiatlux_restore "$POSTGRES_RESTORE_PASSWORD" \
  'CREATE ROLE restore_must_not_create' 'permission denied'

echo "PostgreSQL 最小权限正向/负向集成测试全部通过。"
