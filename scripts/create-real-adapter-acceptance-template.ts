import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  realAdapterAcceptanceCheckIds,
  realAdapterAdvisorKeys,
} from "../packages/contracts/src/index.js";

function printHelp(): void {
  process.stdout.write(`用法：pnpm exec tsx scripts/create-real-adapter-acceptance-template.ts --output <absolute-file>

在预创建、当前操作者所有且 mode 0700 的目录中，以 mode 0600 独占创建真实适配器
验收会话模板。模板故意包含 REPLACE_WITH_* 和未通过状态，填写真实证据前不能通过 verifier。
`);
}

function makeTemplate() {
  const artifacts = [
    "runtime-audit",
    "provider-review",
    "pricing-proof",
    "github-permissions",
    "fallback-config",
    "secret-scan",
  ];
  const replaceUuid = "REPLACE_WITH_UUID";
  const replaceSha256 = "REPLACE_WITH_64_LOWERCASE_SHA256";
  return {
    schemaVersion: 1,
    evidenceType: "real_adapter_acceptance_session",
    sessionId: "REPLACE_WITH_UNIQUE_SESSION_ID",
    candidate: {
      version: "REPLACE_WITH_VMAJOR_MINOR_PATCH",
      gitSha: "REPLACE_WITH_40_LOWERCASE_GIT_SHA",
      baseUrl: "REPLACE_WITH_TARGET_HTTPS_ORIGIN",
      environmentId: "REPLACE_WITH_TARGET_ENVIRONMENT_ID",
    },
    execution: {
      startedAt: "REPLACE_WITH_OFFSET_DATETIME",
      finishedAt: "REPLACE_WITH_OFFSET_DATETIME",
      timezone: "Asia/Shanghai",
      operatorIdentity: "REPLACE_WITH_OPERATOR_IDENTITY",
      assertedApprovalReference: "REPLACE_WITH_APPROVAL_REFERENCE",
    },
    llm: {
      mode: "compatible",
      providerId: "REPLACE_WITH_APPROVED_PROVIDER_ID",
      endpoint: "REPLACE_WITH_APPROVED_HTTPS_ENDPOINT",
      model: "REPLACE_WITH_APPROVED_MODEL",
      maxOutputTokens: 0,
      credential: {
        kind: "provider_api_key",
        fingerprintSha256: replaceSha256,
        expiresAt: "REPLACE_WITH_OFFSET_DATETIME",
        rawCredentialRecorded: false,
        injectedIntoServices: ["REPLACE_WITH_WORKER_ONLY_AFTER_VERIFICATION"],
        secretStoreReference: "REPLACE",
      },
      liveConnectionCheckId: replaceUuid,
      qualityReviewer: {
        identity: "REPLACE_WITH_REVIEWER_IDENTITY",
        role: "REPLACE_WITH_REVIEWER_ROLE",
        reviewedAt: "REPLACE_WITH_OFFSET_DATETIME",
        rubricVersion: "advisor-quality-v1",
      },
      qualitySamples: realAdapterAdvisorKeys.map((advisor) => ({
        advisor,
        runId: replaceUuid,
        modelCallId: replaceUuid,
        promptVersionId: replaceUuid,
        completedAt: "REPLACE_WITH_OFFSET_DATETIME",
        providerId: "REPLACE_WITH_APPROVED_PROVIDER_ID",
        model: "REPLACE_WITH_APPROVED_MODEL",
        status: "REPLACE_WITH_COMPLETED",
        mockOrSyntheticProvider: false,
        dataClassification: "REPLACE_WITH_REDACTED_COMPANY_RECORDS",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        toolCallIds: [replaceUuid],
        citationCount: 0,
        rawResponseAuditPresent: "REPLACE_WITH_TRUE_AFTER_VERIFICATION",
        scores: {
          factualGrounding: 0,
          evidenceTraceability: 0,
          factInferenceSeparation: 0,
          actionability: 0,
          safetyBoundaries: 0,
        },
        reviewerNote: "REPLACE_WITH_AT_LEAST_20_CHARACTERS",
        passed: false,
      })),
      humanEditAudit: {
        runId: replaceUuid,
        editId: replaceUuid,
        auditEventId: replaceUuid,
        editedByUserId: replaceUuid,
        editedAt: "REPLACE_WITH_OFFSET_DATETIME",
        reasonRecorded: "REPLACE_WITH_TRUE_AFTER_VERIFICATION",
        beforeAndAfterRetained: "REPLACE_WITH_TRUE_AFTER_VERIFICATION",
      },
      dataProcessing: {
        agreementReference: "REPLACE_WITH_VENDOR_REVIEW_REFERENCE",
        reviewArtifactId: "provider-review",
        processingRegions: ["REPLACE_WITH_REVIEWED_REGION"],
        retentionDays: -1,
        customerDataTraining: "REPLACE_WITH_DISABLED_AFTER_VERIFICATION",
        subprocessorsReviewed: false,
        deletionMechanismReviewed: false,
        incidentNotificationReviewed: false,
        crossBorderLegalReview: "REPLACE_WITH_REVIEWED_STATUS",
        personalInformationSentInAcceptance: false,
        sensitivePersonalInformationSentInAcceptance: false,
        termsLastReviewedAt: "REPLACE_WITH_OFFSET_DATETIME",
      },
      cost: {
        currency: "CNY",
        hardMonthlyLimitMinorUnits: 0,
        alertThresholdMinorUnits: 0,
        acceptanceCostMinorUnits: 0,
        observedInputTokens: 0,
        observedOutputTokens: 0,
        usageRecordedByApplication: false,
        providerBudgetEnforced: false,
        pricingArtifactId: "pricing-proof",
      },
    },
    github: {
      mode: "read_only",
      apiOrigin: "https://api.github.com",
      repository: "REPLACE_WITH_OWNER_REPOSITORY",
      credential: {
        kind: "REPLACE_WITH_FINE_GRAINED_PAT_OR_GITHUB_APP_INSTALLATION",
        fingerprintSha256: replaceSha256,
        expiresAt: "REPLACE_WITH_OFFSET_DATETIME",
        rawCredentialRecorded: false,
        injectedIntoServices: ["REPLACE_WITH_WORKER_ONLY_AFTER_VERIFICATION"],
        secretStoreReference: "REPLACE",
      },
      repositorySelection: "selected_repositories",
      selectedRepositories: ["REPLACE_WITH_OWNER_REPOSITORY"],
      permissions: {
        metadata: "read",
        contents: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        actions: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        administration: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        issues: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        pullRequests: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        workflows: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
        members: "REPLACE_WITH_NONE_AFTER_VERIFICATION",
      },
      permissionProofArtifactId: "github-permissions",
      liveRead: {
        integrationCheckId: replaceUuid,
        insightId: replaceUuid,
        refreshAuditEventId: replaceUuid,
        capturedAt: "REPLACE_WITH_OFFSET_DATETIME",
        httpMethod: "GET",
        redirectPolicy: "error",
        authenticatedRequest: false,
        requestedRepository: "REPLACE_WITH_OWNER_REPOSITORY",
        returnedRepository: "REPLACE_WITH_OWNER_REPOSITORY",
        repositoryIdentityMatched: false,
        status: "REPLACE_WITH_HEALTHY",
      },
    },
    drills: {
      llmCredentialRotation: {
        previousCredentialFingerprintSha256: replaceSha256,
        revokedAt: "REPLACE_WITH_OFFSET_DATETIME",
        postRevocationCheckId: replaceUuid,
        postRevocationStatus: "REPLACE_WITH_UNHEALTHY",
        secretAbsentFromFailureEvidence: false,
        replacementCredentialFingerprintSha256: replaceSha256,
        replacementActivatedAt: "REPLACE_WITH_OFFSET_DATETIME",
        recoveryCheckId: replaceUuid,
        recoveryStatus: "REPLACE_WITH_HEALTHY",
        recoveryCompletedAt: "REPLACE_WITH_OFFSET_DATETIME",
      },
      githubCredentialRotation: {
        previousCredentialFingerprintSha256: replaceSha256,
        revokedAt: "REPLACE_WITH_OFFSET_DATETIME",
        postRevocationCheckId: replaceUuid,
        postRevocationStatus: "REPLACE_WITH_UNHEALTHY",
        secretAbsentFromFailureEvidence: false,
        replacementCredentialFingerprintSha256: replaceSha256,
        replacementActivatedAt: "REPLACE_WITH_OFFSET_DATETIME",
        recoveryCheckId: replaceUuid,
        recoveryStatus: "REPLACE_WITH_HEALTHY",
        recoveryCompletedAt: "REPLACE_WITH_OFFSET_DATETIME",
      },
      fallback: {
        exercisedAt: "REPLACE_WITH_OFFSET_DATETIME",
        llmMode: "disabled",
        llmCheckId: replaceUuid,
        llmStatus: "REPLACE_WITH_DISABLED",
        githubMode: "manual",
        githubCheckId: replaceUuid,
        githubStatus: "REPLACE_WITH_MANUAL",
        externalNetworkCallsObserved: false,
        configEvidenceArtifactId: "fallback-config",
      },
    },
    privacy: {
      rawCredentialsCaptured: false,
      authorizationHeadersCaptured: false,
      sessionCookiesCaptured: false,
      rawProviderResponsesExported: false,
      companyDataRedactedInArtifacts: false,
      personalInformationInArtifacts: false,
      repositorySecretsInArtifacts: false,
      secretScanArtifactId: "secret-scan",
    },
    checks: realAdapterAcceptanceCheckIds.map((id, index) => ({
      id,
      result: "REPLACE_WITH_PASSED_AFTER_VERIFICATION",
      observedAt: "REPLACE_WITH_OFFSET_DATETIME",
      artifactIds: [artifacts[index % artifacts.length]],
      note: "REPLACE_WITH_AT_LEAST_10_CHARACTERS",
    })),
    artifacts: artifacts.map((id) => ({
      id,
      file: `captures/${id}.REPLACE_WITH_EXTENSION`,
      sha256: replaceSha256,
      bytes: 0,
      mimeType: "REPLACE_WITH_ALLOWED_MIME_TYPE",
      capturedAt: "REPLACE_WITH_OFFSET_DATETIME",
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
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printHelp();
    return;
  }
  if (!values.output) throw new Error("缺少必填选项：--output");
  if (!isAbsolute(values.output)) throw new Error("--output 必须使用绝对路径");
  const outputPath = resolve(values.output);
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

  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(makeTemplate(), null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  process.stdout.write(`已创建故意失败关闭的 mode 0600 模板：${outputPath}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ created: false, error: message })}\n`);
  process.exitCode = 1;
});
