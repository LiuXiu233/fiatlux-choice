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
done

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
