#!/usr/bin/env bash
set -euo pipefail

expected_buildx=${EXPECTED_BUILDX_VERSION:-}
expected_buildkit=${EXPECTED_BUILDKIT_VERSION:-}
expected_buildkit_image=${EXPECTED_BUILDKIT_IMAGE:-}
required_buildkit_platforms=${REQUIRED_BUILDKIT_PLATFORMS:-linux/amd64}
registered_qemu_platforms=${QEMU_REGISTERED_PLATFORMS:-}
required_qemu_platforms=${REQUIRED_QEMU_PLATFORMS:-}
DOCKER=${DOCKER_BIN:-docker}

if [[ ! "$expected_buildx" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ || \
  ! "$expected_buildkit" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "必须设置合法的 EXPECTED_BUILDX_VERSION 与 EXPECTED_BUILDKIT_VERSION。" >&2
  exit 2
fi
if [[ ! "$expected_buildkit_image" =~ ^docker\.io/moby/buildkit:v[0-9]+\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "EXPECTED_BUILDKIT_IMAGE 必须是固定版本与 sha256 的 Docker Hub reference。" >&2
  exit 2
fi
for command_name in awk sort; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '构建工具链校验要求安装 %s。\n' "$command_name" >&2
    exit 127
  fi
done
if ! command -v "$DOCKER" >/dev/null 2>&1; then
  printf '构建工具链校验要求可执行的 Docker 命令：%s。\n' "$DOCKER" >&2
  exit 127
fi

buildx_output=$("$DOCKER" buildx version)
actual_buildx=$(awk 'NR == 1 {print $2}' <<<"$buildx_output")
if [[ "$actual_buildx" != "$expected_buildx" ]]; then
  printf 'Buildx 版本不匹配：期望 %s，实际 %s。\n' \
    "$expected_buildx" "${actual_buildx:-unknown}" >&2
  exit 3
fi

inspect_output=$("$DOCKER" buildx inspect --bootstrap)
buildkit_versions=$(awk '/^[[:space:]]*BuildKit version:/ {print $3}' <<<"$inspect_output" | sort -u)
if [[ -z "$buildkit_versions" ]]; then
  echo "未能从当前 builder 读取实际 BuildKit version。" >&2
  exit 3
fi
while IFS= read -r actual_buildkit; do
  if [[ "$actual_buildkit" != "$expected_buildkit" ]]; then
    printf 'BuildKit 版本不匹配：期望 %s，实际 %s。\n' \
      "$expected_buildkit" "$actual_buildkit" >&2
    exit 3
  fi
done <<<"$buildkit_versions"

buildkit_platforms=$(awk '
  /^[[:space:]]*Platforms:/ {
    sub(/^[[:space:]]*Platforms:[[:space:]]*/, "")
    print
  }
' <<<"$inspect_output")
if [[ -z "$buildkit_platforms" ]]; then
  echo "未能从当前 builder 读取实际 platforms。" >&2
  exit 3
fi

platform_is_present() {
  local available=$1
  local required=$2
  local normalized
  normalized=${available// /}
  normalized=${normalized//\*/}
  [[ ",$normalized," == *",$required,"* || ",$normalized," == *",$required/"* ]]
}

while IFS= read -r required_platform; do
  [[ -z "$required_platform" ]] && continue
  if ! platform_is_present "$buildkit_platforms" "$required_platform"; then
    printf 'BuildKit 缺少要求的平台 %s；实际为 %s。\n' \
      "$required_platform" "$buildkit_platforms" >&2
    exit 3
  fi
done < <(tr ',' '\n' <<<"$required_buildkit_platforms")

builder_container_count=0
while IFS= read -r builder_container; do
  [[ -z "$builder_container" ]] && continue
  ((builder_container_count += 1))
  configured_image=$("$DOCKER" container inspect --format '{{.Config.Image}}' "$builder_container")
  normalized_configured_image=${configured_image#docker.io/}
  normalized_expected_image=${expected_buildkit_image#docker.io/}
  if [[ "$normalized_configured_image" != "$normalized_expected_image" ]]; then
    printf 'BuildKit builder 容器未使用受审 image reference：期望 %s，实际 %s。\n' \
      "$expected_buildkit_image" "$configured_image" >&2
    exit 3
  fi
done < <("$DOCKER" ps --filter name=buildx_buildkit_ --format '{{.ID}}')
if ((builder_container_count != 1)); then
  printf '当前 workflow job 必须恰好有一个 Buildx BuildKit 容器，实际为 %d。\n' \
    "$builder_container_count" >&2
  exit 3
fi

if [[ -n "$required_qemu_platforms" ]]; then
  if [[ -z "$registered_qemu_platforms" ]]; then
    echo "要求 QEMU 平台时必须传入 setup-qemu 的实际输出。" >&2
    exit 3
  fi
  while IFS= read -r required_qemu; do
    [[ -z "$required_qemu" ]] && continue
    if ! platform_is_present "$registered_qemu_platforms" "$required_qemu" && \
      ! platform_is_present "$registered_qemu_platforms" "linux/$required_qemu"; then
      printf 'QEMU 未注册要求的平台 %s；实际为 %s。\n' \
        "$required_qemu" "$registered_qemu_platforms" >&2
      exit 3
    fi
  done < <(tr ',' '\n' <<<"$required_qemu_platforms")
fi

printf '构建工具链通过：Buildx=%s BuildKit=%s image=%s platforms=%s' \
  "$actual_buildx" "$expected_buildkit" "$expected_buildkit_image" "$buildkit_platforms"
if [[ -n "$required_qemu_platforms" ]]; then
  printf ' qemu=%s' "$registered_qemu_platforms"
fi
printf '\n'
