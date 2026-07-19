#!/usr/bin/env bash
set -euo pipefail

# Reproducible, redacted secret scanning for both the checked-out tree and all
# reachable Git history. The source scan is built from tracked files plus
# non-ignored untracked files so local runtime material under .gitignore (for
# example .env.production-qa, tmp/, or backups/) cannot either hide a finding
# or make a developer's scan print a real local credential.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
DOCKER_BIN=${DOCKER_BIN:-docker}
GITLEAKS_IMAGE=${GITLEAKS_IMAGE:-zricethezav/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854}
GITLEAKS_PULL_POLICY=${GITLEAKS_PULL_POLICY:-missing}

if ! git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "secret scan 必须从 Git 工作树根目录运行。" >&2
  exit 2
fi
if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  printf '找不到 Docker runtime：%s\n' "$DOCKER_BIN" >&2
  exit 127
fi
if [[ "$(git -C "$ROOT_DIR" rev-parse --is-shallow-repository 2>/dev/null || true)" == true ]]; then
  echo "拒绝扫描浅克隆：请使用 fetch-depth: 0 后再扫描完整 Git 历史。" >&2
  exit 2
fi

mkdir -p "$ROOT_DIR/tmp"
workspace=$(mktemp -d "$ROOT_DIR/tmp/gitleaks-scan.XXXXXX")
chmod 0700 "$workspace"
cleanup() {
  local cleanup_status=$?
  trap - EXIT HUP INT TERM
  rm -rf "$workspace"
  exit "$cleanup_status"
}
trap cleanup EXIT HUP INT TERM
trap 'exit 143' HUP INT TERM

stage="$workspace/source"
mkdir -p "$stage"

# Copy the exact current contents of tracked and non-ignored untracked files.
# Deleted index paths are skipped; symlinks are recreated without following
# them, matching Gitleaks' default non-following behavior.
while IFS= read -r -d '' relative_path; do
  source_path="$ROOT_DIR/$relative_path"
  if [[ ! -e "$source_path" && ! -L "$source_path" ]]; then
    continue
  fi
  destination="$stage/$relative_path"
  mkdir -p "$(dirname "$destination")"
  if [[ -L "$source_path" ]]; then
    ln -s "$(readlink "$source_path")" "$destination"
  else
    cp -pP "$source_path" "$destination"
  fi
done < <(git -C "$ROOT_DIR" ls-files --cached --others --exclude-standard -z)

stage_relative=${stage#"$ROOT_DIR"/}
if [[ -z "$stage_relative" || "$stage_relative" == "$stage" ]]; then
  echo "无法构造 secret-scan 当前树路径。" >&2
  exit 2
fi

docker_base=(
  "$DOCKER_BIN" run --rm --pull "$GITLEAKS_PULL_POLICY"
  --volume "$ROOT_DIR:/repo:ro"
  --volume "$workspace:/reports"
  --workdir /repo
  "$GITLEAKS_IMAGE"
)

run_tree_scan() {
  local report_name=$1
  local log_name=$2
  shift 2
  set +e
  "${docker_base[@]}" detect "$@" \
    --config /repo/.gitleaks.toml \
    --no-banner --no-color --redact --exit-code 1 \
    --report-format json --report-path "/reports/$report_name" \
    >"$workspace/$log_name" 2>&1
  local scan_rc=$?
  set -e
  if ((scan_rc != 0)); then
    printf 'Gitleaks %s 扫描失败（退出码 %d；日志仅含脱敏输出）。\n' \
      "$log_name" "$scan_rc" >&2
    return "$scan_rc"
  fi
  if [[ ! -s "$workspace/$report_name" ]]; then
    printf 'Gitleaks %s 扫描未生成报告，失败关闭。\n' "$log_name" >&2
    return 2
  fi
}

run_pipe_default_canary() {
  local report_name=$1
  local log_name=$2
  local canary_input=$3
  local expected_rule=$4
  set +e
  # Work in / so Gitleaks cannot discover the repository's custom config. This
  # proves the built-in generic-api-key rule itself is still active.
  printf '%s\n' "$canary_input" | "$DOCKER_BIN" run --rm --pull "$GITLEAKS_PULL_POLICY" --interactive \
    --volume "$workspace:/reports" \
    --workdir / \
    "$GITLEAKS_IMAGE" detect --pipe \
    --no-banner --no-color --redact --exit-code 1 \
    --report-format json --report-path "/reports/$report_name" \
    >"$workspace/$log_name" 2>&1
  local scan_rc=$?
  set -e
  if ((scan_rc != 1)); then
    printf 'Gitleaks default canary %s 未按预期命中（退出码 %d）。\n' \
      "$log_name" "$scan_rc" >&2
    return 1
  fi
  if [[ ! -s "$workspace/$report_name" ]] ||
    ! grep -F '"Secret": "REDACTED"' "$workspace/$report_name" >/dev/null ||
    ! grep -F "\"RuleID\": \"$expected_rule\"" "$workspace/$report_name" >/dev/null ||
    grep -F "$canary_input" "$workspace/$report_name" >/dev/null; then
    printf 'Gitleaks default canary %s 未命中期望规则或未保持脱敏，失败关闭。\n' "$log_name" >&2
    return 2
  fi
}

run_pipe_canary() {
  local report_name=$1
  local log_name=$2
  local canary_input=$3
  local expected_rule=$4
  set +e
  printf '%s\n' "$canary_input" | "$DOCKER_BIN" run --rm --pull "$GITLEAKS_PULL_POLICY" -i \
    --volume "$ROOT_DIR:/repo:ro" \
    --volume "$workspace:/reports" \
    --workdir /repo \
    "$GITLEAKS_IMAGE" detect --pipe \
    --config /repo/.gitleaks.toml \
    --no-banner --no-color --redact --exit-code 1 \
    --report-format json --report-path "/reports/$report_name" \
    >"$workspace/$log_name" 2>&1
  local scan_rc=$?
  set -e
  if ((scan_rc != 1)); then
    printf 'Gitleaks canary %s 未按预期命中（退出码 %d）。\n' \
      "$log_name" "$scan_rc" >&2
    return 1
  fi
  if [[ ! -s "$workspace/$report_name" ]] ||
    ! grep -F '"Secret": "REDACTED"' "$workspace/$report_name" >/dev/null ||
    ! grep -F '"Match": "' "$workspace/$report_name" >/dev/null ||
    ! grep -F "\"RuleID\": \"$expected_rule\"" "$workspace/$report_name" >/dev/null; then
    printf 'Gitleaks canary %s 未命中期望规则或报告缺少脱敏证据，失败关闭。\n' "$log_name" >&2
    return 2
  fi
  # A redacted report must never contain the generated canary itself.
  if grep -F "$canary_input" "$workspace/$report_name" >/dev/null; then
    printf 'Gitleaks canary %s 报告疑似包含原始输入，失败关闭。\n' "$log_name" >&2
    return 2
  fi
}

run_pipe_allowlisted() {
  local report_name=$1
  local log_name=$2
  local allowlisted_input=$3
  set +e
  printf '%s\n' "$allowlisted_input" | "$DOCKER_BIN" run --rm --pull "$GITLEAKS_PULL_POLICY" --interactive \
    --volume "$ROOT_DIR:/repo:ro" \
    --volume "$workspace:/reports" \
    --workdir /repo \
    "$GITLEAKS_IMAGE" detect --pipe \
    --config /repo/.gitleaks.toml \
    --no-banner --no-color --redact --exit-code 1 \
    --report-format json --report-path "/reports/$report_name" \
    >"$workspace/$log_name" 2>&1
  local scan_rc=$?
  set -e
  if ((scan_rc != 0)); then
    printf 'Gitleaks allowlist fixture %s 未被精确放行（退出码 %d）。\n' \
      "$log_name" "$scan_rc" >&2
    return 1
  fi
  local compact_report
  compact_report=$(tr -d '[:space:]' <"$workspace/$report_name")
  if [[ "$compact_report" != '[]' ]]; then
    printf 'Gitleaks allowlist fixture %s 报告非空或格式异常，失败关闭。\n' "$log_name" >&2
    return 2
  fi
}

run_tree_scan current-tree.json current-tree.log \
  --source "/repo/$stage_relative" --no-git
run_tree_scan history.json history.log \
  --source /repo --log-opts='--all'

# Verify that the built-in and extended generic-api-key detectors remain active;
# the suffix 3 is deliberately adjacent to (but not in) the exact allowlist.
placeholder_prefix=$(printf 'correct-horse-battery-staple-')
placeholder_suffix=3
generic_canary="password = \"$placeholder_prefix$placeholder_suffix\""
run_pipe_default_canary canary-default-generic.json canary-default-generic.log \
  "$generic_canary" generic-api-key
run_pipe_canary canary-generic.json canary-generic.log \
  "$generic_canary" generic-api-key

run_pipe_allowlisted allowlisted-doc.json allowlisted-doc.log \
  'password = "REPLACE_WITH_14_PLUS_CHARACTERS"'
run_pipe_allowlisted allowlisted-one.json allowlisted-one.log \
  'password = "correct-horse-battery-staple-1"'
run_pipe_allowlisted allowlisted-two.json allowlisted-two.log \
  'password = "correct-horse-battery-staple-2"'

printf 'Gitleaks secret scan 通过：当前树（tracked + non-ignored）、完整历史、规则启用与精确 allowlist canary 均验证；报告全程脱敏。\n'
