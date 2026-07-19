#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

usage() {
  cat <<'EOF'
用法：./scripts/verify-deployment-source.sh --expected-git-sha GIT_SHA [--root DIR]

确认部署控制器、Compose 与 bind-mounted 运维资产来自受审 commit，且没有 tracked 或
非忽略 untracked 漂移。运行时数据、备份与秘密必须位于 .gitignore 覆盖的路径。
EOF
}

expected_git_sha=""
source_root=$ROOT_DIR
while (($#)); do
  case "$1" in
    --expected-git-sha)
      expected_git_sha=${2:?--expected-git-sha 需要值}
      shift 2
      ;;
    --root)
      source_root=${2:?--root 需要目录}
      shift 2
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

if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "受审 Git SHA 必须是 40 位小写十六进制完整 commit ID。" >&2
  exit 2
fi
if [[ ! -d "$source_root" ]]; then
  echo "部署源码根目录不存在。" >&2
  exit 2
fi
source_root=$(cd "$source_root" && pwd -P)
if ! command -v git >/dev/null 2>&1; then
  echo "部署源码校验要求安装 Git。" >&2
  exit 127
fi

git_root=$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$git_root" ]]; then
  echo "部署目录不是 Git 工作树。" >&2
  exit 3
fi
git_root=$(cd "$git_root" && pwd -P)
if [[ "$git_root" != "$source_root" ]]; then
  printf '部署目录必须精确指向仓库根：期望 %s，实际 %s。\n' "$source_root" "$git_root" >&2
  exit 3
fi

actual_git_sha=$(git -C "$source_root" rev-parse --verify 'HEAD^{commit}')
if [[ "$actual_git_sha" != "$expected_git_sha" ]]; then
  printf '部署源码 Git SHA 不匹配：期望 %s，实际 %s。\n' \
    "$expected_git_sha" "$actual_git_sha" >&2
  exit 3
fi

status=$(LC_ALL=C git -C "$source_root" status --porcelain=v1 --untracked-files=all)
if [[ -n "$status" ]]; then
  echo "部署源码存在 tracked 或非忽略 untracked 漂移，拒绝继续。" >&2
  printf '%s\n' "$status" >&2
  exit 4
fi

printf '部署源码通过：gitSha=%s clean=true root=%s\n' "$actual_git_sha" "$source_root"
