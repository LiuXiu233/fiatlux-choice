#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env

base_url=""
ca_file=${CADDY_ROOT_CA_FILE:-}
while (($#)); do
  case "$1" in
    --url)
      base_url=${2:?--url 需要值}
      shift 2
      ;;
    --ca)
      ca_file=${2:?--ca 需要值}
      shift 2
      ;;
    -h | --help)
      echo "用法：./scripts/verify-deployment.sh [--url URL] [--ca CADDY_ROOT_CA]"
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      exit 2
      ;;
  esac
done

"$COMPOSE" config --quiet

required_services=(postgres minio api worker web caddy)
running_services=$("$COMPOSE" ps --status running --services)
for service in "${required_services[@]}"; do
  if ! grep -qx "$service" <<<"$running_services"; then
    printf '服务未运行：%s\n' "$service" >&2
    exit 3
  fi
  container_id=$("$COMPOSE" ps -q "$service")
  health_status=$(docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")
  if [[ "$health_status" != healthy ]]; then
    printf '服务健康检查未通过：%s（状态=%s）\n' "$service" "$health_status" >&2
    exit 3
  fi
done

assert_environment_allowlist() {
  local service=$1
  local allowed=$2
  local container_id environment_names unexpected
  container_id=$("$COMPOSE" ps -q "$service")
  environment_names=$(docker inspect --format \
    '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}' "$container_id")
  unexpected=$(grep -Ev "$allowed" <<<"$environment_names" || true)
  if [[ -n "$unexpected" ]]; then
    printf '服务 %s 持有未列入最小环境变量清单的变量名：\n%s\n' \
      "$service" "$unexpected" >&2
    exit 4
  fi
}

for service in api worker web caddy; do
  container_id=$("$COMPOSE" ps -q "$service")
  [[ -n "$container_id" ]] || {
    printf '找不到服务容器：%s\n' "$service" >&2
    exit 3
  }
  inspect=$(docker inspect --format '{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.SecurityOpt}}' "$container_id")
  user=${inspect%%|*}
  remainder=${inspect#*|}
  readonly=${remainder%%|*}
  if [[ -z "$user" || "$user" == 0 || "$user" == root ]]; then
    printf '服务未以显式非 root 用户运行：%s（User=%s）\n' "$service" "$user" >&2
    exit 4
  fi
  if [[ "$readonly" != true || "$inspect" != *no-new-privileges* ]]; then
    printf '服务缺少只读根文件系统或 no-new-privileges：%s\n' "$service" >&2
    exit 4
  fi

done

# Config.Env includes the three fixed variables inherited from the pinned Node image. Everything
# else is an explicit runtime capability. This catches future anchor regressions that accidentally
# hand session, object-storage, bootstrap, or integration credentials to the wrong service.
assert_environment_allowlist api \
  '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV|API_HOST|API_PORT|WEB_ORIGIN|DATABASE_URL|DATABASE_POOL_SIZE|DATABASE_CONNECT_TIMEOUT_SECONDS|READINESS_TIMEOUT_MS|JWT_SECRET|JWT_TTL_SECONDS|COOKIE_SECURE|S3_ENDPOINT|S3_REGION|S3_BUCKET|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|LLM_DRIVER|LLM_BASE_URL|LLM_API_KEY|LLM_MODEL|GITHUB_INTEGRATION_MODE|GITHUB_TOKEN|TRUST_PROXY)$'
assert_environment_allowlist worker \
  '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV|DATABASE_URL|DATABASE_POOL_SIZE|DATABASE_CONNECT_TIMEOUT_SECONDS|LLM_DRIVER|LLM_BASE_URL|LLM_API_KEY|LLM_MODEL|GITHUB_INTEGRATION_MODE|GITHUB_TOKEN|BACKUP_COMMAND|BACKUP_DIR|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|BACKUP_AGE_RECIPIENT|BACKUP_REQUIRE_ENCRYPTION)$'

for service in api worker; do
  container_id=$("$COMPOSE" ps -q "$service")
  database_user=$(docker exec "$container_id" node -e \
    'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).username))')
  if [[ "$database_user" != fiatlux_runtime ]]; then
    printf '常驻服务 %s 未使用 fiatlux_runtime（实际用户=%s）。\n' "$service" "$database_user" >&2
    exit 4
  fi
done

api_container_id=$("$COMPOSE" ps -q api)
minio_container_id=$("$COMPOSE" ps -q minio)
api_s3_identity=$(docker exec "$api_container_id" node -e \
  'process.stdout.write(process.env.S3_ACCESS_KEY_ID ?? "")')
minio_root_identity=$(docker exec "$minio_container_id" /bin/sh -ec \
  'printf %s "$MINIO_ROOT_USER"')
if [[ -z "$api_s3_identity" || "$api_s3_identity" == "$minio_root_identity" ]]; then
  echo "API 对象存储身份为空或复用了 MinIO root 身份。" >&2
  exit 4
fi

# Query only booleans and role/object names; never print DATABASE_URL or a password. This catches
# a deployment that looks syntactically valid but accidentally maps runtime to an owner/superuser.
runtime_database_posture=$(docker exec "$api_container_id" node --input-type=module -e '
  import postgres from "/app/packages/db/node_modules/postgres/src/index.js";
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const [row] = await sql`
      SELECT
        current_user AS role,
        r.rolsuper AS superuser,
        r.rolcreatedb AS createdb,
        r.rolcreaterole AS createrole,
        r.rolbypassrls AS bypassrls,
        has_schema_privilege(current_user, ${"public"}, ${"CREATE"}) AS schema_create,
        has_table_privilege(current_user, ${"public.audit_events"}, ${"UPDATE"}) AS audit_update,
        has_table_privilege(current_user, ${"public.audit_events"}, ${"DELETE"}) AS audit_delete,
        t.tgenabled AS trigger_mode,
        pg_get_userbyid(c.relowner) AS audit_owner,
        (
          SELECT count(DISTINCT application_name) = 4
          FROM pg_stat_activity
          WHERE usename = current_user
            AND application_name = ANY(ARRAY[
              ${"fiatlux-api"},
              ${"fiatlux-api-queue"},
              ${"fiatlux-worker"},
              ${"fiatlux-worker-queue"}
            ])
        ) AS named_runtime_clients
      FROM pg_roles r
      JOIN pg_trigger t ON t.tgname = ${"audit_events_prevent_update_delete"}
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE r.rolname = current_user
    `;
    process.stdout.write([
      row.role,
      row.superuser,
      row.createdb,
      row.createrole,
      row.bypassrls,
      row.schema_create,
      row.audit_update,
      row.audit_delete,
      row.trigger_mode,
      row.audit_owner,
      row.named_runtime_clients,
    ].join("|"));
  } finally {
    await sql.end();
  }
')
if [[ "$runtime_database_posture" != 'fiatlux_runtime|false|false|false|false|false|false|false|A|fiatlux_migrator|true' ]]; then
  printf '数据库运行时权限姿态不符合最小权限基线：%s\n' "$runtime_database_posture" >&2
  exit 4
fi

if [[ -z "$base_url" ]]; then
  if [[ "${FIATLUX_ENV:-development}" == production ]]; then
    base_url="https://${APP_DOMAIN:?APP_DOMAIN must be set}:${HTTPS_PORT:-8443}"
  else
    base_url="http://127.0.0.1:${HTTP_PORT:-8080}"
  fi
fi

curl_args=(--fail --silent --show-error --max-time 10)
if [[ -n "$ca_file" ]]; then
  curl_args+=(--cacert "$ca_file")
elif [[ "$base_url" == https://* ]]; then
  echo "生产 HTTPS 验证必须通过 --ca 提供受信任的 Caddy 根证书。" >&2
  exit 2
fi

live_response=$(curl "${curl_args[@]}" "$base_url/health/live")
ready_response=$(curl "${curl_args[@]}" "$base_url/health/ready")
printf 'live=%s\nready=%s\n' "$live_response" "$ready_response"

"$ROOT_DIR/scripts/verify-minio-permissions.sh"

for service in postgres minio api worker web; do
  container_id=$("$COMPOSE" ps -q "$service")
  [[ -n "$container_id" ]] || continue
  bindings=$(docker inspect --format '{{range $port, $items := .HostConfig.PortBindings}}{{if $items}}{{$port}} {{end}}{{end}}' "$container_id")
  if [[ -n "$bindings" ]]; then
    printf '发现非网关服务发布到宿主机：%s（%s）\n' "$service" "$bindings" >&2
    exit 4
  fi
done

gateway_id=$("$COMPOSE" ps -q caddy)
gateway_bindings=$(docker inspect --format '{{range $port, $items := .HostConfig.PortBindings}}{{if $items}}{{$port}} {{end}}{{end}}' "$gateway_id")
if [[ -z "$gateway_bindings" ]]; then
  echo "Caddy 未发布宿主端口。" >&2
  exit 4
fi

echo "部署验证通过。"
