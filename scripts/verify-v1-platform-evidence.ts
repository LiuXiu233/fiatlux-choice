import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { v1ReleaseReadinessManifestSchema } from "../packages/contracts/src/index.js";
import { verifyV1PlatformEvidence } from "../packages/integrations/src/index.js";

const defaultManifestPath = fileURLToPath(
  new URL("../docs/delivery/v1-release-readiness.json", import.meta.url),
);

function printHelp(): void {
  process.stdout.write(
    `用法：tsx scripts/verify-v1-platform-evidence.ts [选项]\n\n只读核验 ready 清单中的 GitHub CI/Security/release run 和七类 GHCR digest。\n当前 blocked 清单会在任何网络请求前失败。\n\n选项：\n  --file <path>  指定发布门禁 JSON\n  --json         以 JSON 输出结果\n  --help         显示帮助\n\n环境：\n  GITHUB_REPOSITORY  owner/name\n  GITHUB_ACTOR       只读核验身份\n  GITHUB_TOKEN       具备 actions:read 与 packages:read 的临时令牌\n`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
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

  const manifestPath = values.file ? resolve(values.file) : defaultManifestPath;
  const unknownManifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = v1ReleaseReadinessManifestSchema.parse(unknownManifest);
  const result = await verifyV1PlatformEvidence(manifest, {
    repository: process.env.GITHUB_REPOSITORY ?? "",
    actor: process.env.GITHUB_ACTOR ?? "",
    token: process.env.GITHUB_TOKEN ?? "",
  });
  const output = {
    valid: true,
    verifiedAt: new Date().toISOString(),
    manifest: manifestPath,
    ...result,
  };
  if (values.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(
      `V1 平台证据通过：${result.githubRuns.length} 个 GitHub run，${result.registryArtifacts.length} 个 GHCR 制品。\n`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ valid: false, error: message })}\n`);
  process.exitCode = 1;
});
