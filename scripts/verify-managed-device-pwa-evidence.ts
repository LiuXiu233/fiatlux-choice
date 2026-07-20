import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { verifyManagedDevicePwaEvidence } from "../packages/integrations/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm exec tsx scripts/verify-managed-device-pwa-evidence.ts [选项]

离线校验真实受管手机 PWA 会话 JSON 与哈希附件，并在全部结构、身份和文件检查通过后
原子生成 mode 0600 报告。本命令不控制设备，也不独立证明设备、MDM 或批准真实性。

必填选项：
  --session <file>          已填写的受管真机会话 JSON
  --evidence-root <dir>    会话附件所在受控目录
  --report-dir <dir>       成功报告目录
  --expected-version <v>   独立批准的目标版本
  --expected-git-sha <sha> 独立批准的 40 位目标 Git SHA
  --expected-url <origin>  独立批准的无路径 HTTPS origin
  --expected-environment-id <id>
                            独立批准的目标环境稳定 ID

其他选项：
  --json                    输出机器可读结果
  --help                    显示帮助
`);
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`缺少必填选项：${label}`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      "evidence-root": { type: "string" },
      "report-dir": { type: "string" },
      "expected-version": { type: "string" },
      "expected-git-sha": { type: "string" },
      "expected-url": { type: "string" },
      "expected-environment-id": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printHelp();
    return;
  }

  const result = await verifyManagedDevicePwaEvidence({
    sessionPath: resolve(requireValue(values.session, "--session")),
    evidenceRoot: resolve(requireValue(values["evidence-root"], "--evidence-root")),
    reportDir: resolve(requireValue(values["report-dir"], "--report-dir")),
    expectedVersion: requireValue(values["expected-version"], "--expected-version"),
    expectedGitSha: requireValue(values["expected-git-sha"], "--expected-git-sha"),
    expectedBaseUrl: requireValue(values["expected-url"], "--expected-url"),
    expectedEnvironmentId: requireValue(
      values["expected-environment-id"],
      "--expected-environment-id",
    ),
  });
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          valid: true,
          reportPath: result.reportPath,
          reportSha256: result.reportSha256,
          candidate: result.report.candidate,
          checkCount: result.report.checks.length,
          artifactCount: result.report.artifacts.length,
          approvalIndependentlyVerified: false,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `受管真机 PWA 会话机器校验通过：report=${result.reportPath} sha256=${result.reportSha256}\n`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ valid: false, error: message })}\n`);
  process.exitCode = 1;
});
