#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
VERIFY_SOURCE=${FIATLUX_VERIFY_SOURCE_SCRIPT:-$ROOT_DIR/scripts/verify-deployment-source.sh}
VERIFY_IMAGES=${FIATLUX_VERIFY_IMAGES_SCRIPT:-$ROOT_DIR/scripts/verify-release-images.sh}
VERIFY_DEPLOYMENT=${FIATLUX_VERIFY_DEPLOYMENT_SCRIPT:-$ROOT_DIR/scripts/verify-deployment.sh}
DOCKER=${DOCKER_BIN:-docker}
OPENSSL=${OPENSSL_BIN:-openssl}

usage() {
  cat <<'EOF'
用法：FIATLUX_ENV=production FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env \
  ./scripts/verify-target-intranet.sh \
    --version v1.0.0-rc.1 \
    --expected-git-sha FULL_SHA \
    --release-manifest release-manifest.tsv \
    --manifest-sha256 SHA256 \
    --url https://choice.internal.example:8443 \
    --ca /etc/fiatlux-choice/caddy-root.crt \
    --report-dir /var/lib/fiatlux-choice/deployment-reports \
    --environment-id fiatlux-guangzhou-office-prod \
    --operator-identity ops-owner-01 \
    --approval-reference CHANGE-2026-0042

只读组合验证受审源码、七类发布镜像、运行容器和 HTTPS/最小权限，并在全部通过后
原子写入 mode 0600 的脱敏 JSON。它不验证真机、恢复、专业意见或批准记录真实性。
EOF
}

version=""
expected_git_sha=""
release_manifest=""
manifest_sha256=""
base_url=""
ca_file=""
report_dir=""
environment_id=""
operator_identity=""
approval_reference=""
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
    --release-manifest)
      release_manifest=${2:?--release-manifest 需要文件}
      shift 2
      ;;
    --manifest-sha256)
      manifest_sha256=${2:?--manifest-sha256 需要值}
      shift 2
      ;;
    --url)
      base_url=${2:?--url 需要值}
      shift 2
      ;;
    --ca)
      ca_file=${2:?--ca 需要文件}
      shift 2
      ;;
    --report-dir)
      report_dir=${2:?--report-dir 需要目录}
      shift 2
      ;;
    --environment-id)
      environment_id=${2:?--environment-id 需要值}
      shift 2
      ;;
    --operator-identity)
      operator_identity=${2:?--operator-identity 需要值}
      shift 2
      ;;
    --approval-reference)
      approval_reference=${2:?--approval-reference 需要值}
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

if [[ "${FIATLUX_ENV:-}" != production ]]; then
  echo "目标办公内网验收只允许在 FIATLUX_ENV=production 下运行。" >&2
  exit 2
fi
if ((${#version} > 128)) || \
  [[ ! "$version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "发布版本必须是 vMAJOR.MINOR.PATCH[-PRERELEASE]。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ || ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "目标验收要求完整小写 Git SHA 和发布清单 SHA-256。" >&2
  exit 2
fi
if [[ -z "$release_manifest" || ! -f "$release_manifest" || ! -r "$release_manifest" || -L "$release_manifest" ]]; then
  echo "发布清单必须是可读普通文件且不能是符号链接。" >&2
  exit 2
fi
if [[ ! "$base_url" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
  echo "目标 URL 必须是无路径、userinfo、query 或 fragment 的 HTTPS 内网主机。" >&2
  exit 2
fi
host_port=${base_url#https://}
host=${host_port%%:*}
if ((${#host} > 253)) || [[ "$host" == *..* ]]; then
  echo "目标 URL 主机名不是有效 DNS 名称。" >&2
  exit 2
fi
IFS=. read -r -a host_labels <<<"$host"
for host_label in "${host_labels[@]}"; do
  if [[ ! "$host_label" =~ ^[A-Za-z0-9]$ && \
    ! "$host_label" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]$ ]]; then
    echo "目标 URL 主机名不是有效 DNS 名称。" >&2
    exit 2
  fi
done
if [[ "$base_url" =~ :([0-9]+)$ ]]; then
  port=$((10#${BASH_REMATCH[1]}))
  if ((port < 1 || port > 65535)); then
    echo "目标 URL 端口必须在 1–65535 范围内。" >&2
    exit 2
  fi
fi
if [[ -z "$ca_file" || ! -f "$ca_file" || ! -r "$ca_file" || -L "$ca_file" ]]; then
  echo "目标验收要求普通文件形式的受控 CA 证书。" >&2
  exit 2
fi
if [[ "$report_dir" != /* || (-e "$report_dir" && (! -d "$report_dir" || -L "$report_dir")) ]]; then
  echo "报告目录必须是绝对普通目录且不能是符号链接。" >&2
  exit 2
fi

validate_metadata() {
  local label=$1
  local value=$2
  local length=${#value}
  if ((length < 2 || length > 200)) || LC_ALL=C grep -q '[[:cntrl:]]' <<<"$value"; then
    printf '%s 必须是 2–200 字符且不含控制字符。\n' "$label" >&2
    exit 2
  fi
}
validate_metadata environment-id "$environment_id"
validate_metadata operator-identity "$operator_identity"
validate_metadata approval-reference "$approval_reference"

for command_name in "$DOCKER" "$OPENSSL" jq sha256sum uname date mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '目标验收要求安装命令：%s。\n' "$command_name" >&2
    exit 127
  fi
done
for verifier in "$VERIFY_SOURCE" "$VERIFY_IMAGES" "$VERIFY_DEPLOYMENT"; do
  if [[ ! -f "$verifier" || ! -x "$verifier" || -L "$verifier" ]]; then
    printf '目标验收 verifier 缺失、不可执行或为符号链接：%s。\n' "$verifier" >&2
    exit 2
  fi
done

release_manifest=$(cd "$(dirname "$release_manifest")" && pwd -P)/$(basename "$release_manifest")
release_manifest_name=$(basename "$release_manifest")
actual_manifest_sha256=$(sha256sum "$release_manifest" | awk '{print $1}')
if [[ "$actual_manifest_sha256" != "$manifest_sha256" ]]; then
  printf '发布清单 SHA-256 不匹配：期望 %s，实际 %s。\n' \
    "$manifest_sha256" "$actual_manifest_sha256" >&2
  exit 3
fi

umask 077
mkdir -p "$report_dir"
chmod 700 "$report_dir"
report_dir=$(cd "$report_dir" && pwd -P)
work=$(mktemp -d "$report_dir/.target-intranet.XXXXXX")
report_partial=""
cleanup() {
  rm -rf "$work"
  if [[ -n "$report_partial" ]]; then
    rm -f -- "$report_partial"
  fi
}
trap cleanup EXIT HUP INT TERM

started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
started_epoch=$(date -u +%s)

source_output=$("$VERIFY_SOURCE" --expected-git-sha "$expected_git_sha")
printf '%s\n' "$source_output"
printf '%s\n' "$source_output" >"$work/source-check.log"

image_output=$("$VERIFY_IMAGES" \
  --version "$version" \
  --expected-git-sha "$expected_git_sha" \
  --manifest "$release_manifest" \
  --manifest-sha256 "$manifest_sha256" \
  --check-running-services)
printf '%s\n' "$image_output"
printf '%s\n' "$image_output" >"$work/image-check.log"

deployment_output=$("$VERIFY_DEPLOYMENT" --url "$base_url" --ca "$ca_file")
printf '%s\n' "$deployment_output"
printf '%s\n' "$deployment_output" >"$work/deployment-check.log"

docker_server_version=$("$DOCKER" version --format '{{.Server.Version}}')
compose_version=$("$DOCKER" compose version --short)
ca_fingerprint_sha256=$("$OPENSSL" x509 -in "$ca_file" -outform DER | sha256sum | awk '{print $1}')
if [[ ! "$ca_fingerprint_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "无法生成目标 CA DER SHA-256。" >&2
  exit 4
fi

finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date -u +%s)
duration_seconds=$((finished_epoch - started_epoch))
source_output_sha256=$(sha256sum "$work/source-check.log" | awk '{print $1}')
image_output_sha256=$(sha256sum "$work/image-check.log" | awk '{print $1}')
deployment_output_sha256=$(sha256sum "$work/deployment-check.log" | awk '{print $1}')
report_name="target-intranet-${finished_at//[:T-]/}-${expected_git_sha:0:7}.json"
report_partial="$report_dir/.$report_name.partial.$$"
report_path="$report_dir/$report_name"
if [[ -e "$report_path" || -L "$report_path" || -e "$report_partial" || -L "$report_partial" ]]; then
  echo "目标验收报告路径已存在，拒绝覆盖。" >&2
  exit 5
fi

jq -n \
  --arg generatedAt "$finished_at" \
  --arg startedAt "$started_at" \
  --arg finishedAt "$finished_at" \
  --arg environmentId "$environment_id" \
  --arg operatorIdentity "$operator_identity" \
  --arg approvalReference "$approval_reference" \
  --arg version "$version" \
  --arg gitSha "$expected_git_sha" \
  --arg manifestFile "$release_manifest_name" \
  --arg manifestSha256 "$manifest_sha256" \
  --arg baseUrl "$base_url" \
  --arg caFingerprintSha256 "$ca_fingerprint_sha256" \
  --arg os "$(uname -s)" \
  --arg architecture "$(uname -m)" \
  --arg dockerServerVersion "$docker_server_version" \
  --arg composeVersion "$compose_version" \
  --arg sourceOutputSha256 "$source_output_sha256" \
  --arg imageOutputSha256 "$image_output_sha256" \
  --arg deploymentOutputSha256 "$deployment_output_sha256" \
  --argjson durationSeconds "$duration_seconds" \
  '{
    schemaVersion: 1,
    evidenceType: "target_intranet_deployment_verification",
    generatedAt: $generatedAt,
    result: "success",
    environment: {
      environmentId: $environmentId,
      classification: "target_intranet",
      baseUrl: $baseUrl,
      caFingerprintSha256: $caFingerprintSha256,
      os: $os,
      architecture: $architecture,
      dockerServerVersion: $dockerServerVersion,
      composeVersion: $composeVersion
    },
    candidate: {
      version: $version,
      gitSha: $gitSha,
      releaseManifestFile: $manifestFile,
      releaseManifestSha256: $manifestSha256
    },
    execution: {
      startedAt: $startedAt,
      finishedAt: $finishedAt,
      durationSeconds: $durationSeconds,
      operatorIdentity: $operatorIdentity,
      assertedApprovalReference: $approvalReference,
      approvalIndependentlyVerified: false
    },
    checks: {
      cleanSourceBoundToGitSha: true,
      sevenReleaseDigestsAndRunningImages: true,
      serviceHealthAndRuntimeLeastPrivilege: true,
      httpsWithApprovedCa: true,
      sourceOutputSha256: $sourceOutputSha256,
      imageOutputSha256: $imageOutputSha256,
      deploymentOutputSha256: $deploymentOutputSha256
    },
    boundaries: [
      "The approval reference is operator-supplied and must be verified through an independent approval channel.",
      "This report does not prove firewall policy, managed-device PWA installation, backup restore, real adapters, professional review or business release approval.",
      "This verifier performs read-only checks and does not deploy, restart, migrate, restore or mutate external systems."
    ]
  }' >"$report_partial"
chmod 600 "$report_partial"
mv "$report_partial" "$report_path"
report_partial=""
report_sha256=$(sha256sum "$report_path" | awk '{print $1}')
printf '目标办公内网机器验收通过：report=%s sha256=%s\n' "$report_path" "$report_sha256"
