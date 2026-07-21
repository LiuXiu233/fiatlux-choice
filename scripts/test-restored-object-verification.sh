#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
mkdir -p "$ROOT_DIR/tmp"
workspace=$(mktemp -d "$ROOT_DIR/tmp/restored-object-verification.XXXXXX")
cleanup() {
  chmod -R u+w "$workspace" 2>/dev/null || true
  rm -rf "$workspace"
}
trap cleanup EXIT HUP INT TERM

expected="$workspace/expected"
target="$workspace/target"
work="$workspace/work"
fakebin="$workspace/fakebin"
mkdir -p "$expected/nested" "$target/nested" "$work" "$fakebin"
printf 'alpha object\n' >"$expected/alpha.txt"
printf 'unicode and spaces\n' >"$expected/nested/耀光 object.bin"
cp -R "$expected/." "$target/"

cat >"$fakebin/mc" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  cat)
    reference=${2:?target reference required}
    prefix="target/fiatlux-test/"
    [[ "$reference" == "$prefix"* ]]
    key=${reference#"$prefix"}
    cat "$FAKE_TARGET_ROOT/$key"
    ;;
  ls)
    while IFS= read -r -d '' file; do
      bytes=$(wc -c <"$file" | tr -d '[:space:]')
      jq -cn --argjson size "$bytes" '{type: "file", size: $size}'
    done < <(find "$FAKE_TARGET_ROOT" -type f -print0)
    ;;
  *)
    printf 'unexpected fake mc command: %s\n' "$*" >&2
    exit 9
    ;;
esac
EOF
chmod 0700 "$fakebin/mc"

run_verifier() {
  local manifest=$1
  PATH="$fakebin:$PATH" \
    FAKE_TARGET_ROOT="$target" \
    EXPECTED_OBJECT_ROOT="$expected" \
    TARGET_OBJECT_ALIAS=target \
    TARGET_OBJECT_BUCKET=fiatlux-test \
    OBJECT_VERIFICATION_MANIFEST="$manifest" \
    OBJECT_VERIFICATION_WORK_ROOT="$work" \
    "$ROOT_DIR/infra/backup/verify-restored-objects.sh"
}

manifest="$workspace/objects.jsonl"
run_verifier "$manifest" >/dev/null
jq -s -e '
  length == 2 and
  ([.[].path] | sort) == ["alpha.txt", "nested/耀光 object.bin"] and
  all(.[]; (.sizeBytes | type == "number") and (.sha256 | test("^[0-9a-f]{64}$")))
' "$manifest" >/dev/null

rm -f "$manifest"
printf 'corrupt target\n' >"$target/alpha.txt"
if run_verifier "$manifest" >/dev/null 2>&1; then
  echo "目标对象内容损坏未使逐项 SHA-256 核验失败。" >&2
  exit 1
fi
[[ ! -e "$manifest" && ! -e "$manifest.partial" ]]

cp "$expected/alpha.txt" "$target/alpha.txt"
printf 'unexpected extra\n' >"$target/extra.bin"
if run_verifier "$manifest" >/dev/null 2>&1; then
  echo "目标桶额外路径未使路径集合核验失败。" >&2
  exit 1
fi
[[ ! -e "$manifest" && ! -e "$manifest.partial" ]]

rm -f "$target/extra.bin" "$target/alpha.txt"
if run_verifier "$manifest" >/dev/null 2>&1; then
  echo "目标桶缺少对象未使逐项核验失败。" >&2
  exit 1
fi
[[ ! -e "$manifest" && ! -e "$manifest.partial" ]]
if find "$work" -mindepth 1 -print -quit | grep -q .; then
  echo "对象逐项核验失败后存在 scratch 残留。" >&2
  exit 1
fi

echo "恢复对象路径/字节/SHA-256 正向及损坏、额外、缺失负向测试通过。"
