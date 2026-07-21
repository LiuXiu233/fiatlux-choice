#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SUBJECT="$ROOT_DIR/scripts/create-education-wordpress-review-bundle.ts"
NODE_BIN=$(command -v node)

[[ -x "$NODE_BIN" ]] || {
  echo "node is required for the education WordPress review-bundle test" >&2
  exit 1
}

work=$(mktemp -d "$ROOT_DIR/tmp/education-wordpress-review.XXXXXX")
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT HUP INT TERM
chmod 0700 "$work"
umask 077

git_sha=$(git -C "$ROOT_DIR" rev-parse HEAD)
if [[ ! "$git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "test candidate must be a full lowercase Git SHA" >&2
  exit 1
fi

network_guard="$work/network-guard.cjs"
network_attempts="$work/network-attempts.log"
cat >"$network_guard" <<'NODE'
const fs = require("node:fs");

function blocked(name) {
  return function blockNetworkCall() {
    fs.appendFileSync(process.env.FIATLUX_NETWORK_ATTEMPTS, `${name}\n`, "utf8");
    throw new Error(`unexpected network call from review-bundle CLI: ${name}`);
  };
}

for (const [moduleName, methods] of [
  ["node:http", ["get", "request"]],
  ["node:https", ["get", "request"]],
  ["node:http2", ["connect"]],
  ["node:tls", ["connect"]],
  ["node:dgram", ["createSocket"]],
]) {
  const module = require(moduleName);
  for (const method of methods) module[method] = blocked(`${moduleName}.${method}`);
}
const net = require("node:net");
for (const method of ["connect", "createConnection"]) {
  const original = net[method];
  net[method] = function guardNetworkConnection(...args) {
    const options = args[0];
    const isLocalSocket =
      typeof options === "string" ||
      (options && typeof options === "object" && typeof options.path === "string");
    if (isLocalSocket) return Reflect.apply(original, this, args);
    return blocked(`node:net.${method}`)();
  };
}
globalThis.fetch = blocked("global.fetch");
if ("WebSocket" in globalThis) globalThis.WebSocket = blocked("global.WebSocket");
NODE
chmod 0600 "$network_guard"

run_cli() {
  (
    cd "$ROOT_DIR"
    FIATLUX_NETWORK_ATTEMPTS="$network_attempts" \
      NODE_OPTIONS="--require=$network_guard" \
      "$NODE_BIN" --conditions=development --import tsx "$SUBJECT" "$@"
  )
}

output="$work/review-bundle"
summary="$work/summary.json"
run_cli -- \
  --output "$output" \
  --repository-root "$ROOT_DIR" \
  --git-sha "$git_sha" \
  --json >"$summary"

if [[ -e "$network_attempts" ]]; then
  sed 's/^/blocked operation: /' "$network_attempts" >&2
  echo "review-bundle CLI attempted a network operation" >&2
  exit 1
fi

node - "$summary" "$output" "$git_sha" "$ROOT_DIR" <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [summaryPath, outputPath, gitSha, repositoryRoot] = process.argv.slice(2);
const marker = "FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH";
const fail = (message) => {
  throw new Error(message);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mode = (file) => fs.lstatSync(file).mode & 0o777;

const summary = readJson(summaryPath);
assert(summary.output === outputPath, "summary output path mismatch");
assert(summary.gitSha === gitSha, "summary Git SHA mismatch");
assert(summary.articleCount === 12, "summary must contain 12 articles");
assert(summary.publicationEligibleCount === 0, "current drafts must not be publication eligible");
assert(summary.blockedArticleCount === 12, "current drafts must all remain blocked");
assert(summary.externalPublicationPerformed === false, "CLI must not claim external publication");
assert(summary.wordpressApiCalled === false, "CLI must not claim a WordPress API call");
assert(summary.reviewOnlyMarker === marker, "summary review-only marker mismatch");

const entries = [];
function walk(directory) {
  const stats = fs.lstatSync(directory);
  assert(stats.isDirectory() && !stats.isSymbolicLink(), `unsafe directory: ${directory}`);
  assert(mode(directory) === 0o700, `directory is not mode 0700: ${directory}`);
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const childStats = fs.lstatSync(absolute);
    assert(!childStats.isSymbolicLink(), `bundle must not contain symlinks: ${absolute}`);
    if (childStats.isDirectory()) walk(absolute);
    else {
      assert(childStats.isFile(), `bundle entry is not a regular file: ${absolute}`);
      assert(mode(absolute) === 0o600, `file is not mode 0600: ${absolute}`);
      entries.push(path.relative(outputPath, absolute));
    }
  }
}
walk(outputPath);
assert(entries.length === 26, `expected 26 regular files, received ${entries.length}`);
assert(entries.filter((item) => item.startsWith("articles/") && item.endsWith(".review.html")).length === 12, "expected 12 review HTML files");
assert(entries.filter((item) => item.startsWith("reviews/") && item.endsWith(".review.md")).length === 12, "expected 12 governance review sheets");
assert(entries.includes("README.md") && entries.includes("manifest.json"), "README or manifest missing");

const manifest = readJson(path.join(outputPath, "manifest.json"));
assert(manifest.schemaVersion === 1, "manifest schema version mismatch");
assert(manifest.evidenceType === "education_wordpress_review_bundle", "manifest evidence type mismatch");
assert(manifest.mode === "review_only", "manifest must stay review_only");
assert(manifest.candidate.gitSha === gitSha, "manifest Git SHA mismatch");
assert(manifest.candidate.contentFiles.length === 2, "manifest must bind two content files");
assert(manifest.library.articleCount === 12, "manifest library must contain 12 articles");
assert(manifest.articles.length === 12, "manifest must list 12 articles");
assert(manifest.artifacts.length === 25, "manifest must hash 25 non-manifest artifacts");
assert(manifest.summary.articleCount === 12, "manifest summary article count mismatch");
assert(manifest.summary.publicationEligibleCount === 0, "manifest unexpectedly marks a draft eligible");
assert(manifest.summary.blockedArticleCount === 12, "manifest must block all current drafts");

const safety = manifest.safety;
for (const field of [
  "externalPublicationPerformed",
  "wordpressCredentialsAccepted",
  "wordpressApiCalled",
  "publicWebsiteStateVerified",
  "professionalReviewSubstituted",
  "rightsReviewSubstituted",
  "approvalSubstituted",
]) {
  assert(safety[field] === false, `manifest safety flag must be false: ${field}`);
}
assert(safety.manualPublicationRequired === true, "manifest must require manual publication");
assert(safety.reviewOnlyMarker === marker, "manifest review-only marker mismatch");

const articleIds = new Set();
const artifactPaths = new Set();
for (const article of manifest.articles) {
  assert(!articleIds.has(article.articleId), `duplicate article: ${article.articleId}`);
  articleIds.add(article.articleId);
  assert(article.publicationEligible === false, `draft unexpectedly eligible: ${article.articleId}`);
  assert(article.blockingReasons.length > 0, `draft has no blocking reason: ${article.articleId}`);
  assert(entries.includes(article.reviewHtmlPath), `review HTML missing: ${article.articleId}`);
  assert(entries.includes(article.reviewSheetPath), `review sheet missing: ${article.articleId}`);
  const html = fs.readFileSync(path.join(outputPath, article.reviewHtmlPath), "utf8");
  const sheet = fs.readFileSync(path.join(outputPath, article.reviewSheetPath), "utf8");
  assert(html.includes(`<!-- ${marker} -->`), `HTML comment marker missing: ${article.articleId}`);
  assert(html.includes(marker) && sheet.includes(marker), `visible review-only marker missing: ${article.articleId}`);
  assert(html.includes("<!-- wp:"), `WordPress block markup missing: ${article.articleId}`);
}

for (const artifact of manifest.artifacts) {
  assert(!artifactPaths.has(artifact.path), `duplicate artifact path: ${artifact.path}`);
  artifactPaths.add(artifact.path);
  assert(entries.includes(artifact.path), `manifest artifact missing: ${artifact.path}`);
  const bytes = fs.readFileSync(path.join(outputPath, artifact.path));
  assert(artifact.bytes === bytes.length, `artifact byte length drift: ${artifact.path}`);
  assert(artifact.sha256 === digest(bytes), `artifact SHA-256 drift: ${artifact.path}`);
}
assert(!artifactPaths.has("manifest.json"), "manifest must not claim a recursive self-hash");

for (const contentFile of manifest.candidate.contentFiles) {
  const bytes = execFileSync("git", ["-C", repositoryRoot, "show", `${gitSha}:${contentFile.path}`], {
    maxBuffer: 20_000_000,
  });
  assert(contentFile.bytes === bytes.length, `candidate byte length drift: ${contentFile.path}`);
  assert(contentFile.sha256 === digest(bytes), `candidate SHA-256 drift: ${contentFile.path}`);
}
NODE

tree_fingerprint() {
  node - "$1" <<'NODE'
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const rows = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const stats = fs.lstatSync(absolute);
    const relative = path.relative(root, absolute);
    if (stats.isDirectory()) walk(absolute);
    else rows.push(`${relative}\t${stats.mode & 0o777}\t${createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
  }
}
walk(root);
process.stdout.write(createHash("sha256").update(rows.join("\n")).digest("hex"));
NODE
}

original_fingerprint=$(tree_fingerprint "$output")
if run_cli \
  --output "$output" \
  --repository-root "$ROOT_DIR" \
  --git-sha "$git_sha" \
  --json >/dev/null 2>&1; then
  echo "existing review-bundle directory was unexpectedly overwritten" >&2
  exit 1
fi
if [[ "$(tree_fingerprint "$output")" != "$original_fingerprint" ]]; then
  echo "failed overwrite attempt changed the existing review bundle" >&2
  exit 1
fi

relative_output="tmp/$(basename "$work")/relative-output"
if run_cli \
  --output "$relative_output" \
  --repository-root "$ROOT_DIR" \
  --git-sha "$git_sha" \
  --json >/dev/null 2>&1; then
  echo "relative review-bundle output path was unexpectedly accepted" >&2
  exit 1
fi
[[ ! -e "$work/relative-output" ]] || {
  echo "relative-path rejection left an output directory" >&2
  exit 1
}

mkdir -m 0755 "$work/unsafe-parent"
chmod 0755 "$work/unsafe-parent"
if run_cli \
  --output "$work/unsafe-parent/review-bundle" \
  --repository-root "$ROOT_DIR" \
  --git-sha "$git_sha" \
  --json >/dev/null 2>&1; then
  echo "unsafe mode-0755 output parent was unexpectedly accepted" >&2
  exit 1
fi
[[ ! -e "$work/unsafe-parent/review-bundle" ]] || {
  echo "unsafe-parent rejection left an output directory" >&2
  exit 1
}

if run_cli \
  --output "$work/relative-repository-output" \
  --repository-root . \
  --git-sha "$git_sha" \
  --json >/dev/null 2>&1; then
  echo "relative repository path was unexpectedly accepted" >&2
  exit 1
fi
[[ ! -e "$work/relative-repository-output" ]] || {
  echo "relative-repository rejection left an output directory" >&2
  exit 1
}

if [[ -e "$network_attempts" ]]; then
  sed 's/^/blocked operation: /' "$network_attempts" >&2
  echo "a negative-path review-bundle check attempted a network operation" >&2
  exit 1
fi

echo "education WordPress review-only bundle CLI verified: 12 blocked articles, 26 protected files, no network or overwrite"
