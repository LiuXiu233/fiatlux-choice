import { randomBytes } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  educationContentReviewIds,
  educationLaunchQuestionnaireIds,
  educationLegacyPlaceholderUrls,
} from "../packages/contracts/src/index.js";
import { loadEducationContentSnapshotFromGit } from "../packages/integrations/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm exec tsx scripts/create-education-content-clearance-template.ts [选项]

从指定候选 Git 提交读取两份电竞教育内容包，把 12 篇文章标识、版本、来源和内容哈希
写入一个故意失败关闭的 mode 0600 会话模板。模板不会发布内容或访问 fiatlux.gg；
REPLACE_WITH_*、未通过状态和空附件必须由真实负责人用真实证据替换。

必填选项：
  --output <absolute-file>           新模板绝对路径；父目录须为当前用户所有且 mode 0700
  --repository-root <absolute-dir>   本地 Git 仓库根目录
  --git-sha <sha>                    需要放行的完整 40 位候选提交
  --version <v>                      目标版本 vMAJOR.MINOR.PATCH[-PRERELEASE]
  --url <origin>                     目标 FIAT LUX CHOICE HTTPS origin
  --environment-id <id>             目标环境稳定 ID

其他选项：
  --help                             显示帮助
`);
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`缺少必填选项：${label}`);
  return value;
}

function makeTemplate(
  snapshot: Awaited<ReturnType<typeof loadEducationContentSnapshotFromGit>>,
  identity: { version: string; gitSha: string; baseUrl: string; environmentId: string },
) {
  const generalArtifacts = [
    "questionnaire-proof",
    "review-proof",
    "source-proof",
    "rights-proof",
    "secret-scan",
    "final-approval",
  ];
  const articleArtifacts = snapshot.articles.flatMap((_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [
      `article-${number}-approval`,
      `article-${number}-html`,
      `article-${number}-desktop`,
      `article-${number}-mobile`,
    ];
  });
  const legacyArtifacts = educationLegacyPlaceholderUrls.flatMap((_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`legacy-${number}-http`, `legacy-${number}-visual`];
  });
  const artifactIds = [...generalArtifacts, ...articleArtifacts, ...legacyArtifacts];
  const sessionSuffix = randomBytes(4).toString("hex");
  return {
    schemaVersion: 1,
    evidenceType: "education_content_clearance_session",
    sessionId: `education-clearance-${identity.gitSha.slice(0, 7)}-${sessionSuffix}`,
    candidate: identity,
    execution: {
      startedAt: "REPLACE_WITH_OFFSET_DATETIME",
      finishedAt: "REPLACE_WITH_OFFSET_DATETIME",
      timezone: "Asia/Shanghai",
      operatorIdentity: "REPLACE_WITH_OPERATOR_IDENTITY",
    },
    contentSnapshot: snapshot,
    questionnaire: educationLaunchQuestionnaireIds.map((id) => ({
      id,
      decision: "REPLACE_WITH_CLEARED_AFTER_REVIEW",
      reviewerIdentity: "REPLACE_WITH_REVIEWER_IDENTITY",
      reviewerRole: "REPLACE_WITH_REVIEWER_ROLE",
      reviewedAt: "REPLACE_WITH_OFFSET_DATETIME",
      effectiveFrom: "REPLACE_WITH_YYYY_MM_DD",
      effectiveUntil: null,
      evidenceArtifactIds: ["questionnaire-proof"],
      conclusion: "REPLACE_WITH_AT_LEAST_20_CHARACTERS",
    })),
    articleClearances: snapshot.articles.map((article, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        articleId: article.articleId,
        slug: article.slug,
        version: article.version,
        contentSha256: article.contentSha256,
        responsibleIdentity: "REPLACE_WITH_RESPONSIBLE_IDENTITY",
        reviews: educationContentReviewIds.map((id) => ({
          id,
          result: "REPLACE_WITH_PASSED_AFTER_REVIEW",
          reviewerIdentity: "REPLACE_WITH_REVIEWER_IDENTITY",
          reviewerRole: "REPLACE_WITH_REVIEWER_ROLE",
          reviewerMode: "REPLACE_WITH_DIFFERENT_PERSON_OR_DISCLOSED_DUAL_ROLE",
          reviewedAt: "REPLACE_WITH_OFFSET_DATETIME",
          evidenceArtifactIds: ["review-proof"],
          conclusion: "REPLACE_WITH_AT_LEAST_20_CHARACTERS",
        })),
        sourceClearances: article.sourceRefs.map((sourceRef) => ({
          sourceRef,
          result: "REPLACE_WITH_CURRENT_AND_APPLICABLE_AFTER_REVIEW",
          reviewerIdentity: "REPLACE_WITH_SOURCE_REVIEWER_IDENTITY",
          reviewerRole: "REPLACE_WITH_SOURCE_REVIEWER_ROLE",
          reviewedAt: "REPLACE_WITH_OFFSET_DATETIME",
          evidenceArtifactIds: ["source-proof"],
          applicabilityConclusion: "REPLACE_WITH_AT_LEAST_20_CHARACTERS",
        })),
        rightsMaterials: [
          {
            materialId: `${article.articleId}-text`,
            kind: "article_text",
            description: "REPLACE_WITH_MATERIAL_DESCRIPTION",
            result: "REPLACE_WITH_CLEARED_AFTER_RIGHTS_REVIEW",
            basis: "REPLACE_WITH_VERIFIED_RIGHTS_BASIS",
            rightsHolder: "REPLACE_WITH_RIGHTS_HOLDER",
            territory: "REPLACE_WITH_AUTHORIZED_TERRITORY",
            channels: ["fiatlux_gg_wordpress"],
            expiresAt: null,
            evidenceArtifactIds: ["rights-proof"],
          },
        ],
        blockingIssuesOpen: -1,
        publicationApproval: {
          decision: "REPLACE_WITH_APPROVED",
          approverIdentity: "REPLACE_WITH_APPROVER_IDENTITY",
          approverRole: "REPLACE_WITH_APPROVER_ROLE",
          approverMode: "REPLACE_WITH_DIFFERENT_PERSON_OR_DISCLOSED_DUAL_ROLE",
          approvalReference: "REPLACE_WITH_UNIQUE_ARTICLE_APPROVAL_REFERENCE",
          approvedAt: "REPLACE_WITH_OFFSET_DATETIME",
          evidenceArtifactIds: [`article-${number}-approval`],
        },
        publication: {
          status: "REPLACE_WITH_PUBLISHED_WITH_EVIDENCE",
          targetChannel: "fiatlux_gg_wordpress",
          publicUrl: "REPLACE_WITH_PUBLIC_FIATLUX_GG_URL",
          canonicalUrl: "REPLACE_WITH_IDENTICAL_CANONICAL_URL",
          wordpressPostId: "0",
          publisherIdentity: "REPLACE_WITH_PUBLISHER_IDENTITY",
          publishedAt: "REPLACE_WITH_OFFSET_DATETIME",
          publiclyObservedAt: "REPLACE_WITH_OFFSET_DATETIME",
          httpStatus: 0,
          unauthenticatedAccess: false,
          titleAndVersionVisible: false,
          reviewerAndReviewDateVisible: false,
          correctionEntryVisible: false,
          desktopAndMobileQaPassed: false,
          basicAccessibilityCheckPassed: false,
          placeholderTextAbsent: false,
          displayedVersion: article.version,
          displayedReviewerRole: "REPLACE_WITH_DISPLAYED_REVIEWER_ROLE",
          displayedReviewDate: "REPLACE_WITH_YYYY_MM_DD",
          correctionUrl: "REPLACE_WITH_PUBLIC_CORRECTION_URL",
          htmlExportArtifactId: `article-${number}-html`,
          desktopCaptureArtifactId: `article-${number}-desktop`,
          mobileCaptureArtifactId: `article-${number}-mobile`,
        },
        correctionOwnerIdentity: "REPLACE_WITH_CORRECTION_OWNER_IDENTITY",
        correctionSlaBusinessDays: 0,
        nextReviewAt: "REPLACE_WITH_YYYY_MM_DD",
      };
    }),
    legacyPages: educationLegacyPlaceholderUrls.map((originalUrl, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        originalUrl,
        action: "REPLACE_WITH_WITHDRAWN_REDIRECTED_OR_REWRITTEN_IN_PLACE",
        httpStatus: 0,
        replacementUrl: null,
        mappedArticleId: null,
        observedAt: "REPLACE_WITH_OFFSET_DATETIME",
        placeholderTextAbsent: false,
        httpCaptureArtifactId: `legacy-${number}-http`,
        visualCaptureArtifactId: `legacy-${number}-visual`,
      };
    }),
    privacy: {
      rawWordpressCredentialsCaptured: false,
      authorizationHeadersCaptured: false,
      sessionCookiesCaptured: false,
      learnerPersonalInformationCaptured: false,
      sensitivePersonalInformationCaptured: false,
      reviewerIdentityDisclosureLimited: false,
      secretScanPassed: false,
      secretScanArtifactId: "secret-scan",
    },
    finalApproval: {
      decision: "REPLACE_WITH_APPROVED",
      approverIdentity: "REPLACE_WITH_FINAL_APPROVER_IDENTITY",
      approverRole: "REPLACE_WITH_FINAL_APPROVER_ROLE",
      approverMode: "REPLACE_WITH_DIFFERENT_PERSON_OR_DISCLOSED_DUAL_ROLE",
      approvalReference: "REPLACE_WITH_FINAL_APPROVAL_REFERENCE",
      approvedAt: "REPLACE_WITH_OFFSET_DATETIME",
      evidenceArtifactIds: ["final-approval"],
    },
    artifacts: artifactIds.map((id) => ({
      id,
      file: `captures/${id}.REPLACE_WITH_EXTENSION`,
      sha256: "REPLACE_WITH_64_LOWERCASE_SHA256",
      bytes: 0,
      mimeType: "REPLACE_WITH_ALLOWED_MIME_TYPE",
      capturedAt: "REPLACE_WITH_OFFSET_DATETIME",
      personalInformationScope: "REPLACE_WITH_NONE_OR_REVIEWER_IDENTITY_ONLY",
    })),
  };
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
      version: { type: "string" },
      url: { type: "string" },
      "environment-id": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printHelp();
    return;
  }
  const output = requireValue(values.output, "--output");
  const repositoryRoot = requireValue(values["repository-root"], "--repository-root");
  if (!isAbsolute(output)) throw new Error("--output 必须使用绝对路径");
  if (!isAbsolute(repositoryRoot)) throw new Error("--repository-root 必须使用绝对路径");
  const outputPath = resolve(output);
  const parent = dirname(outputPath);
  const parentStats = await lstat(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error("模板父目录必须是普通目录且不能是符号链接");
  }
  if ((parentStats.mode & 0o777) !== 0o700) throw new Error("模板父目录权限必须精确为 0700");
  const currentUid = process.getuid?.();
  if (currentUid !== undefined && parentStats.uid !== currentUid) {
    throw new Error("模板父目录必须由当前操作者拥有");
  }

  const gitSha = requireValue(values["git-sha"], "--git-sha");
  const snapshot = await loadEducationContentSnapshotFromGit(resolve(repositoryRoot), gitSha);
  const template = makeTemplate(snapshot, {
    version: requireValue(values.version, "--version"),
    gitSha,
    baseUrl: requireValue(values.url, "--url"),
    environmentId: requireValue(values["environment-id"], "--environment-id"),
  });
  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(template, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  process.stdout.write(
    `已创建绑定 ${snapshot.articles.length} 篇候选内容且故意失败关闭的 mode 0600 模板：${outputPath}\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ created: false, error: message })}\n`);
  process.exitCode = 1;
});
