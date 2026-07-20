import { z } from "zod";

export const realAdapterAdvisorKeys = [
  "general_manager",
  "finance",
  "legal_compliance",
  "product_rnd",
  "market_opportunity",
  "hr_admin",
  "information_security",
] as const;

export const realAdapterAcceptanceCheckIds = [
  "candidate_and_target_identity",
  "worker_only_secret_injection",
  "llm_live_structured_output",
  "advisor_scope_and_audit",
  "llm_quality_review",
  "provider_data_processing",
  "cost_ceiling_and_usage",
  "github_authenticated_read",
  "github_least_privilege",
  "credential_revocation_and_rotation",
  "disabled_manual_fallback",
  "secret_cleanup",
] as const;

const offsetDateTimeSchema = z.string().datetime({ offset: true });
const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/, "必须使用完整小写 Git commit SHA");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "必须使用 64 位小写 SHA-256");
const uuidSchema = z.string().uuid();
const stableIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{2,119}$/, "必须是 3–120 位小写稳定标识");
const evidenceReferenceSchema = z
  .string()
  .trim()
  .min(5)
  .max(2_000)
  .refine(
    (value) =>
      !/(?:^|[:/_-])(?:pending|todo|tbd|unknown|none|placeholder|replace(?:_with)?)(?:$|[:/_-])/i.test(
        value,
      ),
    "证据引用不能包含占位值",
  );
const artifactIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,79}$/, "附件 ID 必须是 3–80 位小写稳定标识");
const relativeEvidencePathSchema = z
  .string()
  .trim()
  .min(3)
  .max(240)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "证据文件必须使用无路径穿越的相对 POSIX 路径",
  );
const versionSchema = z
  .string()
  .regex(
    /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
    "必须使用 vMAJOR.MINOR.PATCH[-PRERELEASE]",
  );
const targetOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
      );
    } catch {
      return false;
    }
  }, "必须是无 userinfo、path、query 或 fragment 的 HTTPS origin");
const providerEndpointSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !url.pathname.split("/").includes("..")
      );
    } catch {
      return false;
    }
  }, "模型端点必须是无 userinfo、query、fragment 或路径穿越的 HTTPS URL");
const githubRepositorySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/,
    "必须使用 owner/repository",
  )
  .refine((value) => !value.endsWith("/.") && !value.endsWith("/.."), "仓库名无效");

const workerCredentialSchema = z
  .object({
    kind: z.enum(["provider_api_key", "fine_grained_pat", "github_app_installation"]),
    fingerprintSha256: sha256Schema,
    expiresAt: offsetDateTimeSchema,
    rawCredentialRecorded: z.literal(false),
    injectedIntoServices: z.tuple([z.literal("worker")]),
    secretStoreReference: evidenceReferenceSchema,
  })
  .strict();

const qualityScoreSchema = z.number().int().min(4).max(5);
const advisorQualitySampleSchema = z
  .object({
    advisor: z.enum(realAdapterAdvisorKeys),
    runId: uuidSchema,
    modelCallId: uuidSchema,
    promptVersionId: uuidSchema,
    completedAt: offsetDateTimeSchema,
    providerId: stableIdSchema,
    model: z.string().trim().min(1).max(200),
    status: z.literal("completed"),
    mockOrSyntheticProvider: z.literal(false),
    dataClassification: z.literal("redacted_company_records"),
    inputTokens: z.number().int().min(1).max(100_000_000),
    outputTokens: z.number().int().min(1).max(10_000_000),
    latencyMs: z.number().int().min(1).max(3_600_000),
    toolCallIds: z.array(uuidSchema).min(1).max(100),
    citationCount: z.number().int().min(0).max(10_000),
    rawResponseAuditPresent: z.literal(true),
    scores: z
      .object({
        factualGrounding: qualityScoreSchema,
        evidenceTraceability: qualityScoreSchema,
        factInferenceSeparation: qualityScoreSchema,
        actionability: qualityScoreSchema,
        safetyBoundaries: qualityScoreSchema,
      })
      .strict(),
    reviewerNote: z.string().trim().min(20).max(2_000),
    passed: z.literal(true),
  })
  .strict();

const credentialRotationDrillSchema = z
  .object({
    previousCredentialFingerprintSha256: sha256Schema,
    revokedAt: offsetDateTimeSchema,
    postRevocationCheckId: uuidSchema,
    postRevocationStatus: z.literal("unhealthy"),
    secretAbsentFromFailureEvidence: z.literal(true),
    replacementCredentialFingerprintSha256: sha256Schema,
    replacementActivatedAt: offsetDateTimeSchema,
    recoveryCheckId: uuidSchema,
    recoveryStatus: z.literal("healthy"),
    recoveryCompletedAt: offsetDateTimeSchema,
  })
  .strict();

const artifactSchema = z
  .object({
    id: artifactIdSchema,
    file: relativeEvidencePathSchema,
    sha256: sha256Schema,
    bytes: z.number().int().min(1).max(250_000_000),
    mimeType: z.enum([
      "application/json",
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/csv",
      "text/plain",
    ]),
    capturedAt: offsetDateTimeSchema,
  })
  .strict();

export const realAdapterAcceptanceSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceType: z.literal("real_adapter_acceptance_session"),
    sessionId: z.string().regex(/^[a-z0-9][a-z0-9._-]{7,119}$/),
    candidate: z
      .object({
        version: versionSchema,
        gitSha: gitCommitSchema,
        baseUrl: targetOriginSchema,
        environmentId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$/, "环境 ID 必须是稳定标识"),
      })
      .strict(),
    execution: z
      .object({
        startedAt: offsetDateTimeSchema,
        finishedAt: offsetDateTimeSchema,
        timezone: z.literal("Asia/Shanghai"),
        operatorIdentity: z.string().trim().min(2).max(200),
        assertedApprovalReference: evidenceReferenceSchema,
      })
      .strict(),
    llm: z
      .object({
        mode: z.literal("compatible"),
        providerId: stableIdSchema.refine(
          (value) => !/(?:mock|simulat|disabled)/i.test(value),
          "真实提供商标识不能伪装成 mock、simulated 或 disabled",
        ),
        endpoint: providerEndpointSchema,
        model: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "模型名称不能包含控制字符"),
        maxOutputTokens: z.number().int().min(128).max(32_768),
        credential: workerCredentialSchema.extend({ kind: z.literal("provider_api_key") }).strict(),
        liveConnectionCheckId: uuidSchema,
        qualityReviewer: z
          .object({
            identity: z.string().trim().min(2).max(200),
            role: z.string().trim().min(2).max(200),
            reviewedAt: offsetDateTimeSchema,
            rubricVersion: stableIdSchema,
          })
          .strict(),
        qualitySamples: z.array(advisorQualitySampleSchema).length(realAdapterAdvisorKeys.length),
        humanEditAudit: z
          .object({
            runId: uuidSchema,
            editId: uuidSchema,
            auditEventId: uuidSchema,
            editedByUserId: uuidSchema,
            editedAt: offsetDateTimeSchema,
            reasonRecorded: z.literal(true),
            beforeAndAfterRetained: z.literal(true),
          })
          .strict(),
        dataProcessing: z
          .object({
            agreementReference: evidenceReferenceSchema,
            reviewArtifactId: artifactIdSchema,
            processingRegions: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
            retentionDays: z.number().int().min(0).max(365),
            customerDataTraining: z.literal("disabled"),
            subprocessorsReviewed: z.literal(true),
            deletionMechanismReviewed: z.literal(true),
            incidentNotificationReviewed: z.literal(true),
            crossBorderLegalReview: z.enum([
              "not_applicable_no_cross_border",
              "approved_legal_mechanism",
            ]),
            personalInformationSentInAcceptance: z.literal(false),
            sensitivePersonalInformationSentInAcceptance: z.literal(false),
            termsLastReviewedAt: offsetDateTimeSchema,
          })
          .strict(),
        cost: z
          .object({
            currency: z.literal("CNY"),
            hardMonthlyLimitMinorUnits: z.number().int().min(100).max(100_000_000),
            alertThresholdMinorUnits: z.number().int().min(1).max(100_000_000),
            acceptanceCostMinorUnits: z.number().int().min(0).max(100_000_000),
            observedInputTokens: z.number().int().min(1).max(700_000_000),
            observedOutputTokens: z.number().int().min(1).max(70_000_000),
            usageRecordedByApplication: z.literal(true),
            providerBudgetEnforced: z.literal(true),
            pricingArtifactId: artifactIdSchema,
          })
          .strict(),
      })
      .strict(),
    github: z
      .object({
        mode: z.literal("read_only"),
        apiOrigin: z.literal("https://api.github.com"),
        repository: githubRepositorySchema,
        credential: workerCredentialSchema.extend({
          kind: z.enum(["fine_grained_pat", "github_app_installation"]),
        }),
        repositorySelection: z.literal("selected_repositories"),
        selectedRepositories: z.array(githubRepositorySchema).length(1),
        permissions: z
          .object({
            metadata: z.literal("read"),
            contents: z.literal("none"),
            actions: z.literal("none"),
            administration: z.literal("none"),
            issues: z.literal("none"),
            pullRequests: z.literal("none"),
            workflows: z.literal("none"),
            members: z.literal("none"),
          })
          .strict(),
        permissionProofArtifactId: artifactIdSchema,
        liveRead: z
          .object({
            integrationCheckId: uuidSchema,
            insightId: uuidSchema,
            refreshAuditEventId: uuidSchema,
            capturedAt: offsetDateTimeSchema,
            httpMethod: z.literal("GET"),
            redirectPolicy: z.literal("error"),
            authenticatedRequest: z.literal(true),
            requestedRepository: githubRepositorySchema,
            returnedRepository: githubRepositorySchema,
            repositoryIdentityMatched: z.literal(true),
            status: z.literal("healthy"),
          })
          .strict(),
      })
      .strict(),
    drills: z
      .object({
        llmCredentialRotation: credentialRotationDrillSchema,
        githubCredentialRotation: credentialRotationDrillSchema,
        fallback: z
          .object({
            exercisedAt: offsetDateTimeSchema,
            llmMode: z.literal("disabled"),
            llmCheckId: uuidSchema,
            llmStatus: z.literal("disabled"),
            githubMode: z.literal("manual"),
            githubCheckId: uuidSchema,
            githubStatus: z.literal("manual"),
            externalNetworkCallsObserved: z.literal(false),
            configEvidenceArtifactId: artifactIdSchema,
          })
          .strict(),
      })
      .strict(),
    privacy: z
      .object({
        rawCredentialsCaptured: z.literal(false),
        authorizationHeadersCaptured: z.literal(false),
        sessionCookiesCaptured: z.literal(false),
        rawProviderResponsesExported: z.literal(false),
        companyDataRedactedInArtifacts: z.literal(true),
        personalInformationInArtifacts: z.literal(false),
        repositorySecretsInArtifacts: z.literal(false),
        secretScanArtifactId: artifactIdSchema,
      })
      .strict(),
    checks: z
      .array(
        z
          .object({
            id: z.enum(realAdapterAcceptanceCheckIds),
            result: z.literal("passed"),
            observedAt: offsetDateTimeSchema,
            artifactIds: z.array(artifactIdSchema).min(1).max(20),
            note: z.string().trim().min(10).max(1_000),
          })
          .strict(),
      )
      .length(realAdapterAcceptanceCheckIds.length),
    artifacts: z.array(artifactSchema).min(6).max(60),
  })
  .strict()
  .superRefine((session, context) => {
    const startedAt = Date.parse(session.execution.startedAt);
    const finishedAt = Date.parse(session.execution.finishedAt);
    const addIssue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (startedAt >= finishedAt) {
      addIssue(["execution", "finishedAt"], "finishedAt 必须晚于 startedAt");
    }

    const sampleRunIds = new Set<string>();
    const modelCallIds = new Set<string>();
    const promptVersionIds = new Set<string>();
    let observedInputTokens = 0;
    let observedOutputTokens = 0;
    for (const [index, sample] of session.llm.qualitySamples.entries()) {
      if (sample.advisor !== realAdapterAdvisorKeys[index]) {
        addIssue(
          ["llm", "qualitySamples", index, "advisor"],
          `质量样本必须按固定顺序覆盖七类顾问：${realAdapterAdvisorKeys[index]}`,
        );
      }
      if (sample.providerId !== session.llm.providerId || sample.model !== session.llm.model) {
        addIssue(
          ["llm", "qualitySamples", index],
          "质量样本的 provider/model 必须与本次批准配置一致",
        );
      }
      const completedAt = Date.parse(sample.completedAt);
      if (completedAt < startedAt || completedAt > finishedAt) {
        addIssue(
          ["llm", "qualitySamples", index, "completedAt"],
          "真实顾问运行必须位于验收会话窗口内",
        );
      }
      if (sampleRunIds.has(sample.runId)) {
        addIssue(["llm", "qualitySamples", index, "runId"], "七类顾问必须使用不同 runId");
      }
      if (modelCallIds.has(sample.modelCallId)) {
        addIssue(
          ["llm", "qualitySamples", index, "modelCallId"],
          "七类顾问必须使用不同 modelCallId",
        );
      }
      if (promptVersionIds.has(sample.promptVersionId)) {
        addIssue(
          ["llm", "qualitySamples", index, "promptVersionId"],
          "七类顾问必须绑定各自不同的提示词版本记录",
        );
      }
      sampleRunIds.add(sample.runId);
      modelCallIds.add(sample.modelCallId);
      promptVersionIds.add(sample.promptVersionId);
      observedInputTokens += sample.inputTokens;
      observedOutputTokens += sample.outputTokens;
    }
    if (!sampleRunIds.has(session.llm.humanEditAudit.runId)) {
      addIssue(["llm", "humanEditAudit", "runId"], "人工修改演练必须绑定本次七类真实顾问样本之一");
    }
    const editedAt = Date.parse(session.llm.humanEditAudit.editedAt);
    if (editedAt < startedAt || editedAt > finishedAt) {
      addIssue(["llm", "humanEditAudit", "editedAt"], "人工修改必须位于验收会话窗口内");
    }
    if (
      observedInputTokens !== session.llm.cost.observedInputTokens ||
      observedOutputTokens !== session.llm.cost.observedOutputTokens
    ) {
      addIssue(["llm", "cost"], "成本汇总 token 必须精确等于七类真实顾问模型调用记录之和");
    }
    if (
      session.llm.cost.alertThresholdMinorUnits >= session.llm.cost.hardMonthlyLimitMinorUnits ||
      session.llm.cost.acceptanceCostMinorUnits > session.llm.cost.hardMonthlyLimitMinorUnits
    ) {
      addIssue(["llm", "cost"], "告警阈值必须低于硬上限，且本次验收成本不能突破硬上限");
    }
    if (Date.parse(session.llm.qualityReviewer.reviewedAt) > finishedAt) {
      addIssue(["llm", "qualityReviewer", "reviewedAt"], "质量复核时间不能晚于会话结束时间");
    }
    if (Date.parse(session.llm.dataProcessing.termsLastReviewedAt) > finishedAt) {
      addIssue(
        ["llm", "dataProcessing", "termsLastReviewedAt"],
        "供应商条款复核时间不能晚于会话结束时间",
      );
    }

    if (
      session.github.selectedRepositories[0]?.toLowerCase() !==
        session.github.repository.toLowerCase() ||
      session.github.liveRead.requestedRepository.toLowerCase() !==
        session.github.repository.toLowerCase() ||
      session.github.liveRead.returnedRepository.toLowerCase() !==
        session.github.repository.toLowerCase()
    ) {
      addIssue(["github", "repository"], "令牌选定仓库、请求仓库和返回仓库必须完全一致");
    }
    const githubCapturedAt = Date.parse(session.github.liveRead.capturedAt);
    if (githubCapturedAt < startedAt || githubCapturedAt > finishedAt) {
      addIssue(["github", "liveRead", "capturedAt"], "GitHub 真实读取必须位于验收会话窗口内");
    }

    for (const [name, credential, drill] of [
      ["llm", session.llm.credential, session.drills.llmCredentialRotation],
      ["github", session.github.credential, session.drills.githubCredentialRotation],
    ] as const) {
      if (
        credential.fingerprintSha256 !== drill.replacementCredentialFingerprintSha256 ||
        drill.previousCredentialFingerprintSha256 === drill.replacementCredentialFingerprintSha256
      ) {
        addIssue(
          ["drills", `${name}CredentialRotation`],
          "当前凭据必须是与已撤销旧凭据不同的替换凭据",
        );
      }
      const revokedAt = Date.parse(drill.revokedAt);
      const replacementAt = Date.parse(drill.replacementActivatedAt);
      const recoveryAt = Date.parse(drill.recoveryCompletedAt);
      if (
        revokedAt < startedAt ||
        replacementAt <= revokedAt ||
        recoveryAt < replacementAt ||
        recoveryAt > finishedAt
      ) {
        addIssue(
          ["drills", `${name}CredentialRotation`],
          "撤销、替换和恢复必须按顺序发生且位于会话窗口内",
        );
      }
    }
    const fallbackAt = Date.parse(session.drills.fallback.exercisedAt);
    if (fallbackAt < startedAt || fallbackAt > finishedAt) {
      addIssue(["drills", "fallback", "exercisedAt"], "停用/人工回退必须位于验收会话窗口内");
    }

    const artifactIds = new Set<string>();
    const artifactFiles = new Set<string>();
    for (const [index, artifact] of session.artifacts.entries()) {
      if (artifactIds.has(artifact.id)) {
        addIssue(["artifacts", index, "id"], "附件 ID 不能重复");
      }
      if (artifactFiles.has(artifact.file)) {
        addIssue(["artifacts", index, "file"], "附件路径不能重复");
      }
      artifactIds.add(artifact.id);
      artifactFiles.add(artifact.file);
      if (
        ["application/json", "text/csv", "text/plain"].includes(artifact.mimeType) &&
        artifact.bytes > 10_000_000
      ) {
        addIssue(["artifacts", index, "bytes"], "需要读取并扫描的文本附件不得超过 10 MB");
      }
      const capturedAt = Date.parse(artifact.capturedAt);
      if (capturedAt < startedAt || capturedAt > finishedAt) {
        addIssue(["artifacts", index, "capturedAt"], "附件采集时间必须位于验收会话窗口内");
      }
    }

    const requiredArtifactReferences = [
      session.llm.dataProcessing.reviewArtifactId,
      session.llm.cost.pricingArtifactId,
      session.github.permissionProofArtifactId,
      session.drills.fallback.configEvidenceArtifactId,
      session.privacy.secretScanArtifactId,
    ];
    for (const artifactId of requiredArtifactReferences) {
      if (!artifactIds.has(artifactId)) {
        addIssue(["artifacts"], `结构化验收字段引用了不存在的附件：${artifactId}`);
      }
    }

    const referencedArtifactIds = new Set<string>();
    let previousObservedAt = startedAt;
    for (const [index, check] of session.checks.entries()) {
      if (check.id !== realAdapterAcceptanceCheckIds[index]) {
        addIssue(
          ["checks", index, "id"],
          `检查必须按固定顺序出现：${realAdapterAcceptanceCheckIds[index]}`,
        );
      }
      const observedAt = Date.parse(check.observedAt);
      if (observedAt < startedAt || observedAt > finishedAt || observedAt < previousObservedAt) {
        addIssue(["checks", index, "observedAt"], "检查时间必须位于会话窗口内并按顺序递增");
      }
      previousObservedAt = observedAt;
      const checkArtifactIds = new Set(check.artifactIds);
      if (checkArtifactIds.size !== check.artifactIds.length) {
        addIssue(["checks", index, "artifactIds"], "同一检查不能重复引用附件");
      }
      for (const artifactId of checkArtifactIds) {
        referencedArtifactIds.add(artifactId);
        if (!artifactIds.has(artifactId)) {
          addIssue(["checks", index, "artifactIds"], `检查引用了不存在的附件：${artifactId}`);
        }
      }
    }
    for (const [index, artifact] of session.artifacts.entries()) {
      if (!referencedArtifactIds.has(artifact.id)) {
        addIssue(["artifacts", index, "id"], "每个附件必须至少支持一项固定检查");
      }
    }
  });

export type RealAdapterAcceptanceSession = z.infer<typeof realAdapterAcceptanceSessionSchema>;
