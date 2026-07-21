import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  evaluateV1ReleaseReadiness,
  v1ReleaseReadinessManifestSchema,
} from "../packages/contracts/src/index.js";

const defaultManifestPath = fileURLToPath(
  new URL("../docs/delivery/v1-release-readiness.json", import.meta.url),
);

function printHelp(): void {
  process.stdout.write(
    `用法：tsx scripts/verify-v1-release-readiness.ts [选项]\n\n选项：\n  --file <path>       指定发布门禁 JSON；默认 docs/delivery/v1-release-readiness.json\n  --json              以 JSON 输出校验和就绪状态\n  --validate-only     只校验结构与门禁一致性\n  --require-ready     未达到 ready 时以退出码 2 失败关闭\n  --help              显示帮助\n`,
  );
}

function formatIssuePath(path: PropertyKey[]): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      json: { type: "boolean", default: false },
      "validate-only": { type: "boolean", default: false },
      "require-ready": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const manifestPath = values.file ? resolve(values.file) : defaultManifestPath;
  let unknownManifest: unknown;
  try {
    unknownManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (values.json) {
      process.stderr.write(
        `${JSON.stringify({ valid: false, file: manifestPath, error: message })}\n`,
      );
    } else {
      process.stderr.write(`无法读取 V1 发布门禁清单 ${manifestPath}：${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const parsed = v1ReleaseReadinessManifestSchema.safeParse(unknownManifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ path, message }) => ({
      path: formatIssuePath(path),
      message,
    }));
    if (values.json) {
      process.stderr.write(
        `${JSON.stringify({ valid: false, file: manifestPath, issues }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`V1 发布门禁清单无效：${manifestPath}\n`);
      for (const issue of issues) process.stderr.write(`- ${issue.path}: ${issue.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluateV1ReleaseReadiness(parsed.data);
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          valid: true,
          file: manifestPath,
          schemaVersion: parsed.data.schemaVersion,
          versionLabel: parsed.data.versionLabel,
          evaluatedAt: parsed.data.evaluatedAt,
          candidate: parsed.data.candidate,
          ...evaluation,
        },
        null,
        2,
      )}\n`,
    );
  } else if (values["validate-only"]) {
    process.stdout.write(`V1 发布门禁清单结构有效：${manifestPath}\n`);
  } else {
    process.stdout.write(
      `V1 发布状态：${evaluation.overallStatus}；通过 ${evaluation.passedGateCount}/${evaluation.totalGateCount}；阻断 ${evaluation.blockedGateCount}。\n`,
    );
    for (const gate of evaluation.blockedGates) {
      process.stdout.write(`- ${gate.id}（${gate.ownerRole}）：${gate.blockers.join("；")}\n`);
    }
  }

  if (values["require-ready"] && !evaluation.ready) {
    if (!values.json) process.stderr.write("V1 发布门禁尚未全部关闭；拒绝标记为 ready。\n");
    process.exitCode = 2;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`V1 发布门禁校验器异常：${message}\n`);
  process.exitCode = 1;
});
