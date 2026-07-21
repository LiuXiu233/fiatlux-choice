#!/bin/sh
set -eu

umask 077

required_variables="PGHOST PGPORT POSTGRES_DB POSTGRES_BOOTSTRAP_USER POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATION_PASSWORD POSTGRES_RUNTIME_PASSWORD POSTGRES_BACKUP_PASSWORD POSTGRES_RESTORE_PASSWORD"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

case "$POSTGRES_DB" in
	*[!A-Za-z0-9_]* | "")
		echo "POSTGRES_DB 只能包含字母、数字和下划线。" >&2
		exit 2
		;;
esac
case "$POSTGRES_BOOTSTRAP_USER" in
	*[!A-Za-z0-9_]* | "" | [0-9]*)
		echo "POSTGRES_BOOTSTRAP_USER 不是安全的 PostgreSQL 标识符。" >&2
		exit 2
		;;
esac
if [ "${#POSTGRES_DB}" -gt 63 ] || [ "${#POSTGRES_BOOTSTRAP_USER}" -gt 63 ]; then
	echo "PostgreSQL 数据库名和角色名最多 63 个字节（当前配置仅允许 ASCII）。" >&2
	exit 2
fi
case "$POSTGRES_DB" in
	postgres | template0 | template1)
		echo "POSTGRES_DB 不得使用 PostgreSQL 系统数据库名。" >&2
		exit 2
		;;
esac
case "$POSTGRES_BOOTSTRAP_USER" in
	fiatlux_migrator | fiatlux_runtime | fiatlux_backup | fiatlux_restore)
		echo "POSTGRES_BOOTSTRAP_USER 必须与四个固定职责角色分离。" >&2
		exit 2
		;;
esac

seen_passwords="|"
for variable in POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATION_PASSWORD POSTGRES_RUNTIME_PASSWORD POSTGRES_BACKUP_PASSWORD POSTGRES_RESTORE_PASSWORD; do
	eval "value=\${$variable}"
	case "$value" in
		*[!A-Za-z0-9._~-]*)
			echo "$variable 必须是 URL 安全值；建议使用 openssl rand -hex 32。" >&2
			exit 2
			;;
	esac
	if [ "${#value}" -lt 16 ]; then
		echo "$variable 至少需要 16 个字符。" >&2
		exit 2
	fi
	case "$seen_passwords" in
		*"|$value|"*)
			echo "五个 PostgreSQL 职责口令必须彼此独立。" >&2
			exit 2
			;;
	esac
	seen_passwords="$seen_passwords$value|"
done
unset seen_passwords value

bootstrap_auth_password=${POSTGRES_BOOTSTRAP_CURRENT_PASSWORD:-$POSTGRES_BOOTSTRAP_PASSWORD}
if [ -z "$bootstrap_auth_password" ]; then
	echo "缺少 bootstrap 当前认证口令。" >&2
	exit 2
fi
export PGPASSWORD="$bootstrap_auth_password"

psql \
	--host="$PGHOST" \
	--port="$PGPORT" \
	--username="$POSTGRES_BOOTSTRAP_USER" \
	--dbname="$POSTGRES_DB" \
	--no-password \
	--set=ON_ERROR_STOP=1 \
	--set=database_name="$POSTGRES_DB" \
	--set=bootstrap_user="$POSTGRES_BOOTSTRAP_USER" \
	--set=bootstrap_password="$POSTGRES_BOOTSTRAP_PASSWORD" \
	--set=migration_password="$POSTGRES_MIGRATION_PASSWORD" \
	--set=runtime_password="$POSTGRES_RUNTIME_PASSWORD" \
	--set=backup_password="$POSTGRES_BACKUP_PASSWORD" \
	--set=restore_password="$POSTGRES_RESTORE_PASSWORD" <<'SQL'
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
	) THEN
		RAISE EXCEPTION 'db-bootstrap requires the authenticated cluster superuser';
	END IF;
END;
$$;

SELECT format(
	'CREATE ROLE fiatlux_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
	:'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiatlux_migrator')
\gexec
SELECT format(
	'CREATE ROLE fiatlux_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
	:'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiatlux_runtime')
\gexec
SELECT format(
	'CREATE ROLE fiatlux_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
	:'backup_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiatlux_backup')
\gexec
SELECT format(
	'CREATE ROLE fiatlux_restore LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
	:'restore_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiatlux_restore')
\gexec

ALTER ROLE fiatlux_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migration_password';
ALTER ROLE fiatlux_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
ALTER ROLE fiatlux_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_password';
ALTER ROLE fiatlux_restore WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'restore_password';

-- Remove every inherited role before applying the exact allowlist below. ALTER ROLE flags do not
-- remove memberships left by an older or manually modified deployment.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, member_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname IN (
	'fiatlux_migrator',
	'fiatlux_runtime',
	'fiatlux_backup',
	'fiatlux_restore'
)
\gexec
GRANT fiatlux_migrator TO fiatlux_restore;
GRANT pg_signal_backend TO fiatlux_restore;

ALTER DATABASE :"database_name" OWNER TO fiatlux_migrator;
REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO fiatlux_migrator, fiatlux_runtime, fiatlux_backup, fiatlux_restore;

-- Existing single-role deployments owned their objects with the bootstrap role. Transfer only
-- application schemas in this database; do not use REASSIGN OWNED, which can also affect shared
-- objects such as unrelated databases and tablespaces.
SELECT format('ALTER SCHEMA %I OWNER TO fiatlux_migrator', nspname)
FROM pg_namespace
WHERE nspname IN ('drizzle', 'pgboss')
  AND pg_get_userbyid(nspowner) <> 'fiatlux_migrator'
\gexec

SELECT format('ALTER TABLE %I.%I OWNER TO fiatlux_migrator', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND c.relkind IN ('r', 'p', 'f')
  AND pg_get_userbyid(c.relowner) <> 'fiatlux_migrator'
ORDER BY c.relkind = 'p' DESC, n.nspname, c.relname
\gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO fiatlux_migrator', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND c.relkind = 'S'
  AND pg_get_userbyid(c.relowner) <> 'fiatlux_migrator'
\gexec

SELECT format('ALTER VIEW %I.%I OWNER TO fiatlux_migrator', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND c.relkind = 'v'
  AND pg_get_userbyid(c.relowner) <> 'fiatlux_migrator'
\gexec

SELECT format('ALTER MATERIALIZED VIEW %I.%I OWNER TO fiatlux_migrator', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND c.relkind = 'm'
  AND pg_get_userbyid(c.relowner) <> 'fiatlux_migrator'
\gexec

SELECT format(
	'ALTER %s %I.%I(%s) OWNER TO fiatlux_migrator',
	CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
	n.nspname,
	p.proname,
	pg_get_function_identity_arguments(p.oid)
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND p.prokind IN ('f', 'p', 'w')
  AND pg_get_userbyid(p.proowner) <> 'fiatlux_migrator'
\gexec

SELECT format('ALTER TYPE %I.%I OWNER TO fiatlux_migrator', n.nspname, t.typname)
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname IN ('public', 'drizzle', 'pgboss')
  AND t.typtype = 'e'
  AND pg_get_userbyid(t.typowner) <> 'fiatlux_migrator'
\gexec

CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION fiatlux_migrator;
ALTER SCHEMA pgboss OWNER TO fiatlux_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fiatlux_migrator;
GRANT USAGE ON SCHEMA public TO fiatlux_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Rotate the bootstrap credential only after every role/ownership change above succeeded. The
-- current connection remains valid; the shell immediately performs a new authenticated check.
SELECT format(
	'ALTER ROLE %I WITH LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS PASSWORD %L',
	:'bootstrap_user',
	:'bootstrap_password'
)
\gexec
SQL

unset PGPASSWORD
bootstrap_verification=$(
	PGPASSWORD="$POSTGRES_BOOTSTRAP_PASSWORD" psql \
		--host="$PGHOST" \
		--port="$PGPORT" \
		--username="$POSTGRES_BOOTSTRAP_USER" \
		--dbname="$POSTGRES_DB" \
		--no-password \
		--tuples-only \
		--no-align \
		--set=ON_ERROR_STOP=1 \
		--command="SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user"
)
unset bootstrap_auth_password
if [ "$bootstrap_verification" != "$POSTGRES_BOOTSTRAP_USER|t" ]; then
	echo "bootstrap 新口令重新认证或超级用户属性验证失败。" >&2
	exit 5
fi
echo "PostgreSQL 最小权限角色已创建或轮换；未输出任何数据库口令。"
