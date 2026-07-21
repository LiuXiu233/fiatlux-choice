import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { verifyRealAdapterAcceptanceEvidence } from "../packages/integrations/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm exec tsx scripts/verify-real-adapter-acceptance-evidence.ts [选项]

离线校验真实 LLM/GitHub 适配器会话 JSON 与哈希附件，并在全部结构、身份、权限和
文件检查通过后生成不可覆盖的 mode 0600 报告。本命令不读取或使用任何真实凭据，
不执行外部调用，也不独立证明人工观察或批准真实性。

必填选项：
  --session <file>                    mode 0600 的验收会话 JSON
  --evidence-root <dir>              mode 0700 的附件目录
  --report-dir <dir>                 预创建且 mode 0700 的隔离报告目录
  --expected-version <v>             独立批准的目标版本
  --expected-git-sha <sha>           独立批准的 40 位目标 Git SHA
  --expected-url <origin>            独立批准的目标 HTTPS origin
  --expected-environment-id <id>     独立批准的目标环境稳定 ID
  --expected-llm-provider <id>       独立批准的模型提供商稳定 ID
  --expected-llm-endpoint <url>      独立批准的模型 HTTPS 端点
  --expected-llm-model <model>       独立批准的模型名称
  --expected-github-repository <o/r> 独立批准的 GitHub owner/repository

其他选项：
  --json                              输出机器可读结果
  --help                              显示帮助
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
      "expected-llm-provider": { type: "string" },
      "expected-llm-endpoint": { type: "string" },
      "expected-llm-model": { type: "string" },
      "expected-github-repository": { type: "string" },
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

  const result = await verifyRealAdapterAcceptanceEvidence({
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
    expectedLlmProviderId: requireValue(values["expected-llm-provider"], "--expected-llm-provider"),
    expectedLlmEndpoint: requireValue(values["expected-llm-endpoint"], "--expected-llm-endpoint"),
    expectedLlmModel: requireValue(values["expected-llm-model"], "--expected-llm-model"),
    expectedGitHubRepository: requireValue(
      values["expected-github-repository"],
      "--expected-github-repository",
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
          llm: {
            providerId: result.report.llm.providerId,
            endpoint: result.report.llm.endpoint,
            model: result.report.llm.model,
            qualitySampleCount: result.report.llm.qualitySamples.length,
          },
          githubRepository: result.report.github.repository,
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
      `真实适配器会话机器校验通过：report=${result.reportPath} sha256=${result.reportSha256}\n`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ valid: false, error: message })}\n`);
  process.exitCode = 1;
});
