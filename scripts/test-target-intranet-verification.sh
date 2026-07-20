#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SUBJECT="$ROOT_DIR/scripts/verify-target-intranet.sh"
work=$(mktemp -d "$ROOT_DIR/tmp/target-intranet-test.XXXXXX")
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$work/bin" "$work/fail-bin" "$work/reports"

manifest="$work/release-manifest.tsv"
printf '%s\n' 'version git_sha component digest fixture' >"$manifest"
manifest_sha256=$(sha256sum "$manifest" | awk '{print $1}')
ca_file="$work/caddy-root.crt"
printf '%s\n' 'fixture-ca' >"$ca_file"
expected_git_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
version=v1.0.0-rc.1
base_url=https://choice.internal.example:8443

cat >"$work/bin/verify-source" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 && "$1" == --expected-git-sha && "$2" == "$EXPECTED_GIT_SHA" ]]
if [[ "${FAIL_SOURCE:-false}" == true ]]; then
  echo "forced source failure" >&2
  exit 7
fi
echo "source-ok:$2"
EOF

cat >"$work/bin/verify-images" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 9 ]]
[[ "$1" == --version && "$2" == "$EXPECTED_VERSION" ]]
[[ "$3" == --expected-git-sha && "$4" == "$EXPECTED_GIT_SHA" ]]
[[ "$5" == --manifest && "$6" == "$EXPECTED_MANIFEST" ]]
[[ "$7" == --manifest-sha256 && "$8" == "$EXPECTED_MANIFEST_SHA256" ]]
[[ "$9" == --check-running-services ]]
if [[ "${FAIL_IMAGES:-false}" == true ]]; then
  echo "forced image failure" >&2
  exit 8
fi
echo "images-ok:7:$2"
EOF

cat >"$work/bin/verify-deployment" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 && "$1" == --url && "$2" == "$EXPECTED_URL" ]]
[[ "$3" == --ca && "$4" == "$EXPECTED_CA" ]]
if [[ "${FAIL_DEPLOYMENT:-false}" == true ]]; then
  echo "forced deployment failure" >&2
  exit 9
fi
echo "deployment-ok:$2"
EOF

cat >"$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == version && "$2" == --format ]]; then
  echo "27.5.1"
elif [[ "$1" == compose && "$2" == version && "$3" == --short ]]; then
  echo "2.35.1"
else
  printf 'unexpected docker args: %s\n' "$*" >&2
  exit 2
fi
EOF

cat >"$work/bin/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == x509 && "$2" == -in && "$4" == -outform && "$5" == DER ]]
printf '%s' 'fixture-ca-der'
EOF

cat >"$work/bin/date" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  '-u +%Y-%m-%dT%H:%M:%SZ')
    echo '2026-07-20T05:15:42Z'
    ;;
  '-u +%s')
    echo '1784524542'
    ;;
  *)
    printf 'unexpected date args: %s\n' "$*" >&2
    exit 2
    ;;
esac
EOF

cat >"$work/fail-bin/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '{"incomplete":'
exit 11
EOF

chmod 0755 "$work/bin/verify-source" "$work/bin/verify-images" \
  "$work/bin/verify-deployment" "$work/bin/docker" "$work/bin/openssl" \
  "$work/bin/date" "$work/fail-bin/jq"

run_subject() {
  local report_dir=$1
  local target_url=${SUBJECT_URL:-$base_url}
  shift
  FIATLUX_ENV=production \
    FIATLUX_VERIFY_SOURCE_SCRIPT="$work/bin/verify-source" \
    FIATLUX_VERIFY_IMAGES_SCRIPT="$work/bin/verify-images" \
    FIATLUX_VERIFY_DEPLOYMENT_SCRIPT="$work/bin/verify-deployment" \
    DOCKER_BIN="$work/bin/docker" \
    OPENSSL_BIN="$work/bin/openssl" \
    EXPECTED_GIT_SHA="$expected_git_sha" \
    EXPECTED_VERSION="$version" \
    EXPECTED_MANIFEST="$manifest" \
    EXPECTED_MANIFEST_SHA256="$manifest_sha256" \
    EXPECTED_URL="$target_url" \
    EXPECTED_CA="$ca_file" \
    PATH="$work/bin:$PATH" \
    "$@" "$SUBJECT" \
      --version "$version" \
      --expected-git-sha "$expected_git_sha" \
      --release-manifest "$manifest" \
      --manifest-sha256 "$manifest_sha256" \
      --url "$target_url" \
      --ca "$ca_file" \
      --report-dir "$report_dir" \
      --environment-id fiatlux-guangzhou-office-prod \
      --operator-identity ops-owner-01 \
      --approval-reference CHANGE-2026-0042
}

success_output=$(run_subject "$work/reports")
printf '%s\n' "$success_output"
report=$(find "$work/reports" -maxdepth 1 -type f -name 'target-intranet-*.json' -print -quit)
if [[ -z "$report" || -L "$report" ]]; then
  echo "目标验收成功后未生成普通 JSON 报告。" >&2
  exit 1
fi
expected_ca_sha256=$(printf '%s' 'fixture-ca-der' | sha256sum | awk '{print $1}')
expected_source_sha256=$(printf '%s\n' "source-ok:$expected_git_sha" | sha256sum | awk '{print $1}')
expected_image_sha256=$(printf '%s\n' "images-ok:7:$version" | sha256sum | awk '{print $1}')
expected_deployment_sha256=$(printf '%s\n' "deployment-ok:$base_url" | sha256sum | awk '{print $1}')
jq -e \
  --arg gitSha "$expected_git_sha" \
  --arg manifestSha256 "$manifest_sha256" \
  --arg caSha256 "$expected_ca_sha256" \
  --arg sourceSha256 "$expected_source_sha256" \
  --arg imageSha256 "$expected_image_sha256" \
  --arg deploymentSha256 "$expected_deployment_sha256" '
    .schemaVersion == 1 and
    .evidenceType == "target_intranet_deployment_verification" and
    .generatedAt == "2026-07-20T05:15:42Z" and
    .result == "success" and
    .candidate.gitSha == $gitSha and
    .candidate.releaseManifestFile == "release-manifest.tsv" and
    .candidate.releaseManifestSha256 == $manifestSha256 and
    .environment.classification == "target_intranet" and
    .environment.environmentId == "fiatlux-guangzhou-office-prod" and
    .environment.baseUrl == "https://choice.internal.example:8443" and
    .environment.caFingerprintSha256 == $caSha256 and
    .environment.dockerServerVersion == "27.5.1" and
    .environment.composeVersion == "2.35.1" and
    .checks.cleanSourceBoundToGitSha == true and
    .checks.sevenReleaseDigestsAndRunningImages == true and
    .checks.serviceHealthAndRuntimeLeastPrivilege == true and
    .checks.httpsWithApprovedCa == true and
    .checks.sourceOutputSha256 == $sourceSha256 and
    .checks.imageOutputSha256 == $imageSha256 and
    .checks.deploymentOutputSha256 == $deploymentSha256 and
    .execution.operatorIdentity == "ops-owner-01" and
    .execution.assertedApprovalReference == "CHANGE-2026-0042" and
    .execution.approvalIndependentlyVerified == false and
    (.boundaries | length) == 3
  ' "$report" >/dev/null

report_mode=$(stat -c '%a' "$report" 2>/dev/null || stat -f '%Lp' "$report")
if [[ "$report_mode" != 600 ]]; then
  printf '目标验收报告权限必须是 600，实际 %s。\n' "$report_mode" >&2
  exit 1
fi
report_dir_mode=$(stat -c '%a' "$work/reports" 2>/dev/null || stat -f '%Lp' "$work/reports")
if [[ "$report_dir_mode" != 700 ]]; then
  printf '目标验收报告目录权限必须是 700，实际 %s。\n' "$report_dir_mode" >&2
  exit 1
fi

assert_no_report_artifacts() {
  local target_dir=$1
  local label=$2
  if [[ -d "$target_dir" ]] && \
    find "$target_dir" -maxdepth 1 -type f \
      \( -name 'target-intranet-*.json' -o -name '.*.partial.*' \) -print -quit | grep -q .; then
    printf '%s 不得留下成功 JSON 或 partial 文件。\n' "$label" >&2
    exit 1
  fi
}

original_report_sha256=$(sha256sum "$report" | awk '{print $1}')
if run_subject "$work/reports" >/dev/null 2>&1; then
  echo "同名目标验收报告不得被覆盖。" >&2
  exit 1
fi
if [[ "$(sha256sum "$report" | awk '{print $1}')" != "$original_report_sha256" ]]; then
  echo "重复验收尝试修改了既有报告。" >&2
  exit 1
fi
if find "$work/reports" -maxdepth 1 -type f -name '.*.partial.*' -print -quit | grep -q .; then
  echo "重复验收失败后遗留 partial 文件。" >&2
  exit 1
fi

wrong_hash_dir="$work/wrong-hash"
if FIATLUX_ENV=production \
  FIATLUX_VERIFY_SOURCE_SCRIPT="$work/bin/verify-source" \
  FIATLUX_VERIFY_IMAGES_SCRIPT="$work/bin/verify-images" \
  FIATLUX_VERIFY_DEPLOYMENT_SCRIPT="$work/bin/verify-deployment" \
  DOCKER_BIN="$work/bin/docker" OPENSSL_BIN="$work/bin/openssl" \
  "$SUBJECT" --version "$version" --expected-git-sha "$expected_git_sha" \
    --release-manifest "$manifest" --manifest-sha256 "$(printf '0%.0s' {1..64})" \
    --url "$base_url" --ca "$ca_file" --report-dir "$wrong_hash_dir" \
    --environment-id target-prod --operator-identity operator-01 \
    --approval-reference CHANGE-FAIL >/dev/null 2>&1; then
  echo "错误发布清单 SHA-256 不得通过。" >&2
  exit 1
fi
assert_no_report_artifacts "$wrong_hash_dir" "错误清单"

assert_verifier_failure() {
  local slug=$1
  local failure_assignment=$2
  local label=$3
  local target_dir="$work/failed-$slug"
  if run_subject "$target_dir" env "$failure_assignment" >/dev/null 2>&1; then
    printf '%s 失败不得通过。\n' "$label" >&2
    exit 1
  fi
  assert_no_report_artifacts "$target_dir" "$label"
}
assert_verifier_failure source FAIL_SOURCE=true "受审源码验证"
assert_verifier_failure images FAIL_IMAGES=true "镜像与运行容器验证"
assert_verifier_failure deployment FAIL_DEPLOYMENT=true "HTTPS 与最小权限验证"

jq_failure_dir="$work/failed-jq"
if run_subject "$jq_failure_dir" \
  env PATH="$work/fail-bin:$work/bin:$PATH" >/dev/null 2>&1; then
  echo "JSON 生成失败不得通过。" >&2
  exit 1
fi
assert_no_report_artifacts "$jq_failure_dir" "JSON 原子生成失败"

assert_invalid_url() {
  local slug=$1
  local candidate_url=$2
  local target_dir="$work/invalid-url-$slug"
  if SUBJECT_URL="$candidate_url" run_subject "$target_dir" >/dev/null 2>&1; then
    printf '非法目标 URL 被接受：%s。\n' "$candidate_url" >&2
    exit 1
  fi
  assert_no_report_artifacts "$target_dir" "非法目标 URL"
}
assert_invalid_url scheme http://choice.internal.example:8443
assert_invalid_url path https://choice.internal.example:8443/health
assert_invalid_url low-port https://choice.internal.example:0
assert_invalid_url high-port https://choice.internal.example:65536
assert_invalid_url empty-label https://choice..internal.example:8443
assert_invalid_url invalid-label https://choice.-internal.example:8443

max_port_dir="$work/max-port"
SUBJECT_URL=https://choice.internal.example:65535 run_subject "$max_port_dir" >/dev/null
if ! jq -e '.environment.baseUrl == "https://choice.internal.example:65535"' \
  "$max_port_dir/target-intranet-20260720051542Z-aaaaaaa.json" >/dev/null; then
  echo "合法最大端口未写入目标验收报告。" >&2
  exit 1
fi

mkdir -p "$work/report-link-target"
ln -s "$work/report-link-target" "$work/report-link"
if run_subject "$work/report-link" >/dev/null 2>&1; then
  echo "符号链接报告目录不得通过。" >&2
  exit 1
fi
assert_no_report_artifacts "$work/report-link-target" "符号链接报告目录"

FIATLUX_ENV=development "$SUBJECT" --help >/dev/null
if FIATLUX_ENV=development \
  "$SUBJECT" --version "$version" --expected-git-sha "$expected_git_sha" \
    --release-manifest "$manifest" --manifest-sha256 "$manifest_sha256" \
    --url "$base_url" --ca "$ca_file" --report-dir "$work/development" \
    --environment-id target-prod --operator-identity operator-01 \
    --approval-reference CHANGE-FAIL >/dev/null 2>&1; then
  echo "非 production 环境不得生成目标办公内网成功报告。" >&2
  exit 1
fi

echo "目标办公内网验收包装器正负向测试通过。"
