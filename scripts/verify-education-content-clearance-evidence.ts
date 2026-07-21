import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { verifyEducationContentClearanceEvidence } from "../packages/integrations/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm exec tsx scripts/verify-education-content-clearance-evidence.ts [选项]

校验受保护的电竞教育放行会话、候选 Git 内容快照和附件，并对十二篇登记文章及七篇
旧模板 URL 执行无登录、无 Cookie、无重定向跟随的只读 GET。命令不登录、不提交表单、
不操作 WordPress；专业判断、权利有效性、人员身份和批准真实性仍需独立人工复核。

必填选项：
  --session <file>                  mode 0600 的放行会话 JSON
  --evidence-root <dir>            mode 0700 的附件目录
  --report-dir <dir>               预创建且 mode 0700 的隔离报告目录
  --repository-root <dir>           本地 Git 仓库根目录
  --expected-version <v>           独立批准的目标版本
  --expected-git-sha <sha>         独立批准的完整 40 位候选提交
  --expected-url <origin>          独立批准的目标 HTTPS origin
  --expected-environment-id <id>   独立批准的目标环境稳定 ID

其他选项：
  --json                            输出机器可读结果
  --help                            显示帮助
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
      "repository-root": { type: "string" },
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

  const result = await verifyEducationContentClearanceEvidence({
    sessionPath: resolve(requireValue(values.session, "--session")),
    evidenceRoot: resolve(requireValue(values["evidence-root"], "--evidence-root")),
    reportDir: resolve(requireValue(values["report-dir"], "--report-dir")),
    repositoryRoot: resolve(requireValue(values["repository-root"], "--repository-root")),
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
          articleCount: result.report.articles.length,
          questionnaireCount: result.report.questionnaire.length,
          legacyPageCount: result.report.legacyPages.length,
          artifactCount: result.report.artifacts.length,
          unauthenticatedPublicHttpVerified: true,
          approvalIndependentlyVerified: false,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `电竞教育内容放行机器校验通过：report=${result.reportPath} sha256=${result.reportSha256}\n`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ valid: false, error: message })}\n`);
  process.exitCode = 1;
});
