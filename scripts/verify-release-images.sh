#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE=${FIATLUX_COMPOSE_SCRIPT:-$ROOT_DIR/scripts/compose.sh}
DOCKER=${DOCKER_BIN:-docker}
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT_DIR/scripts/lib/runtime-env.sh"
load_runtime_env

usage() {
  cat <<'EOF'
用法：./scripts/verify-release-images.sh --version VERSION \
       --expected-git-sha GIT_SHA \
       --manifest release-manifest.tsv --manifest-sha256 SHA256 \
       [--manifest-only | --check-running-services]

校验受审发布清单本身，并逐一核对 api、worker、web、gateway、minio、backup、postgres
七个本地已拉取镜像的 RepoDigest。--manifest-only 只执行清单预检；
--check-running-services 还核对 api/worker/web/gateway/minio/postgres 容器实际 image ID。
EOF
}

version=""
expected_git_sha=""
manifest=""
manifest_sha256=""
manifest_only=false
check_running_services=false
while (($#)); do
  case "$1" in
    --version)
      version=${2:?--version 需要值}
      shift 2
      ;;
    --expected-git-sha)
      expected_git_sha=${2:?--expected-git-sha 需要值}
      shift 2
      ;;
    --manifest)
      manifest=${2:?--manifest 需要值}
      shift 2
      ;;
    --manifest-sha256)
      manifest_sha256=${2:?--manifest-sha256 需要值}
      shift 2
      ;;
    --manifest-only)
      manifest_only=true
      shift
      ;;
    --check-running-services)
      check_running_services=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$manifest_only" == true && "$check_running_services" == true ]]; then
  echo "--manifest-only 与 --check-running-services 不能同时使用。" >&2
  exit 2
fi

if ((${#version} > 128)) || \
  [[ ! "$version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "发布版本必须是 vMAJOR.MINOR.PATCH[-PRERELEASE]。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "受审 Git SHA 必须是 40 位小写十六进制完整 commit ID。" >&2
  exit 2
fi
if [[ -z "$manifest" || ! -f "$manifest" || -L "$manifest" ]]; then
  echo "发布清单必须是可读的普通文件，且不能是符号链接。" >&2
  exit 2
fi
if [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "受审发布清单 SHA-256 必须是 64 位小写十六进制。" >&2
  exit 2
fi

work=$(mktemp -d)
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
manifest_copy="$work/release-manifest.tsv"
cp "$manifest" "$manifest_copy"
chmod 0600 "$manifest_copy"
manifest_size=$(wc -c <"$manifest_copy" | tr -d '[:space:]')
if [[ ! "$manifest_size" =~ ^[0-9]+$ ]] || ((manifest_size == 0 || manifest_size > 8192)); then
  echo "发布清单必须是 1–8192 字节的严格 TSV 文件。" >&2
  exit 3
fi

actual_manifest_sha256=$(sha256sum "$manifest_copy" | awk '{print $1}')
if [[ "$actual_manifest_sha256" != "$manifest_sha256" ]]; then
  printf '发布清单 SHA-256 不匹配：期望 %s，实际 %s。\n' \
    "$manifest_sha256" "$actual_manifest_sha256" >&2
  exit 3
fi

expected_components=(api worker web gateway minio backup postgres)
approved_digests=("" "" "" "" "" "" "")
line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  ((line_number += 1))
  line=${line%$'\r'}
  if ((line_number == 1)); then
    if [[ "$line" != $'version\tgit_sha\tcomponent\tdigest' ]]; then
      echo "发布清单表头必须精确为 version<TAB>git_sha<TAB>component<TAB>digest。" >&2
      exit 3
    fi
    continue
  fi
  if [[ "$line" != *$'\t'* ]]; then
    printf '发布清单第 %d 行必须精确包含四个非空 TSV 字段。\n' "$line_number" >&2
    exit 3
  fi
  row_version=${line%%$'\t'*}
  remainder=${line#*$'\t'}
  if [[ "$remainder" != *$'\t'* ]]; then
    printf '发布清单第 %d 行必须精确包含四个非空 TSV 字段。\n' "$line_number" >&2
    exit 3
  fi
  row_git_sha=${remainder%%$'\t'*}
  remainder=${remainder#*$'\t'}
  if [[ "$remainder" != *$'\t'* ]]; then
    printf '发布清单第 %d 行必须精确包含四个非空 TSV 字段。\n' "$line_number" >&2
    exit 3
  fi
  component=${remainder%%$'\t'*}
  digest=${remainder#*$'\t'}
  if [[ "$digest" == *$'\t'* || -z "$row_version" || -z "$row_git_sha" || -z "$component" || -z "$digest" ]]; then
    printf '发布清单第 %d 行必须精确包含四个非空 TSV 字段。\n' "$line_number" >&2
    exit 3
  fi
  if [[ "$row_version" != "$version" ]]; then
    printf '发布清单第 %d 行版本 %s 与目标 %s 不一致。\n' "$line_number" "$row_version" "$version" >&2
    exit 3
  fi
  if [[ "$row_git_sha" != "$expected_git_sha" ]]; then
    printf '发布清单第 %d 行 Git SHA %s 与受审值 %s 不一致。\n' \
      "$line_number" "$row_git_sha" "$expected_git_sha" >&2
    exit 3
  fi
  case "$component" in
    api) component_position=0 ;;
    worker) component_position=1 ;;
    web) component_position=2 ;;
    gateway) component_position=3 ;;
    minio) component_position=4 ;;
    backup) component_position=5 ;;
    postgres) component_position=6 ;;
    *)
      printf '发布清单包含未知组件：%s。\n' "$component" >&2
      exit 3
      ;;
  esac
  if [[ -n "${approved_digests[$component_position]}" ]]; then
    printf '发布清单重复组件：%s。\n' "$component" >&2
    exit 3
  fi
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '发布清单组件 %s 的 digest 格式无效。\n' "$component" >&2
    exit 3
  fi
  approved_digests[component_position]=$digest
done <"$manifest_copy"

if ((line_number != 8)); then
  printf '发布清单必须正好包含表头和七个组件，实际 %d 行。\n' "$line_number" >&2
  exit 3
fi
for component_position in "${!expected_components[@]}"; do
  component=${expected_components[$component_position]}
  if [[ -z "${approved_digests[$component_position]}" ]]; then
    printf '发布清单缺少组件：%s。\n' "$component" >&2
    exit 3
  fi
done
printf '发布清单通过：version=%s gitSha=%s sha256=%s components=7\n' \
  "$version" "$expected_git_sha" "$manifest_sha256"

if [[ "$manifest_only" == true ]]; then
  exit 0
fi
if ! command -v "$DOCKER" >/dev/null 2>&1; then
  printf '未找到 Docker 命令：%s。\n' "$DOCKER" >&2
  exit 127
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "镜像校验要求安装 jq。" >&2
  exit 127
fi

config_json="$work/compose.json"
COMPOSE_PROFILES=operations FIATLUX_VERSION_OVERRIDE=$version \
  "$COMPOSE" config --format json >"$config_json"

for component_position in "${!expected_components[@]}"; do
  component=${expected_components[$component_position]}
  case "$component" in
    api | worker | web | minio | postgres) service=$component ;;
    gateway) service=caddy ;;
    backup) service=backup-tools ;;
  esac
  approved_digest=${approved_digests[$component_position]}
  image=$(jq -er --arg service "$service" '.services[$service].image' "$config_json")
  if [[ "$image" != *":$version" ]]; then
    printf 'Compose 服务 %s 未绑定目标 tag %s：%s。\n' "$service" "$version" "$image" >&2
    exit 4
  fi
  repository=${image%":$version"}
  expected_reference="$repository@$approved_digest"
  local_repo_digests=$("$DOCKER" image inspect \
    --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image")
  matched=false
  while IFS= read -r local_reference; do
    if [[ "$local_reference" == "$expected_reference" ]]; then
      matched=true
      break
    fi
  done <<<"$local_repo_digests"
  if [[ "$matched" != true ]]; then
    printf '本地镜像 digest 不匹配：组件=%s 镜像=%s 期望=%s。\n' \
      "$component" "$image" "$expected_reference" >&2
    exit 4
  fi
  printf '镜像 digest 通过：%-7s %s\n' "$component" "$approved_digest"
done

echo "七个发布组件的本地 RepoDigest 均与受审清单一致。"

if [[ "$check_running_services" == true ]]; then
  # backup 是按需容器；其余六个发布组件必须有正在运行的受审实例。
  for component_position in 0 1 2 3 4 6; do
    component=${expected_components[$component_position]}
    case "$component" in
      api | worker | web | minio | postgres) service=$component ;;
      gateway) service=caddy ;;
    esac
    image=$(jq -er --arg service "$service" '.services[$service].image' "$config_json")
    container_id=$(COMPOSE_PROFILES=operations FIATLUX_VERSION_OVERRIDE=$version \
      "$COMPOSE" ps -q "$service")
    if [[ -z "$container_id" || "$container_id" == *$'\n'* ]]; then
      printf '服务 %s 必须恰好有一个运行容器。\n' "$service" >&2
      exit 5
    fi
    approved_image_id=$("$DOCKER" image inspect --format '{{.Id}}' "$image")
    running_image_id=$("$DOCKER" container inspect --format '{{.Image}}' "$container_id")
    if [[ -z "$approved_image_id" || "$running_image_id" != "$approved_image_id" ]]; then
      printf '运行容器镜像不匹配：服务=%s 期望ID=%s 实际ID=%s。\n' \
        "$service" "$approved_image_id" "$running_image_id" >&2
      exit 5
    fi
    printf '运行容器 image ID 通过：%s %s\n' "$service" "$running_image_id"
  done
fi
