#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required for the real-adapter runtime-boundary test" >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "docker compose is required for the real-adapter runtime-boundary test" >&2
  exit 1
}

# The template expression in the Node program belongs to JavaScript, not the shell.
# shellcheck disable=SC2016
LLM_DRIVER=compatible \
LLM_BASE_URL=https://llm.example.test/gateway \
LLM_PROVIDER_ID=approved-provider \
LLM_API_KEY=test-worker-only-key \
LLM_MODEL=approved-model \
LLM_MAX_OUTPUT_TOKENS=2048 \
GITHUB_INTEGRATION_MODE=read_only \
GITHUB_TOKEN=test-worker-only-token \
GITHUB_PROBE_REPOSITORY=LiuXiu233/fiatlux-choice \
  docker compose -f compose.yml -f compose.dev.yml config --format json |
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const config = JSON.parse(input);
      const api = config.services.api.environment;
      const worker = config.services.worker.environment;
      for (const forbidden of ["LLM_API_KEY", "GITHUB_TOKEN", "GITHUB_PROBE_REPOSITORY"]) {
        if (forbidden in api) throw new Error(`API unexpectedly received ${forbidden}`);
      }
      if (
        worker.LLM_API_KEY !== "test-worker-only-key" ||
        worker.GITHUB_TOKEN !== "test-worker-only-token" ||
        worker.GITHUB_PROBE_REPOSITORY !== "LiuXiu233/fiatlux-choice"
      ) {
        throw new Error("worker integration configuration was not preserved");
      }
    });
  '

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fiatlux-real-adapter-boundary.XXXXXX")
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT
chmod 0700 "$TMP_DIR"

pnpm delivery:real-adapters:template -- --output "$TMP_DIR/session.json" >/dev/null
node -e '
  const fs = require("node:fs");
  const directory = fs.statSync(process.argv[1]).mode & 0o777;
  const template = fs.statSync(process.argv[2]).mode & 0o777;
  if (directory !== 0o700 || template !== 0o600) process.exit(1);
' "$TMP_DIR" "$TMP_DIR/session.json"

if pnpm delivery:real-adapters:verify -- \
  --session "$TMP_DIR/session.json" \
  --evidence-root "$TMP_DIR" \
  --report-dir "$TMP_DIR" \
  --expected-version v1.0.0 \
  --expected-git-sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --expected-url https://choice.internal.example \
  --expected-environment-id target-environment \
  --expected-llm-provider approved-provider \
  --expected-llm-endpoint https://llm.example.test \
  --expected-llm-model approved-model \
  --expected-github-repository owner/repository >/dev/null 2>&1; then
  echo "unfilled real-adapter template unexpectedly passed verification" >&2
  exit 1
fi

echo "real-adapter worker-only secret boundary and fail-closed template verified"
