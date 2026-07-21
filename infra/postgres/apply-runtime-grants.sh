#!/bin/sh
set -eu

required_variables="PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD"
for variable in $required_variables; do
	eval "value=\${$variable:-}"
	if [ -z "$value" ]; then
		echo "缺少必需环境变量：$variable" >&2
		exit 2
	fi
done

if [ "$PGUSER" != "fiatlux_migrator" ]; then
	echo "权限收敛必须以 fiatlux_migrator 执行。" >&2
	exit 2
fi

export PGPASSWORD
psql --no-password --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
	IF current_user <> 'fiatlux_migrator' THEN
		RAISE EXCEPTION 'runtime grants must be applied by fiatlux_migrator';
	END IF;
END;
$$;

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', current_database())
\gexec
SELECT format(
	'GRANT CONNECT ON DATABASE %I TO fiatlux_runtime, fiatlux_backup, fiatlux_restore',
	current_database()
)
\gexec

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM fiatlux_runtime, fiatlux_backup;
GRANT USAGE ON SCHEMA public TO fiatlux_runtime, fiatlux_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fiatlux_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO fiatlux_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fiatlux_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fiatlux_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT SELECT ON TABLES TO fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	GRANT USAGE, SELECT ON SEQUENCES TO fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA public
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA drizzle TO fiatlux_runtime, fiatlux_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO fiatlux_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO fiatlux_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO fiatlux_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO fiatlux_backup;
REVOKE CREATE ON SCHEMA drizzle FROM fiatlux_runtime, fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA drizzle
	GRANT SELECT ON TABLES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA drizzle
	GRANT USAGE, SELECT ON SEQUENCES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA drizzle
	GRANT SELECT ON TABLES TO fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA drizzle
	GRANT USAGE, SELECT ON SEQUENCES TO fiatlux_backup;

GRANT USAGE ON SCHEMA pgboss TO fiatlux_runtime, fiatlux_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO fiatlux_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO fiatlux_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO fiatlux_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO fiatlux_backup;
REVOKE CREATE ON SCHEMA pgboss FROM fiatlux_runtime, fiatlux_backup;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC, fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA pgboss
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA pgboss
	GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fiatlux_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA pgboss
	GRANT SELECT ON TABLES TO fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA pgboss
	GRANT USAGE, SELECT ON SEQUENCES TO fiatlux_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fiatlux_migrator IN SCHEMA pgboss
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Defense in depth: no runtime UPDATE/DELETE/TRUNCATE path exists, and the owner-controlled
-- trigger remains active even for replica sessions. Runtime cannot change session_replication_role
-- or disable an ALWAYS trigger because it is neither superuser nor table owner.
ALTER TABLE public.audit_events ENABLE ALWAYS TRIGGER audit_events_prevent_update_delete;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_events FROM fiatlux_runtime;
GRANT SELECT, INSERT ON public.audit_events TO fiatlux_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_audit_event_mutation() FROM PUBLIC, fiatlux_runtime;
SQL
unset PGPASSWORD

echo "运行时数据库授权已收敛；审计表保持追加写。"
