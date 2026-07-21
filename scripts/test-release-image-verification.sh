#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
workspace=$(mktemp -d)
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT HUP INT TERM

dockerfiles=(
  Dockerfile.api
  Dockerfile.worker
  Dockerfile.web
  Dockerfile.caddy
  Dockerfile.minio
  Dockerfile.backup
  Dockerfile.postgres
)
expected_frontend='# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12'
verify_dockerfile_supply_chain_pins() {
  local directory=$1
  local dockerfile
  local first_line
  local final_user
  local from_line
  local build_from
  local runtime_from
  for dockerfile in "${dockerfiles[@]}"; do
    if [[ ! -f "$directory/$dockerfile" || -L "$directory/$dockerfile" ]]; then
      printf '缺少普通 Dockerfile：%s。\n' "$dockerfile" >&2
      return 1
    fi
    IFS= read -r first_line <"$directory/$dockerfile"
    if [[ "$first_line" != "$expected_frontend" ]]; then
      printf 'Dockerfile frontend 未绑定受审版本与 index digest：%s。\n' "$dockerfile" >&2
      return 1
    fi
    while IFS= read -r from_line; do
      if [[ ! "$from_line" =~ @sha256:[0-9a-f]{64}([[:space:]]|$) ]]; then
        printf 'Dockerfile FROM 未绑定 sha256：%s：%s。\n' "$dockerfile" "$from_line" >&2
        return 1
      fi
    done < <(awk '/^FROM / {print}' "$directory/$dockerfile")
    final_user=$(awk '/^FROM / {user = ""} /^USER / {user = $2} END {print user}' "$directory/$dockerfile")
    if [[ -z "$final_user" || "$final_user" == root || "$final_user" == 0 || "$final_user" == 0:0 ]]; then
      printf 'Dockerfile 最终 stage 必须声明非 root USER：%s。\n' "$dockerfile" >&2
      return 1
    fi
    case "$dockerfile" in
      Dockerfile.api | Dockerfile.worker)
        build_from=$(awk '/^FROM .* AS build$/ {print}' "$directory/$dockerfile")
        runtime_from=$(awk '/^FROM .* AS runtime$/ {print}' "$directory/$dockerfile")
        if [[ "$build_from" != "FROM --platform=\$BUILDPLATFORM "* ]]; then
          printf 'API/worker build stage 必须固定为 BUILDPLATFORM，避免跨架构执行 Node：%s。\n' \
            "$dockerfile" >&2
          return 1
        fi
        if [[ "$runtime_from" == *'--platform='* || "$runtime_from" != 'FROM node:'* ]]; then
          printf 'API/worker runtime stage 必须保持 target platform，不能固定 BUILDPLATFORM：%s。\n' \
            "$dockerfile" >&2
          return 1
        fi
        ;;
      Dockerfile.web)
        if ! grep -qx 'ARG FIATLUX_RELEASE_VERSION=development' "$directory/$dockerfile" || \
          ! grep -qx 'ARG FIATLUX_RELEASE_GIT_SHA=development' "$directory/$dockerfile" || \
          ! grep -Fq "VITE_RELEASE_VERSION=\"\$FIATLUX_RELEASE_VERSION\"" \
            "$directory/$dockerfile" || \
          ! grep -Fq "VITE_RELEASE_GIT_SHA=\"\$FIATLUX_RELEASE_GIT_SHA\"" \
            "$directory/$dockerfile" || \
          ! grep -Fq 'RUN chmod -R a-w /srv /etc/caddy/Caddyfile' "$directory/$dockerfile" || \
          ! grep -Fq "development|local) test \"\$FIATLUX_RELEASE_GIT_SHA\" = development" \
            "$directory/$dockerfile" || \
          ! grep -Fq "ci|v*) printf '%s' \"\$FIATLUX_RELEASE_GIT_SHA\"" \
            "$directory/$dockerfile"; then
          echo "Web Dockerfile 必须把发布版本和完整 Git SHA 注入可见 PWA 构建身份。" >&2
          return 1
        fi
        ;;
    esac
  done
}
verify_dockerfile_supply_chain_pins "$ROOT_DIR"

dockerfile_fixture="$workspace/dockerfiles"
mkdir -p "$dockerfile_fixture"
for dockerfile in "${dockerfiles[@]}"; do
  cp "$ROOT_DIR/$dockerfile" "$dockerfile_fixture/$dockerfile"
done
sed '1s/@sha256:.*$//' "$ROOT_DIR/Dockerfile.api" >"$dockerfile_fixture/Dockerfile.api"
if verify_dockerfile_supply_chain_pins "$dockerfile_fixture" >/dev/null 2>&1; then
  echo "Dockerfile 负向测试失败：无 digest frontend 被接受。" >&2
  exit 1
fi
cp "$ROOT_DIR/Dockerfile.worker" "$dockerfile_fixture/Dockerfile.worker"
sed "s/^FROM --platform=\\\$BUILDPLATFORM \(node:.* AS build\)$/FROM \1/" \
  "$ROOT_DIR/Dockerfile.api" >"$dockerfile_fixture/Dockerfile.api"
if verify_dockerfile_supply_chain_pins "$dockerfile_fixture" >/dev/null 2>&1; then
  echo "Dockerfile 负向测试失败：API build stage 未固定 BUILDPLATFORM 仍被接受。" >&2
  exit 1
fi
cp "$ROOT_DIR/Dockerfile.api" "$dockerfile_fixture/Dockerfile.api"
sed "s/^FROM \(node:.* AS runtime\)$/FROM --platform=\$BUILDPLATFORM \1/" \
  "$ROOT_DIR/Dockerfile.worker" >"$dockerfile_fixture/Dockerfile.worker"
if verify_dockerfile_supply_chain_pins "$dockerfile_fixture" >/dev/null 2>&1; then
  echo "Dockerfile 负向测试失败：worker runtime 固定 BUILDPLATFORM 仍被接受。" >&2
  exit 1
fi
cp "$ROOT_DIR/Dockerfile.worker" "$dockerfile_fixture/Dockerfile.worker"
cp "$ROOT_DIR/Dockerfile.api" "$dockerfile_fixture/Dockerfile.api"
sed '1s/dockerfile:1\.25\.0/dockerfile:latest/' \
  "$ROOT_DIR/Dockerfile.worker" >"$dockerfile_fixture/Dockerfile.worker"
if verify_dockerfile_supply_chain_pins "$dockerfile_fixture" >/dev/null 2>&1; then
  echo "Dockerfile 负向测试失败：mutable frontend tag 被接受。" >&2
  exit 1
fi
cp "$ROOT_DIR/Dockerfile.worker" "$dockerfile_fixture/Dockerfile.worker"
sed '/^ARG FIATLUX_RELEASE_GIT_SHA=development$/d' \
  "$ROOT_DIR/Dockerfile.web" >"$dockerfile_fixture/Dockerfile.web"
if verify_dockerfile_supply_chain_pins "$dockerfile_fixture" >/dev/null 2>&1; then
  echo "Dockerfile 负向测试失败：缺少 PWA Git SHA 构建身份仍被接受。" >&2
  exit 1
fi
cp "$ROOT_DIR/Dockerfile.web" "$dockerfile_fixture/Dockerfile.web"

if ! grep -Fq "FIATLUX_RELEASE_VERSION=\${{ needs.prepare.outputs.version }}" \
  "$ROOT_DIR/.github/workflows/release.yml" || \
  ! grep -Fq "FIATLUX_RELEASE_GIT_SHA=\${{ needs.prepare.outputs.release_sha }}" \
    "$ROOT_DIR/.github/workflows/release.yml" || \
  ! grep -Fq "FIATLUX_RELEASE_GIT_SHA=\${{ github.sha }}" \
    "$ROOT_DIR/.github/workflows/ci.yml" || \
  [[ $(grep -Fxc "          build-args: \${{ matrix.build_args }}" \
    "$ROOT_DIR/.github/workflows/ci.yml") -ne 1 ]] || \
  [[ $(grep -Fxc "          build-args: \${{ matrix.build_args }}" \
    "$ROOT_DIR/.github/workflows/release.yml") -ne 1 ]]; then
  echo "CI/release 必须把受审候选身份传入 Web 构建。" >&2
  exit 1
fi

version=v9.8.7-test
git_sha=$(printf 'a%.0s' {1..40})
manifest="$workspace/release-manifest.tsv"
{
  printf 'version\tgit_sha\tcomponent\tdigest\n'
  printf '%s\t%s\tapi\tsha256:%s\n' "$version" "$git_sha" "$(printf '1%.0s' {1..64})"
  printf '%s\t%s\tworker\tsha256:%s\n' "$version" "$git_sha" "$(printf '2%.0s' {1..64})"
  printf '%s\t%s\tweb\tsha256:%s\n' "$version" "$git_sha" "$(printf '3%.0s' {1..64})"
  printf '%s\t%s\tgateway\tsha256:%s\n' "$version" "$git_sha" "$(printf '4%.0s' {1..64})"
  printf '%s\t%s\tminio\tsha256:%s\n' "$version" "$git_sha" "$(printf '5%.0s' {1..64})"
  printf '%s\t%s\tbackup\tsha256:%s\n' "$version" "$git_sha" "$(printf '6%.0s' {1..64})"
  printf '%s\t%s\tpostgres\tsha256:%s\n' "$version" "$git_sha" "$(printf '7%.0s' {1..64})"
} >"$manifest"
manifest_sha=$(sha256sum "$manifest" | awk '{print $1}')

fake_compose="$workspace/compose"
cat >"$fake_compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
version=${FIATLUX_VERSION_OVERRIDE:?}
case "${1:-}" in
  config)
    cat <<JSON
    {"services":{"api":{"image":"registry.example/choice-api:$version"},"worker":{"image":"registry.example/choice-worker:$version"},"web":{"image":"registry.example/choice-web:$version"},"caddy":{"image":"registry.example/choice-gateway:$version"},"minio":{"image":"registry.example/choice-minio:$version"},"backup-tools":{"image":"registry.example/choice-backup:$version"},"postgres":{"image":"registry.example/choice-postgres:$version"}}}
JSON
    ;;
  ps)
    printf 'container-%s\n' "${3:?service required}"
    ;;
  *) exit 9 ;;
esac
EOF
chmod 0700 "$fake_compose"

fake_docker="$workspace/docker"
cat >"$fake_docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
image=""
for argument in "$@"; do
  image=$argument
done
if [[ "${1:-}" == container ]]; then
  service=${image#container-}
  component=$service
  [[ "$component" == caddy ]] && component=gateway
  if [[ "${TEST_WRONG_RUNNING_SERVICE:-}" == "$service" ]]; then
    component=wrong
  fi
  printf 'sha256:image-%s\n' "$component"
  exit 0
fi

repository=${image%:*}
case "$repository" in
  *-api) digit=1; component=api ;;
  *-worker) digit=2; component=worker ;;
  *-web) digit=3; component=web ;;
  *-gateway) digit=4; component=gateway ;;
  *-minio) digit=5; component=minio ;;
  *-backup) digit=6; component=backup ;;
  *-postgres) digit=7; component=postgres ;;
  *) exit 9 ;;
esac
if [[ "$*" == *'{{.Id}}'* ]]; then
  printf 'sha256:image-%s\n' "$component"
  exit 0
fi
if [[ "${TEST_WRONG_COMPONENT:-}" == "${repository##*-}" ]]; then
  digit=0
fi
printf '%s@sha256:' "$repository"
for _ in {1..64}; do
  printf '%s' "$digit"
done
printf '\n'
EOF
chmod 0700 "$fake_docker"

verify=(
  "$ROOT_DIR/scripts/verify-release-images.sh"
  --version "$version"
  --expected-git-sha "$git_sha"
  --manifest "$manifest"
  --manifest-sha256 "$manifest_sha"
)
FIATLUX_COMPOSE_SCRIPT="$fake_compose" DOCKER_BIN="$fake_docker" \
  "${verify[@]}" --check-running-services

if FIATLUX_COMPOSE_SCRIPT="$fake_compose" DOCKER_BIN="$fake_docker" \
  TEST_WRONG_COMPONENT=worker "${verify[@]}" >/dev/null 2>&1; then
  echo "负向测试失败：错误本地 digest 被接受。" >&2
  exit 1
fi
if FIATLUX_COMPOSE_SCRIPT="$fake_compose" DOCKER_BIN="$fake_docker" \
  TEST_WRONG_RUNNING_SERVICE=worker "${verify[@]}" --check-running-services >/dev/null 2>&1; then
  echo "负向测试失败：运行容器错误 image ID 被接受。" >&2
  exit 1
fi
if FIATLUX_COMPOSE_SCRIPT="$fake_compose" DOCKER_BIN="$fake_docker" \
  TEST_WRONG_RUNNING_SERVICE=minio "${verify[@]}" --check-running-services >/dev/null 2>&1; then
  echo "负向测试失败：跨版本旧 MinIO 运行容器被接受。" >&2
  exit 1
fi
if FIATLUX_COMPOSE_SCRIPT="$fake_compose" DOCKER_BIN="$fake_docker" \
  TEST_WRONG_RUNNING_SERVICE=postgres "${verify[@]}" --check-running-services >/dev/null 2>&1; then
  echo "负向测试失败：跨版本旧 PostgreSQL 运行容器被接受。" >&2
  exit 1
fi
if "${verify[@]}" --manifest-sha256 "$(printf '0%.0s' {1..64})" --manifest-only >/dev/null 2>&1; then
  echo "负向测试失败：错误清单 SHA-256 被接受。" >&2
  exit 1
fi
if "${verify[@]}" --expected-git-sha "$(printf 'b%.0s' {1..40})" --manifest-only >/dev/null 2>&1; then
  echo "负向测试失败：错误 Git SHA 被发布清单接受。" >&2
  exit 1
fi

incomplete="$workspace/incomplete.tsv"
head -n 7 "$manifest" >"$incomplete"
incomplete_sha=$(sha256sum "$incomplete" | awk '{print $1}')
if "$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$version" --expected-git-sha "$git_sha" --manifest "$incomplete" \
  --manifest-sha256 "$incomplete_sha" --manifest-only >/dev/null 2>&1; then
  echo "负向测试失败：缺组件清单被接受。" >&2
  exit 1
fi

extra_column="$workspace/extra-column.tsv"
{
  IFS= read -r header
  IFS= read -r first_row
  printf '%s\n' "$header"
  printf '%s\textra\n' "$first_row"
  cat
} <"$manifest" >"$extra_column"
extra_column_sha=$(sha256sum "$extra_column" | awk '{print $1}')
if "$ROOT_DIR/scripts/verify-release-images.sh" \
  --version "$version" --expected-git-sha "$git_sha" --manifest "$extra_column" \
  --manifest-sha256 "$extra_column_sha" --manifest-only >/dev/null 2>&1; then
  echo "负向测试失败：额外 TSV 字段被接受。" >&2
  exit 1
fi

source_repo="$workspace/source-repo"
mkdir -p "$source_repo"
git -C "$source_repo" init --quiet
git -C "$source_repo" config user.name "FIAT LUX Security Test"
git -C "$source_repo" config user.email "security-test@fiatlux.invalid"
printf 'approved deployment asset\n' >"$source_repo/asset.txt"
git -C "$source_repo" add asset.txt
git -C "$source_repo" commit --quiet -m "test source"
source_sha=$(git -C "$source_repo" rev-parse HEAD)
"$ROOT_DIR/scripts/verify-deployment-source.sh" \
  --expected-git-sha "$source_sha" --root "$source_repo" >/dev/null
if "$ROOT_DIR/scripts/verify-deployment-source.sh" \
  --expected-git-sha "$(printf '0%.0s' {1..40})" --root "$source_repo" >/dev/null 2>&1; then
  echo "负向测试失败：错误部署源码 Git SHA 被接受。" >&2
  exit 1
fi
printf 'dirty deployment asset\n' >"$source_repo/asset.txt"
if "$ROOT_DIR/scripts/verify-deployment-source.sh" \
  --expected-git-sha "$source_sha" --root "$source_repo" >/dev/null 2>&1; then
  echo "负向测试失败：dirty 部署源码被接受。" >&2
  exit 1
fi

fake_oci_fetcher="$workspace/oci-fetch"
cat >"$fake_oci_fetcher" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
kind=${1:?kind required}
repository=${2:?repository required}
reference=${3:?reference required}
destination=${4:?destination required}
if [[ "$kind" != manifest && "$kind" != blob ]]; then
  exit 9
fi
if [[ "$repository" != fiatlux/choice ]]; then
  exit 9
fi
source_file="${FIATLUX_OCI_STORE:?}/${reference#sha256:}"
if [[ ! -f "$source_file" || -L "$source_file" ]]; then
  exit 8
fi
cp "$source_file" "$destination"
EOF
chmod 0700 "$fake_oci_fetcher"

file_digest() {
  printf 'sha256:%s' "$(sha256sum "$1" | awk '{print $1}')"
}

file_size() {
  wc -c <"$1" | tr -d '[:space:]'
}

create_provenance_statement() {
  local output=$1
  local platform_name=$2
  local subject_hex=$3
  local revision=$4
  local statement_type=$5
  local predicate_type=$6
  jq -cn \
    --arg platform_name "$platform_name" \
    --arg subject_hex "$subject_hex" \
    --arg revision "$revision" \
    --arg statement_type "$statement_type" \
    --arg predicate_type "$predicate_type" \
    --arg metadata_key 'https://mobyproject.org/buildkit@v1#metadata' '
      {
        _type: $statement_type,
        predicateType: $predicate_type,
        subject: [{
          name: ("pkg:docker/registry.example/fiatlux/choice@fixture?platform=linux%2F" + $platform_name),
          digest: {sha256: $subject_hex}
        }],
        predicate: {
          buildType: "https://mobyproject.org/buildkit@v1",
          metadata: {($metadata_key): {vcs: {revision: $revision}}}
        }
      }
    ' >"$output"
}

create_attestation_manifest() {
  local output=$1
  local provenance_digest=$2
  local provenance_size=$3
  local predicate_type=$4
  jq -cn \
    --arg provenance_digest "$provenance_digest" \
    --argjson provenance_size "$provenance_size" \
    --arg predicate_type "$predicate_type" \
    --arg config_digest "sha256:$(printf '0%.0s' {1..64})" '
      {
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: {
          mediaType: "application/vnd.oci.image.config.v1+json",
          digest: $config_digest,
          size: 2
        },
        layers: [{
          mediaType: "application/vnd.in-toto+json",
          digest: $provenance_digest,
          size: $provenance_size,
          annotations: {"in-toto.io/predicate-type": $predicate_type}
        }]
      }
    ' >"$output"
}

amd64_platform_hex=$(printf 'a%.0s' {1..64})
arm64_platform_hex=$(printf 'b%.0s' {1..64})
provenance_statement_type='https://in-toto.io/Statement/v1'
provenance_predicate_type='https://slsa.dev/provenance/v0.2'

make_provenance_fixture() {
  local directory=$1
  local amd64_subject_hex=$2
  local amd64_revision=$3
  local amd64_statement_type=$4
  local amd64_predicate_type=$5
  local amd64_binding=$6
  local store="$directory/store"
  local amd64_blob="$directory/amd64-provenance.json"
  local arm64_blob="$directory/arm64-provenance.json"
  local amd64_attestation="$directory/amd64-attestation.json"
  local arm64_attestation="$directory/arm64-attestation.json"
  local index="$directory/index.json"
  local amd64_blob_size
  local arm64_blob_size
  local amd64_attestation_digest
  local arm64_attestation_digest
  local amd64_attestation_size
  local arm64_attestation_size
  local amd64_reference="sha256:$amd64_platform_hex"

  mkdir -p "$store"
  create_provenance_statement \
    "$amd64_blob" amd64 "$amd64_subject_hex" "$amd64_revision" \
    "$amd64_statement_type" "$amd64_predicate_type"
  create_provenance_statement \
    "$arm64_blob" arm64 "$arm64_platform_hex" "$git_sha" \
    "$provenance_statement_type" "$provenance_predicate_type"
  FIXTURE_AMD64_BLOB_DIGEST=$(file_digest "$amd64_blob")
  arm64_blob_digest=$(file_digest "$arm64_blob")
  amd64_blob_size=$(file_size "$amd64_blob")
  arm64_blob_size=$(file_size "$arm64_blob")
  create_attestation_manifest \
    "$amd64_attestation" "$FIXTURE_AMD64_BLOB_DIGEST" "$amd64_blob_size" \
    "$amd64_predicate_type"
  create_attestation_manifest \
    "$arm64_attestation" "$arm64_blob_digest" "$arm64_blob_size" \
    "$provenance_predicate_type"
  amd64_attestation_digest=$(file_digest "$amd64_attestation")
  arm64_attestation_digest=$(file_digest "$arm64_attestation")
  amd64_attestation_size=$(file_size "$amd64_attestation")
  arm64_attestation_size=$(file_size "$arm64_attestation")
  if [[ "$amd64_binding" == arm64 ]]; then
    amd64_reference="sha256:$arm64_platform_hex"
  fi

  jq -cn \
    --arg amd64_platform_digest "sha256:$amd64_platform_hex" \
    --arg arm64_platform_digest "sha256:$arm64_platform_hex" \
    --arg amd64_attestation_digest "$amd64_attestation_digest" \
    --arg arm64_attestation_digest "$arm64_attestation_digest" \
    --arg amd64_reference "$amd64_reference" \
    --argjson amd64_attestation_size "$amd64_attestation_size" \
    --argjson arm64_attestation_size "$arm64_attestation_size" '
      {
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: $amd64_platform_digest,
            size: 1234,
            platform: {os: "linux", architecture: "amd64"}
          },
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: $arm64_platform_digest,
            size: 1234,
            platform: {os: "linux", architecture: "arm64"}
          },
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: $amd64_attestation_digest,
            size: $amd64_attestation_size,
            annotations: {
              "vnd.docker.reference.type": "attestation-manifest",
              "vnd.docker.reference.digest": $amd64_reference
            },
            platform: {os: "unknown", architecture: "unknown"}
          },
          {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: $arm64_attestation_digest,
            size: $arm64_attestation_size,
            annotations: {
              "vnd.docker.reference.type": "attestation-manifest",
              "vnd.docker.reference.digest": $arm64_platform_digest
            },
            platform: {os: "unknown", architecture: "unknown"}
          }
        ]
      }
    ' >"$index"

  cp "$amd64_blob" "$store/${FIXTURE_AMD64_BLOB_DIGEST#sha256:}"
  cp "$arm64_blob" "$store/${arm64_blob_digest#sha256:}"
  cp "$amd64_attestation" "$store/${amd64_attestation_digest#sha256:}"
  cp "$arm64_attestation" "$store/${arm64_attestation_digest#sha256:}"
  FIXTURE_IMAGE_DIGEST=$(file_digest "$index")
  cp "$index" "$store/${FIXTURE_IMAGE_DIGEST#sha256:}"
  FIXTURE_STORE=$store
}

run_provenance_fixture() {
  FIATLUX_OCI_FETCH_BIN="$fake_oci_fetcher" \
    FIATLUX_OCI_STORE="$FIXTURE_STORE" \
    "$ROOT_DIR/scripts/verify-buildkit-provenance.sh" \
    --registry-image registry.example/fiatlux/choice \
    --image-digest "$FIXTURE_IMAGE_DIGEST" \
    --expected-git-sha "$git_sha"
}

expect_provenance_failure() {
  local label=$1
  if run_provenance_fixture >/dev/null 2>&1; then
    printf '来源证明负向测试失败：%s 被接受。\n' "$label" >&2
    exit 1
  fi
}

make_provenance_fixture \
  "$workspace/provenance-valid" "$amd64_platform_hex" "$git_sha" \
  "$provenance_statement_type" "$provenance_predicate_type" correct
run_provenance_fixture

make_provenance_fixture \
  "$workspace/provenance-wrong-subject" "$(printf 'c%.0s' {1..64})" "$git_sha" \
  "$provenance_statement_type" "$provenance_predicate_type" correct
expect_provenance_failure "错误 platform subject"

make_provenance_fixture \
  "$workspace/provenance-wrong-revision" "$amd64_platform_hex" "$(printf 'd%.0s' {1..40})" \
  "$provenance_statement_type" "$provenance_predicate_type" correct
expect_provenance_failure "错误 predicate source Git SHA"

make_provenance_fixture \
  "$workspace/provenance-wrong-statement" "$amd64_platform_hex" "$git_sha" \
  'https://in-toto.io/Statement/v0.1' "$provenance_predicate_type" correct
expect_provenance_failure "错误 in-toto _type"

make_provenance_fixture \
  "$workspace/provenance-wrong-predicate" "$amd64_platform_hex" "$git_sha" \
  "$provenance_statement_type" 'https://slsa.dev/provenance/v1' correct
expect_provenance_failure "错误 predicateType"

make_provenance_fixture \
  "$workspace/provenance-wrong-binding" "$amd64_platform_hex" "$git_sha" \
  "$provenance_statement_type" "$provenance_predicate_type" arm64
expect_provenance_failure "错误 index descriptor 绑定"

make_provenance_fixture \
  "$workspace/provenance-tampered-blob" "$amd64_platform_hex" "$git_sha" \
  "$provenance_statement_type" "$provenance_predicate_type" correct
printf ' ' >>"$FIXTURE_STORE/${FIXTURE_AMD64_BLOB_DIGEST#sha256:}"
expect_provenance_failure "被篡改但沿用旧 digest 的 provenance blob"

fake_toolchain_docker="$workspace/toolchain-docker"
cat >"$fake_toolchain_docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == buildx && "${2:-}" == version ]]; then
  printf 'github.com/docker/buildx %s fixture\n' "${FAKE_BUILDX_VERSION:-v0.35.0}"
  exit 0
fi
if [[ "${1:-}" == buildx && "${2:-}" == inspect ]]; then
  cat <<INSPECT
Name: fixture
Driver: docker-container
Nodes:
Name: fixture0
Status: running
BuildKit version: ${FAKE_BUILDKIT_VERSION:-v0.31.2}
Platforms: ${FAKE_BUILDKIT_PLATFORMS:-linux/amd64, linux/arm64}
INSPECT
  exit 0
fi
if [[ "${1:-}" == ps ]]; then
  [[ "${FAKE_BUILDER_CONTAINER_COUNT:-1}" == 1 ]] && printf 'fixture-container\n'
  exit 0
fi
if [[ "${1:-}" == container && "${2:-}" == inspect ]]; then
  printf '%s\n' "${FAKE_BUILDKIT_IMAGE:-docker.io/moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec}"
  exit 0
fi
exit 9
EOF
chmod 0700 "$fake_toolchain_docker"

expected_buildkit_image='docker.io/moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec'
run_toolchain_fixture() {
  DOCKER_BIN="$fake_toolchain_docker" \
    EXPECTED_BUILDX_VERSION=v0.35.0 \
    EXPECTED_BUILDKIT_VERSION=v0.31.2 \
    EXPECTED_BUILDKIT_IMAGE="$expected_buildkit_image" \
    REQUIRED_BUILDKIT_PLATFORMS=linux/amd64,linux/arm64 \
    QEMU_REGISTERED_PLATFORMS=linux/amd64,linux/arm64 \
    REQUIRED_QEMU_PLATFORMS=arm64 \
    "$ROOT_DIR/scripts/verify-build-toolchain.sh"
}
run_toolchain_fixture

if FAKE_BUILDX_VERSION=v0.34.0 run_toolchain_fixture >/dev/null 2>&1; then
  echo "构建工具链负向测试失败：错误 Buildx 版本被接受。" >&2
  exit 1
fi
if FAKE_BUILDKIT_VERSION=v0.30.0 run_toolchain_fixture >/dev/null 2>&1; then
  echo "构建工具链负向测试失败：错误 BuildKit 版本被接受。" >&2
  exit 1
fi
if FAKE_BUILDKIT_IMAGE=docker.io/moby/buildkit:v0.31.2 \
  run_toolchain_fixture >/dev/null 2>&1; then
  echo "构建工具链负向测试失败：未绑定 digest 的 BuildKit 容器被接受。" >&2
  exit 1
fi
if FAKE_BUILDKIT_PLATFORMS=linux/amd64 \
  run_toolchain_fixture >/dev/null 2>&1; then
  echo "构建工具链负向测试失败：缺少 arm64 的 builder 被接受。" >&2
  exit 1
fi
if QEMU_REGISTERED_PLATFORMS=linux/amd64 \
  DOCKER_BIN="$fake_toolchain_docker" \
  EXPECTED_BUILDX_VERSION=v0.35.0 \
  EXPECTED_BUILDKIT_VERSION=v0.31.2 \
  EXPECTED_BUILDKIT_IMAGE="$expected_buildkit_image" \
  REQUIRED_BUILDKIT_PLATFORMS=linux/amd64,linux/arm64 \
  REQUIRED_QEMU_PLATFORMS=arm64 \
  "$ROOT_DIR/scripts/verify-build-toolchain.sh" >/dev/null 2>&1; then
  echo "构建工具链负向测试失败：缺少 arm64 的 QEMU 注册被接受。" >&2
  exit 1
fi

sbom_fixture_dir="$workspace/sbom-fixture"
mkdir -p "$sbom_fixture_dir"
for architecture in amd64 arm64; do
  jq -cn \
    --arg name "fiatlux-choice-api-$architecture" \
    --arg namespace "https://fiatlux.invalid/spdx/$architecture" \
    --arg package_id "SPDXRef-Package-$architecture" '
      {
        spdxVersion: "SPDX-2.3",
        dataLicense: "CC0-1.0",
        SPDXID: "SPDXRef-DOCUMENT",
        name: $name,
        documentNamespace: $namespace,
        creationInfo: {
          created: "2026-07-19T00:00:00Z",
          creators: ["Organization: Anchore, Inc", "Tool: syft-1.42.3"]
        },
        packages: [{
          SPDXID: $package_id,
          name: "fixture-package",
          versionInfo: "1.0.0",
          downloadLocation: "NOASSERTION",
          filesAnalyzed: false,
          licenseConcluded: "NOASSERTION",
          licenseDeclared: "NOASSERTION",
          copyrightText: "NOASSERTION"
        }]
      }
    ' >"$sbom_fixture_dir/sbom-api-$architecture.spdx.json"
done
sbom_image_digest="sha256:$(printf 'e%.0s' {1..64})"
sbom_manifest="$sbom_fixture_dir/sbom-manifest.tsv"
amd64_sbom_sha=$("$ROOT_DIR/scripts/verify-spdx-sbom.sh" \
  --sbom "$sbom_fixture_dir/sbom-api-amd64.spdx.json" --syft-version 1.42.3)
arm64_sbom_sha=$("$ROOT_DIR/scripts/verify-spdx-sbom.sh" \
  --sbom "$sbom_fixture_dir/sbom-api-arm64.spdx.json" --syft-version 1.42.3)
{
  printf 'component\tplatform\timage_digest\tgit_sha\tsbom_file\tsbom_sha256\tsyft_version\n'
  printf 'api\tlinux/amd64\t%s\t%s\tsbom-api-amd64.spdx.json\t%s\t1.42.3\n' \
    "$sbom_image_digest" "$git_sha" "$amd64_sbom_sha"
  printf 'api\tlinux/arm64\t%s\t%s\tsbom-api-arm64.spdx.json\t%s\t1.42.3\n' \
    "$sbom_image_digest" "$git_sha" "$arm64_sbom_sha"
} >"$sbom_manifest"

verify_sbom_manifest_fixture() {
  local candidate=${1:-$sbom_manifest}
  "$ROOT_DIR/scripts/verify-release-sbom-manifest.sh" \
    --manifest "$candidate" \
    --component api \
    --image-digest "$sbom_image_digest" \
    --git-sha "$git_sha" \
    --syft-version 1.42.3 \
    --sbom-directory "$sbom_fixture_dir"
}
verify_sbom_manifest_fixture

postgres_sbom_manifest="$sbom_fixture_dir/sbom-postgres-manifest.tsv"
for architecture in amd64 arm64; do
  cp "$sbom_fixture_dir/sbom-api-$architecture.spdx.json" \
    "$sbom_fixture_dir/sbom-postgres-$architecture.spdx.json"
done
{
  printf 'component\tplatform\timage_digest\tgit_sha\tsbom_file\tsbom_sha256\tsyft_version\n'
  printf 'postgres\tlinux/amd64\t%s\t%s\tsbom-postgres-amd64.spdx.json\t%s\t1.42.3\n' \
    "$sbom_image_digest" "$git_sha" "$amd64_sbom_sha"
  printf 'postgres\tlinux/arm64\t%s\t%s\tsbom-postgres-arm64.spdx.json\t%s\t1.42.3\n' \
    "$sbom_image_digest" "$git_sha" "$arm64_sbom_sha"
} >"$postgres_sbom_manifest"
"$ROOT_DIR/scripts/verify-release-sbom-manifest.sh" \
  --manifest "$postgres_sbom_manifest" \
  --component postgres \
  --image-digest "$sbom_image_digest" \
  --git-sha "$git_sha" \
  --syft-version 1.42.3 \
  --sbom-directory "$sbom_fixture_dir"

empty_sbom="$sbom_fixture_dir/empty-packages.spdx.json"
jq '.packages = []' "$sbom_fixture_dir/sbom-api-amd64.spdx.json" >"$empty_sbom"
if "$ROOT_DIR/scripts/verify-spdx-sbom.sh" \
  --sbom "$empty_sbom" --syft-version 1.42.3 >/dev/null 2>&1; then
  echo "SBOM 负向测试失败：空 packages 被接受。" >&2
  exit 1
fi

wrong_platform_manifest="$sbom_fixture_dir/wrong-platform.tsv"
awk -F $'\t' -v OFS=$'\t' 'NR == 2 {$2 = "linux/s390x"} {print}' \
  "$sbom_manifest" >"$wrong_platform_manifest"
if verify_sbom_manifest_fixture "$wrong_platform_manifest" >/dev/null 2>&1; then
  echo "SBOM 负向测试失败：错误平台绑定被接受。" >&2
  exit 1
fi

wrong_digest_manifest="$sbom_fixture_dir/wrong-digest.tsv"
awk -F $'\t' -v OFS=$'\t' -v digest="sha256:$(printf 'f%.0s' {1..64})" \
  'NR == 2 {$3 = digest} {print}' "$sbom_manifest" >"$wrong_digest_manifest"
if verify_sbom_manifest_fixture "$wrong_digest_manifest" >/dev/null 2>&1; then
  echo "SBOM 负向测试失败：错误 root digest 绑定被接受。" >&2
  exit 1
fi

wrong_git_manifest="$sbom_fixture_dir/wrong-git.tsv"
awk -F $'\t' -v OFS=$'\t' -v git_sha="$(printf 'f%.0s' {1..40})" \
  'NR == 3 {$4 = git_sha} {print}' "$sbom_manifest" >"$wrong_git_manifest"
if verify_sbom_manifest_fixture "$wrong_git_manifest" >/dev/null 2>&1; then
  echo "SBOM 负向测试失败：错误 Git SHA 绑定被接受。" >&2
  exit 1
fi

wrong_sha_manifest="$sbom_fixture_dir/wrong-sbom-sha.tsv"
awk -F $'\t' -v OFS=$'\t' -v sha="$(printf '0%.0s' {1..64})" \
  'NR == 2 {$6 = sha} {print}' "$sbom_manifest" >"$wrong_sha_manifest"
if verify_sbom_manifest_fixture "$wrong_sha_manifest" >/dev/null 2>&1; then
  echo "SBOM 负向测试失败：错误 SPDX 内容 SHA-256 被接受。" >&2
  exit 1
fi

echo "七 Dockerfile 固定 frontend/base/build-runtime platform/non-root、发布清单、Git SHA、clean 源码、七组件 digest、多架构 provenance、构建工具链与双平台 SBOM 正/负向测试通过。"
