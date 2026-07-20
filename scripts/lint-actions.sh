#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

ACTIONLINT_VERSION=1.7.12
ACTIONLINT_IMAGE='docker.io/rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667'
shopt -s nullglob
workflow_files=(.github/workflows/*.yml .github/workflows/*.yaml)
if ((${#workflow_files[@]} == 0)); then
  echo "未找到 GitHub Actions workflow。" >&2
  exit 2
fi

if command -v actionlint >/dev/null 2>&1; then
  actual_version=$(actionlint -version | sed -n '1p')
  if [[ "$actual_version" != "$ACTIONLINT_VERSION" ]]; then
    printf 'actionlint 版本不匹配：期望 %s，实际 %s。\n' \
      "$ACTIONLINT_VERSION" "${actual_version:-unknown}" >&2
    exit 2
  fi
  exec actionlint "${workflow_files[@]}"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 actionlint $ACTIONLINT_VERSION 或 Docker，无法校验 GitHub Actions。" >&2
  exit 2
fi

exec docker run --rm --pull missing \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --volume "$ROOT_DIR:/repo:ro" \
  --workdir /repo \
  "$ACTIONLINT_IMAGE" \
  "${workflow_files[@]}"
