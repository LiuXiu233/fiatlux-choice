#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：./scripts/verify-buildkit-provenance.sh \
       --registry-image ghcr.io/OWNER/IMAGE \
       --image-digest sha256:... \
       --expected-git-sha 40_HEX_SHA

从 OCI registry 读取多架构 image index、BuildKit attestation manifest 与
in-toto provenance blob，验证 linux/amd64、linux/arm64 的 descriptor 绑定、
内容摘要、SLSA subject 与受审 Git SHA。

默认 registry 客户端目前只允许 ghcr.io，并从 OCI_REGISTRY_USERNAME 与
OCI_REGISTRY_PASSWORD 读取凭据。测试可通过 FIATLUX_OCI_FETCH_BIN 注入只读
fixture fetcher；生产发布工作流不得设置该变量。
EOF
}

registry_image=""
image_digest=""
expected_git_sha=""
while (($#)); do
  case "$1" in
    --registry-image)
      registry_image=${2:?--registry-image 需要值}
      shift 2
      ;;
    --image-digest)
      image_digest=${2:?--image-digest 需要值}
      shift 2
      ;;
    --expected-git-sha)
      expected_git_sha=${2:?--expected-git-sha 需要值}
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

if [[ ! "$registry_image" =~ ^([a-z0-9.-]+)/(.*)$ ]]; then
  echo "registry image 必须包含合法的小写 registry host 与 repository。" >&2
  exit 2
fi
registry_host=${BASH_REMATCH[1]}
repository=${BASH_REMATCH[2]}
if [[ -z "$repository" || "$repository" == */ || "$repository" == *:* || \
  ! "$repository" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*$ ]]; then
  echo "registry repository 格式无效；不得包含 tag 或 digest。" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "image digest 必须是 sha256: 加 64 位小写十六进制。" >&2
  exit 2
fi
if [[ ! "$expected_git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "受审 Git SHA 必须是 40 位小写十六进制完整 commit ID。" >&2
  exit 2
fi
for command_name in awk jq sha256sum wc tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '来源证明校验要求安装 %s。\n' "$command_name" >&2
    exit 127
  fi
done

work=$(mktemp -d)
chmod 0700 "$work"
umask 077
registry_bearer_token=""
cleanup() {
  registry_bearer_token=""
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

custom_fetcher=${FIATLUX_OCI_FETCH_BIN:-}
if [[ -n "$custom_fetcher" ]]; then
  if [[ ! -f "$custom_fetcher" || ! -x "$custom_fetcher" || -L "$custom_fetcher" ]]; then
    echo "FIATLUX_OCI_FETCH_BIN 必须是可执行的普通文件，且不能是符号链接。" >&2
    exit 2
  fi
else
  if [[ "$registry_host" != ghcr.io ]]; then
    echo "默认来源证明客户端只允许 ghcr.io。" >&2
    exit 2
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "来源证明 registry 校验要求安装 curl。" >&2
    exit 127
  fi
  registry_username=${OCI_REGISTRY_USERNAME:-}
  registry_password=${OCI_REGISTRY_PASSWORD:-}
  if [[ -z "$registry_username" || -z "$registry_password" ]]; then
    echo "ghcr.io 校验要求设置 OCI_REGISTRY_USERNAME 与 OCI_REGISTRY_PASSWORD。" >&2
    exit 2
  fi
  if [[ ! "$registry_username" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ || \
    ! "$registry_password" =~ ^[A-Za-z0-9_=-]{20,512}$ ]]; then
    echo "ghcr.io 用户名或令牌包含 curl config 不允许的字符。" >&2
    exit 2
  fi
  token_response="$work/token.json"
  token_curl_config="$work/token.curlrc"
  printf 'user = "%s:%s"\n' "$registry_username" "$registry_password" >"$token_curl_config"
  chmod 0600 "$token_curl_config"
  curl --fail --silent --show-error \
    --config "$token_curl_config" \
    --proto '=https' \
    --connect-timeout 15 \
    --max-time 60 \
    --max-filesize 1048576 \
    --retry 2 \
    --output "$token_response" \
    "https://ghcr.io/token?service=ghcr.io&scope=repository:$repository:pull"
  registry_bearer_token=$(jq -er '.token | select(type == "string" and length > 0)' "$token_response")
  rm -f "$token_response" "$token_curl_config"
  registry_password=""
  if [[ ! "$registry_bearer_token" =~ ^[A-Za-z0-9._~-]+={0,2}$ ]]; then
    echo "ghcr.io 返回了格式无效的 bearer token。" >&2
    exit 3
  fi
  registry_curl_config="$work/registry.curlrc"
  printf 'header = "Authorization: Bearer %s"\n' "$registry_bearer_token" >"$registry_curl_config"
  chmod 0600 "$registry_curl_config"
fi

fetch_oci_object() {
  local kind=$1
  local reference=$2
  local destination=$3
  local accept
  local url
  local max_size

  if [[ "$kind" != manifest && "$kind" != blob ]]; then
    printf '内部错误：未知 OCI 对象类型 %s。\n' "$kind" >&2
    return 2
  fi
  if [[ ! "$reference" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '拒绝获取格式无效的 OCI %s digest。\n' "$kind" >&2
    return 2
  fi
  if [[ -n "$custom_fetcher" ]]; then
    "$custom_fetcher" "$kind" "$repository" "$reference" "$destination"
    return
  fi

  if [[ "$kind" == manifest ]]; then
    accept='application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json'
    url="https://$registry_host/v2/$repository/manifests/$reference"
    max_size=4194304
  else
    accept='application/vnd.in-toto+json, application/octet-stream'
    url="https://$registry_host/v2/$repository/blobs/$reference"
    max_size=16777216
  fi
  curl --fail --silent --show-error --location \
    --config "$registry_curl_config" \
    --proto '=https' \
    --proto-redir '=https' \
    --max-redirs 3 \
    --connect-timeout 15 \
    --max-time 120 \
    --max-filesize "$max_size" \
    --retry 2 \
    --retry-all-errors \
    --header "Accept: $accept" \
    --output "$destination" \
    "$url"
}

verify_content_digest() {
  local file=$1
  local expected=$2
  local label=$3
  local actual
  actual="sha256:$(sha256sum "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s 内容摘要不匹配：期望 %s，实际 %s。\n' "$label" "$expected" "$actual" >&2
    return 3
  fi
}

verify_nonempty_size() {
  local file=$1
  local maximum=$2
  local label=$3
  local size
  size=$(wc -c <"$file" | tr -d '[:space:]')
  if [[ ! "$size" =~ ^[0-9]+$ ]] || ((size == 0 || size > maximum)); then
    printf '%s 必须是 1–%d 字节的普通内容。\n' "$label" "$maximum" >&2
    return 3
  fi
}

index_file="$work/index.json"
fetch_oci_object manifest "$image_digest" "$index_file"
verify_nonempty_size "$index_file" 4194304 "image index"
verify_content_digest "$index_file" "$image_digest" "image index"
if ! jq -e '
  .schemaVersion == 2 and
  .mediaType == "application/vnd.oci.image.index.v1+json" and
  (.manifests | type == "array") and
  ([.manifests[]? |
    select((.annotations["vnd.docker.reference.type"] // "") != "attestation-manifest")
  ] | length) == 2 and
  ([.manifests[]? |
    select(.mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .platform.os == "linux" and .platform.architecture == "amd64")
  ] | length) == 1 and
  ([.manifests[]? |
    select(.mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .platform.os == "linux" and .platform.architecture == "arm64")
  ] | length) == 1
' "$index_file" >/dev/null; then
  echo "image index 必须精确包含 linux/amd64 与 linux/arm64 两个可运行 OCI manifest。" >&2
  exit 3
fi

predicate_type='https://slsa.dev/provenance/v0.2'
statement_type='https://in-toto.io/Statement/v1'
buildkit_metadata_key='https://mobyproject.org/buildkit@v1#metadata'

for architecture in amd64 arm64; do
  platform_digest=$(jq -er --arg architecture "$architecture" '
    .manifests[] |
    select(.mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .platform.os == "linux" and .platform.architecture == $architecture) |
    .digest
  ' "$index_file")
  if [[ ! "$platform_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf 'linux/%s platform digest 格式无效。\n' "$architecture" >&2
    exit 3
  fi

  attestation_rows=()
  while IFS= read -r attestation_row; do
    attestation_rows[${#attestation_rows[@]}]=$attestation_row
  done < <(jq -r --arg platform_digest "$platform_digest" '
    .manifests[]? |
    select(
      .mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .platform.os == "unknown" and .platform.architecture == "unknown" and
      .annotations["vnd.docker.reference.type"] == "attestation-manifest" and
      .annotations["vnd.docker.reference.digest"] == $platform_digest
    ) |
    [.digest, (.size | tostring)] | @tsv
  ' "$index_file")
  if ((${#attestation_rows[@]} != 1)); then
    printf 'linux/%s platform manifest %s 必须恰好绑定一个 BuildKit attestation manifest。\n' \
      "$architecture" "$platform_digest" >&2
    exit 3
  fi
  IFS=$'\t' read -r attestation_digest attestation_size <<<"${attestation_rows[0]}"
  if [[ ! "$attestation_digest" =~ ^sha256:[0-9a-f]{64}$ || \
    ! "$attestation_size" =~ ^[0-9]+$ || "$attestation_size" == 0 ]]; then
    printf 'linux/%s attestation descriptor 无效。\n' "$architecture" >&2
    exit 3
  fi

  attestation_file="$work/attestation-$architecture.json"
  fetch_oci_object manifest "$attestation_digest" "$attestation_file"
  verify_nonempty_size "$attestation_file" 4194304 "linux/$architecture attestation manifest"
  verify_content_digest "$attestation_file" "$attestation_digest" "linux/$architecture attestation manifest"
  actual_attestation_size=$(wc -c <"$attestation_file" | tr -d '[:space:]')
  if [[ "$actual_attestation_size" != "$attestation_size" ]]; then
    printf 'linux/%s attestation manifest size 不匹配：descriptor=%s actual=%s。\n' \
      "$architecture" "$attestation_size" "$actual_attestation_size" >&2
    exit 3
  fi
  if ! jq -e '
    .schemaVersion == 2 and
    .mediaType == "application/vnd.oci.image.manifest.v1+json" and
    (.layers | type == "array")
  ' "$attestation_file" >/dev/null; then
    printf 'linux/%s attestation manifest 不是合法 OCI image manifest。\n' "$architecture" >&2
    exit 3
  fi

  provenance_rows=()
  while IFS= read -r provenance_row; do
    provenance_rows[${#provenance_rows[@]}]=$provenance_row
  done < <(jq -r --arg predicate_type "$predicate_type" '
    .layers[]? |
    select(
      .mediaType == "application/vnd.in-toto+json" and
      .annotations["in-toto.io/predicate-type"] == $predicate_type
    ) |
    [.digest, (.size | tostring)] | @tsv
  ' "$attestation_file")
  if ((${#provenance_rows[@]} != 1)); then
    printf 'linux/%s attestation manifest 必须恰好包含一个 SLSA v0.2 in-toto layer。\n' \
      "$architecture" >&2
    exit 3
  fi
  IFS=$'\t' read -r provenance_digest provenance_size <<<"${provenance_rows[0]}"
  if [[ ! "$provenance_digest" =~ ^sha256:[0-9a-f]{64}$ || \
    ! "$provenance_size" =~ ^[0-9]+$ || "$provenance_size" == 0 ]]; then
    printf 'linux/%s provenance layer descriptor 无效。\n' "$architecture" >&2
    exit 3
  fi

  provenance_file="$work/provenance-$architecture.json"
  fetch_oci_object blob "$provenance_digest" "$provenance_file"
  verify_nonempty_size "$provenance_file" 16777216 "linux/$architecture provenance blob"
  verify_content_digest "$provenance_file" "$provenance_digest" "linux/$architecture provenance blob"
  actual_provenance_size=$(wc -c <"$provenance_file" | tr -d '[:space:]')
  if [[ "$actual_provenance_size" != "$provenance_size" ]]; then
    printf 'linux/%s provenance blob size 不匹配：descriptor=%s actual=%s。\n' \
      "$architecture" "$provenance_size" "$actual_provenance_size" >&2
    exit 3
  fi

  platform_hex=${platform_digest#sha256:}
  if ! jq -e \
    --arg statement_type "$statement_type" \
    --arg predicate_type "$predicate_type" \
    --arg platform_hex "$platform_hex" \
    --arg expected_git_sha "$expected_git_sha" \
    --arg metadata_key "$buildkit_metadata_key" '
      ._type == $statement_type and
      .predicateType == $predicate_type and
      (.subject | type == "array") and
      any(.subject[]?;
        (.digest | type == "object") and .digest.sha256 == $platform_hex
      ) and
      .predicate.buildType == "https://mobyproject.org/buildkit@v1" and
      .predicate.metadata[$metadata_key].vcs.revision == $expected_git_sha
    ' "$provenance_file" >/dev/null; then
    printf 'linux/%s provenance 未同时绑定正确的 in-toto 类型、SLSA predicate、平台 subject 与受审 Git SHA。\n' \
      "$architecture" >&2
    exit 3
  fi
  printf 'BuildKit provenance 通过：linux/%s subject=%s gitSha=%s\n' \
    "$architecture" "$platform_digest" "$expected_git_sha"
done

printf '多架构 BuildKit provenance 完整通过：image=%s@%s platforms=2\n' \
  "$registry_image" "$image_digest"
