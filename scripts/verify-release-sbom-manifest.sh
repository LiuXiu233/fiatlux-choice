#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
manifest=""
component=""
image_digest=""
git_sha=""
syft_version=""
sbom_directory=""
while (($#)); do
  case "$1" in
    --manifest)
      manifest=${2:?--manifest 需要值}
      shift 2
      ;;
    --component)
      component=${2:?--component 需要值}
      shift 2
      ;;
    --image-digest)
      image_digest=${2:?--image-digest 需要值}
      shift 2
      ;;
    --git-sha)
      git_sha=${2:?--git-sha 需要值}
      shift 2
      ;;
    --syft-version)
      syft_version=${2:?--syft-version 需要值}
      shift 2
      ;;
    --sbom-directory)
      sbom_directory=${2:?--sbom-directory 需要值}
      shift 2
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      exit 2
      ;;
  esac
done

case "$component" in
  api | worker | web | gateway | minio | backup | postgres) ;;
  *)
    echo "SBOM component 必须是七个发布组件之一。" >&2
    exit 2
    ;;
esac
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ || \
  ! "$git_sha" =~ ^[0-9a-f]{40}$ || \
  ! "$syft_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "SBOM 清单的 image digest、Git SHA 或 Syft 版本参数无效。" >&2
  exit 2
fi
if [[ -z "$manifest" || ! -f "$manifest" || -L "$manifest" ]]; then
  echo "SBOM 清单必须是可读的普通文件，且不能是符号链接。" >&2
  exit 2
fi
if [[ -z "$sbom_directory" || ! -d "$sbom_directory" || -L "$sbom_directory" ]]; then
  echo "SBOM 目录必须是普通目录，且不能是符号链接。" >&2
  exit 2
fi
for command_name in tr wc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'SBOM 清单校验要求安装 %s。\n' "$command_name" >&2
    exit 127
  fi
done

manifest_size=$(wc -c <"$manifest" | tr -d '[:space:]')
if [[ ! "$manifest_size" =~ ^[0-9]+$ ]] || ((manifest_size == 0 || manifest_size > 8192)); then
  echo "SBOM 清单必须是 1–8192 字节的严格 TSV。" >&2
  exit 3
fi

line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  ((line_number += 1))
  line=${line%$'\r'}
  if ((line_number == 1)); then
    if [[ "$line" != $'component\tplatform\timage_digest\tgit_sha\tsbom_file\tsbom_sha256\tsyft_version' ]]; then
      echo "SBOM 清单表头无效。" >&2
      exit 3
    fi
    continue
  fi
  line_without_tabs=${line//$'\t'/}
  tab_count=$((${#line} - ${#line_without_tabs}))
  if ((tab_count != 6)) || [[ "$line" == $'\t'* || "$line" == *$'\t' || "$line" == *$'\t\t'* ]]; then
    printf 'SBOM 清单第 %d 行必须精确包含七个非空字段。\n' "$line_number" >&2
    exit 3
  fi
  IFS=$'\t' read -r row_component platform row_digest row_git_sha sbom_file sbom_sha row_syft <<<"$line"
  expected_platform=linux/amd64
  expected_architecture=amd64
  if ((line_number == 3)); then
    expected_platform=linux/arm64
    expected_architecture=arm64
  elif ((line_number != 2)); then
    echo "SBOM 清单必须正好包含表头和两个平台。" >&2
    exit 3
  fi
  expected_file="sbom-$component-$expected_architecture.spdx.json"
  if [[ "$row_component" != "$component" || "$platform" != "$expected_platform" || \
    "$row_digest" != "$image_digest" || "$row_git_sha" != "$git_sha" || \
    "$sbom_file" != "$expected_file" || "$row_syft" != "$syft_version" || \
    ! "$sbom_sha" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'SBOM 清单第 %d 行未绑定受审组件、平台、root digest、Git SHA、文件或 Syft 版本。\n' \
      "$line_number" >&2
    exit 3
  fi
  sbom_path="$sbom_directory/$sbom_file"
  if [[ ! -f "$sbom_path" || -L "$sbom_path" ]]; then
    printf 'SBOM 清单文件不存在或不是普通文件：%s。\n' "$sbom_file" >&2
    exit 3
  fi
  actual_sbom_sha=$("$ROOT_DIR/scripts/verify-spdx-sbom.sh" \
    --sbom "$sbom_path" --syft-version "$syft_version")
  if [[ "$actual_sbom_sha" != "$sbom_sha" ]]; then
    printf 'SBOM 文件 SHA-256 不匹配：%s。\n' "$sbom_file" >&2
    exit 3
  fi
done <"$manifest"

if ((line_number != 3)); then
  printf 'SBOM 清单必须正好包含三行，实际 %d 行。\n' "$line_number" >&2
  exit 3
fi

printf '双平台 SBOM 清单通过：component=%s image=%s gitSha=%s syft=%s\n' \
  "$component" "$image_digest" "$git_sha" "$syft_version"
