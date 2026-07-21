import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { mergeEducationContentPackages } from "../apps/web/src/lib/education-content-library.js";
import {
  buildEducationWordPressReviewBundle,
  loadEducationContentCandidateFromGit,
} from "../packages/integrations/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm content:education:review-bundle -- [选项]

从完整候选 Git SHA 读取两份内容包并生成 mode 0700 的 WordPress 内部审阅目录。
每篇 HTML 都带 FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH 可见标记；本工具不联网、不登录、
不调用 WordPress API，也不把文件生成解释为发布、专业复核、权利许可或人工批准。

必填选项：
  --output <absolute-directory>      不存在的输出目录；父目录须由当前用户拥有且精确为 0700
  --repository-root <absolute-dir>   本地 Git 仓库根目录
  --git-sha <sha>                    需要审阅的完整小写 40 位候选提交

其他选项：
  --json                             输出机器可读摘要
  --help                             显示帮助
`);
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`缺少必填选项：${label}`);
  return value;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return candidate.startsWith(prefix);
}

async function requireProtectedParent(outputPath: string): Promise<string> {
  if (!isAbsolute(outputPath)) throw new Error("输出目录必须使用绝对路径");
  const parentPath = dirname(outputPath);
  const parentStats = await lstat(parentPath);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error("输出父路径必须是普通目录且不能是符号链接");
  }
  const currentUid = process.getuid?.();
  if (currentUid !== undefined && parentStats.uid !== currentUid) {
    throw new Error("输出父目录必须由当前操作者拥有");
  }
  if ((parentStats.mode & 0o777) !== 0o700) {
    throw new Error("输出父目录权限必须精确为 0700");
  }
  const canonicalParent = await realpath(parentPath);
  if (canonicalParent !== resolve(parentPath)) {
    throw new Error("输出父目录路径不得经过符号链接");
  }
  return canonicalParent;
}

async function writeProtectedFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({
    args,
    options: {
      output: { type: "string" },
      "repository-root": { type: "string" },
      "git-sha": { type: "string" },
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
  const outputInput = requireValue(values.output, "--output");
  const repositoryInput = requireValue(values["repository-root"], "--repository-root");
  if (!isAbsolute(outputInput)) throw new Error("输出目录必须使用绝对路径");
  if (!isAbsolute(repositoryInput)) throw new Error("仓库根目录必须使用绝对路径");
  const outputPath = resolve(outputInput);
  const repositoryRoot = resolve(repositoryInput);
  const gitSha = requireValue(values["git-sha"], "--git-sha");
  const outputParent = await requireProtectedParent(outputPath);
  if (!pathIsWithin(outputParent, outputPath)) {
    throw new Error("输出目录必须位于受保护父目录内");
  }

  const candidate = await loadEducationContentCandidateFromGit(repositoryRoot, gitSha);
  const library = mergeEducationContentPackages(
    candidate.documents.map(({ document }) => document),
  );
  const bundle = buildEducationWordPressReviewBundle({
    candidateGitSha: gitSha,
    generatedAt: new Date().toISOString(),
    sourceSnapshot: candidate.snapshot,
    library,
  });

  await mkdir(outputPath, { mode: 0o700 });
  await mkdir(resolve(outputPath, "articles"), { mode: 0o700 });
  await mkdir(resolve(outputPath, "reviews"), { mode: 0o700 });
  await chmod(outputPath, 0o700);
  await chmod(resolve(outputPath, "articles"), 0o700);
  await chmod(resolve(outputPath, "reviews"), 0o700);

  const manifestFile = bundle.files.find(({ path }) => path === "manifest.json");
  if (!manifestFile) throw new Error("审阅包内部错误：缺少 manifest.json");
  for (const file of bundle.files.filter(({ path }) => path !== "manifest.json")) {
    const destination = resolve(outputPath, file.path);
    if (!pathIsWithin(outputPath, destination)) {
      throw new Error(`审阅包文件路径越出输出目录：${file.path}`);
    }
    await writeProtectedFile(destination, file.content);
  }
  await writeProtectedFile(resolve(outputPath, "manifest.json"), manifestFile.content);

  const summary = {
    output: outputPath,
    gitSha,
    articleCount: bundle.manifest.summary.articleCount,
    publicationEligibleCount: bundle.manifest.summary.publicationEligibleCount,
    blockedArticleCount: bundle.manifest.summary.blockedArticleCount,
    externalPublicationPerformed: bundle.manifest.safety.externalPublicationPerformed,
    wordpressApiCalled: bundle.manifest.safety.wordpressApiCalled,
    reviewOnlyMarker: bundle.manifest.safety.reviewOnlyMarker,
  };
  process.stdout.write(
    values.json
      ? `${JSON.stringify(summary)}\n`
      : `已生成绑定 ${gitSha} 的 WordPress 内部审阅包：${outputPath}\n文章 ${summary.articleCount} 篇，可进入人工发布准备 ${summary.publicationEligibleCount} 篇，阻断 ${summary.blockedArticleCount} 篇；未执行任何外部发布。\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`生成电竞教育 WordPress 内部审阅包失败：${message}\n`);
  process.exitCode = 1;
});
