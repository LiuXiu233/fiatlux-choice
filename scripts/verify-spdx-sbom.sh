#!/usr/bin/env bash
set -euo pipefail

sbom=""
syft_version=""
while (($#)); do
  case "$1" in
    --sbom)
      sbom=${2:?--sbom 需要值}
      shift 2
      ;;
    --syft-version)
      syft_version=${2:?--syft-version 需要值}
      shift 2
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$sbom" || ! -f "$sbom" || -L "$sbom" ]]; then
  echo "SPDX SBOM 必须是可读的普通文件，且不能是符号链接。" >&2
  exit 2
fi
if [[ ! "$syft_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Syft 版本必须是 MAJOR.MINOR.PATCH。" >&2
  exit 2
fi
for command_name in awk jq sha256sum tr wc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'SPDX SBOM 校验要求安装 %s。\n' "$command_name" >&2
    exit 127
  fi
done

size=$(wc -c <"$sbom" | tr -d '[:space:]')
if [[ ! "$size" =~ ^[0-9]+$ ]] || ((size == 0 || size > 134217728)); then
  echo "SPDX SBOM 必须是 1–134217728 字节。" >&2
  exit 3
fi

if ! jq -e --arg syft_creator "Tool: syft-$syft_version" '
  type == "object" and
  (.spdxVersion | type == "string" and startswith("SPDX-")) and
  .dataLicense == "CC0-1.0" and
  .SPDXID == "SPDXRef-DOCUMENT" and
  (.name | type == "string" and length > 0) and
  (.documentNamespace | type == "string" and length > 0) and
  (.creationInfo | type == "object") and
  (.creationInfo.created | type == "string" and length > 0) and
  (.creationInfo.creators | type == "array") and
  any(.creationInfo.creators[]?; . == $syft_creator) and
  (.packages | type == "array" and length > 0)
' "$sbom" >/dev/null; then
  echo "SPDX SBOM 缺少合法 document、非空 packages 或精确 Syft creator 版本。" >&2
  exit 3
fi

sha256sum "$sbom" | awk '{print $1}'
