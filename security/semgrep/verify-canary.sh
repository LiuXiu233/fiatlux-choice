#!/bin/sh
set -eu

rules="security/semgrep/fiatlux-nodejs-v1.yml"
fixture="security/semgrep/canary/intentionally-vulnerable.tsx"
result="${TMPDIR:-/tmp}/fiatlux-semgrep-canary.json"

rm -f "$result"
set +e
semgrep scan \
  --config "$rules" \
  --metrics=off \
  --disable-version-check \
  --strict \
  --error \
  --json-output "$result" \
  "$fixture"
status=$?
set -e

if [ "$status" -ne 1 ]; then
  echo "Expected Semgrep canary findings and exit 1; received exit $status." >&2
  exit 1
fi

python3 - "$result" "$fixture" <<'PY'
import json
import pathlib
import sys

result_path = pathlib.Path(sys.argv[1])
fixture = sys.argv[2]
expected = {
    "fiatlux.node.sql-string-construction",
    "fiatlux.node.dynamic-sql-raw",
    "fiatlux.node.shell-command-execution",
    "fiatlux.node.dynamic-code-execution",
    "fiatlux.node.user-controlled-ssrf",
    "fiatlux.node.tls-verification-disabled",
    "fiatlux.node.weak-cryptographic-primitive",
    "fiatlux.node.hardcoded-secret",
    "fiatlux.node.sensitive-data-logging",
    "fiatlux.node.react-raw-html-injection",
}

with result_path.open(encoding="utf-8") as handle:
    report = json.load(handle)

if report.get("errors"):
    raise SystemExit(f"Semgrep canary produced engine errors: {report['errors']}")

findings = report.get("results", [])


def local_rule_id(check_id: str) -> str:
    marker = "fiatlux.node."
    offset = check_id.find(marker)
    return check_id[offset:] if offset >= 0 else check_id


found = {local_rule_id(finding["check_id"]) for finding in findings}
missing = sorted(expected - found)
unexpected_paths = sorted(
    {
        finding.get("path", "<missing>")
        for finding in findings
        if finding.get("path") != fixture
    }
)

if missing:
    raise SystemExit(f"Semgrep canary did not trigger required rules: {', '.join(missing)}")
if unexpected_paths:
    raise SystemExit(f"Semgrep canary reported unexpected paths: {', '.join(unexpected_paths)}")

print(f"Semgrep canary verified {len(expected)} required rules with {len(findings)} findings.")
PY

rm -f "$result"
