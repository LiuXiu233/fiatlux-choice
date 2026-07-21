import { describe, expect, it } from "vitest";

import {
  realAdapterAcceptanceCheckIds,
  realAdapterAcceptanceSessionSchema,
  realAdapterAdvisorKeys,
} from "../src/index.js";

const gitSha = "a".repeat(40);
const artifactIds = [
  "runtime-audit",
  "provider-review",
  "pricing-proof",
  "github-permissions",
  "fallback-config",
  "secret-scan",
];

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function makeSession(): Record<string, unknown> {
  const qualitySamples = realAdapterAdvisorKeys.map((advisor, index) => ({
    advisor,
    runId: uuid(100 + index),
    modelCallId: uuid(200 + index),
    promptVersionId: uuid(300 + index),
    completedAt: `2026-07-20T10:${String(index + 5).padStart(2, "0")}:00+08:00`,
    providerId: "approved-provider",
    model: "approved-model",
    status: "completed",
    mockOrSyntheticProvider: false,
    dataClassification: "redacted_company_records",
    inputTokens: 100 + index,
    outputTokens: 20 + index,
    latencyMs: 1_000 + index,
    toolCallIds: [uuid(400 + index)],
    citationCount: 1,
    rawResponseAuditPresent: true,
    scores: {
      factualGrounding: 4,
      evidenceTraceability: 4,
      factInferenceSeparation: 5,
      actionability: 4,
      safetyBoundaries: 5,
    },
    reviewerNote: `第 ${index + 1} 类顾问已逐项核对事实、推断、证据与安全边界。`,
    passed: true,
  }));
  const observedInputTokens = qualitySamples.reduce((total, item) => total + item.inputTokens, 0);
  const observedOutputTokens = qualitySamples.reduce((total, item) => total + item.outputTokens, 0);

  return {
    schemaVersion: 1,
    evidenceType: "real_adapter_acceptance_session",
    sessionId: "real-adapters-20260720-001",
    candidate: {
      version: "v1.0.0-rc.3",
      gitSha,
      baseUrl: "https://choice.internal.example:8443",
      environmentId: "fiatlux-guangzhou-office-prod",
    },
    execution: {
      startedAt: "2026-07-20T10:00:00+08:00",
      finishedAt: "2026-07-20T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operatorIdentity: "adapter-operator-01",
      assertedApprovalReference: "CHANGE-2026-0061",
    },
    llm: {
      mode: "compatible",
      providerId: "approved-provider",
      endpoint: "https://llm.example.test/gateway",
      model: "approved-model",
      maxOutputTokens: 2_048,
      credential: {
        kind: "provider_api_key",
        fingerprintSha256: "b".repeat(64),
        expiresAt: "2026-08-20T00:00:00+08:00",
        rawCredentialRecorded: false,
        injectedIntoServices: ["worker"],
        secretStoreReference: "secret-store:llm:credential-v2",
      },
      liveConnectionCheckId: uuid(10),
      qualityReviewer: {
        identity: "quality-reviewer-01",
        role: "产品与信息安全负责人",
        reviewedAt: "2026-07-20T11:18:00+08:00",
        rubricVersion: "advisor-quality-v1",
      },
      qualitySamples,
      humanEditAudit: {
        runId: uuid(100),
        editId: uuid(500),
        auditEventId: uuid(501),
        editedByUserId: uuid(502),
        editedAt: "2026-07-20T10:30:00+08:00",
        reasonRecorded: true,
        beforeAndAfterRetained: true,
      },
      dataProcessing: {
        agreementReference: "vendor-review:llm:2026-07",
        reviewArtifactId: "provider-review",
        processingRegions: ["中国境内"],
        retentionDays: 30,
        customerDataTraining: "disabled",
        subprocessorsReviewed: true,
        deletionMechanismReviewed: true,
        incidentNotificationReviewed: true,
        crossBorderLegalReview: "not_applicable_no_cross_border",
        personalInformationSentInAcceptance: false,
        sensitivePersonalInformationSentInAcceptance: false,
        termsLastReviewedAt: "2026-07-20T10:20:00+08:00",
      },
      cost: {
        currency: "CNY",
        hardMonthlyLimitMinorUnits: 20_000,
        alertThresholdMinorUnits: 15_000,
        acceptanceCostMinorUnits: 120,
        observedInputTokens,
        observedOutputTokens,
        usageRecordedByApplication: true,
        providerBudgetEnforced: true,
        pricingArtifactId: "pricing-proof",
      },
    },
    github: {
      mode: "read_only",
      apiOrigin: "https://api.github.com",
      repository: "LiuXiu233/fiatlux-choice",
      credential: {
        kind: "fine_grained_pat",
        fingerprintSha256: "c".repeat(64),
        expiresAt: "2026-08-20T00:00:00+08:00",
        rawCredentialRecorded: false,
        injectedIntoServices: ["worker"],
        secretStoreReference: "secret-store:github:credential-v2",
      },
      repositorySelection: "selected_repositories",
      selectedRepositories: ["LiuXiu233/fiatlux-choice"],
      permissions: {
        metadata: "read",
        contents: "none",
        actions: "none",
        administration: "none",
        issues: "none",
        pullRequests: "none",
        workflows: "none",
        members: "none",
      },
      permissionProofArtifactId: "github-permissions",
      liveRead: {
        integrationCheckId: uuid(20),
        insightId: uuid(21),
        refreshAuditEventId: uuid(22),
        capturedAt: "2026-07-20T10:25:00+08:00",
        httpMethod: "GET",
        redirectPolicy: "error",
        authenticatedRequest: true,
        requestedRepository: "LiuXiu233/fiatlux-choice",
        returnedRepository: "LiuXiu233/fiatlux-choice",
        repositoryIdentityMatched: true,
        status: "healthy",
      },
    },
    drills: {
      llmCredentialRotation: {
        previousCredentialFingerprintSha256: "d".repeat(64),
        revokedAt: "2026-07-20T10:35:00+08:00",
        postRevocationCheckId: uuid(30),
        postRevocationStatus: "unhealthy",
        secretAbsentFromFailureEvidence: true,
        replacementCredentialFingerprintSha256: "b".repeat(64),
        replacementActivatedAt: "2026-07-20T10:45:00+08:00",
        recoveryCheckId: uuid(31),
        recoveryStatus: "healthy",
        recoveryCompletedAt: "2026-07-20T10:50:00+08:00",
      },
      githubCredentialRotation: {
        previousCredentialFingerprintSha256: "e".repeat(64),
        revokedAt: "2026-07-20T10:55:00+08:00",
        postRevocationCheckId: uuid(32),
        postRevocationStatus: "unhealthy",
        secretAbsentFromFailureEvidence: true,
        replacementCredentialFingerprintSha256: "c".repeat(64),
        replacementActivatedAt: "2026-07-20T11:05:00+08:00",
        recoveryCheckId: uuid(33),
        recoveryStatus: "healthy",
        recoveryCompletedAt: "2026-07-20T11:10:00+08:00",
      },
      fallback: {
        exercisedAt: "2026-07-20T11:15:00+08:00",
        llmMode: "disabled",
        llmCheckId: uuid(34),
        llmStatus: "disabled",
        githubMode: "manual",
        githubCheckId: uuid(35),
        githubStatus: "manual",
        externalNetworkCallsObserved: false,
        configEvidenceArtifactId: "fallback-config",
      },
    },
    privacy: {
      rawCredentialsCaptured: false,
      authorizationHeadersCaptured: false,
      sessionCookiesCaptured: false,
      rawProviderResponsesExported: false,
      companyDataRedactedInArtifacts: true,
      personalInformationInArtifacts: false,
      repositorySecretsInArtifacts: false,
      secretScanArtifactId: "secret-scan",
    },
    checks: realAdapterAcceptanceCheckIds.map((id, index) => ({
      id,
      result: "passed",
      observedAt: `2026-07-20T11:${String(index + 20).padStart(2, "0")}:00+08:00`,
      artifactIds: [artifactIds[index % artifactIds.length]],
      note: `第 ${index + 1} 项真实适配器验收检查已完成，并由对应脱敏附件支持。`,
    })),
    artifacts: artifactIds.map((id, index) => ({
      id,
      file: `captures/${id}.txt`,
      sha256: String(index + 1).repeat(64),
      bytes: index + 1,
      mimeType: "text/plain",
      capturedAt: `2026-07-20T11:${String(index + 20).padStart(2, "0")}:30+08:00`,
    })),
  };
}

describe("real LLM and GitHub adapter acceptance contract", () => {
  it("accepts a candidate-bound seven-advisor, least-privilege, rotation and fallback session", () => {
    expect(realAdapterAcceptanceSessionSchema.safeParse(makeSession()).success).toBe(true);
  });

  it("rejects mock, simulated or disabled providers from the real-adapter gate", () => {
    const session = makeSession();
    const llm = session.llm as Record<string, unknown>;
    llm.mode = "mock";
    llm.providerId = "simulated-provider";
    expect(realAdapterAcceptanceSessionSchema.safeParse(session).success).toBe(false);
  });

  it("rejects incomplete or reordered advisor quality coverage", () => {
    const missing = makeSession();
    ((missing.llm as Record<string, unknown>).qualitySamples as unknown[]).pop();
    expect(realAdapterAcceptanceSessionSchema.safeParse(missing).success).toBe(false);

    const reordered = makeSession();
    const samples = (reordered.llm as Record<string, unknown>).qualitySamples as unknown[];
    [samples[0], samples[1]] = [samples[1], samples[0]];
    expect(realAdapterAcceptanceSessionSchema.safeParse(reordered).success).toBe(false);
  });

  it("rejects GitHub write scope or a repository identity mismatch", () => {
    const writeScope = makeSession();
    const github = writeScope.github as Record<string, unknown>;
    (github.permissions as Record<string, unknown>).contents = "write";
    expect(realAdapterAcceptanceSessionSchema.safeParse(writeScope).success).toBe(false);

    const wrongRepository = makeSession();
    const liveRead = (wrongRepository.github as Record<string, unknown>).liveRead as Record<
      string,
      unknown
    >;
    liveRead.returnedRepository = "someone/else";
    expect(realAdapterAcceptanceSessionSchema.safeParse(wrongRepository).success).toBe(false);
  });

  it("rejects forged token totals and a no-op credential rotation", () => {
    const wrongCost = makeSession();
    const cost = (wrongCost.llm as Record<string, unknown>).cost as Record<string, unknown>;
    cost.observedInputTokens = Number(cost.observedInputTokens) + 1;
    expect(realAdapterAcceptanceSessionSchema.safeParse(wrongCost).success).toBe(false);

    const noRotation = makeSession();
    const drills = noRotation.drills as Record<string, Record<string, unknown>>;
    const llmRotation = drills.llmCredentialRotation;
    if (!llmRotation) throw new Error("missing LLM rotation fixture");
    llmRotation.previousCredentialFingerprintSha256 = "b".repeat(64);
    expect(realAdapterAcceptanceSessionSchema.safeParse(noRotation).success).toBe(false);
  });

  it("rejects leaked-secret assertions and placeholder evidence references", () => {
    const leaked = makeSession();
    (leaked.privacy as Record<string, unknown>).rawCredentialsCaptured = true;
    expect(realAdapterAcceptanceSessionSchema.safeParse(leaked).success).toBe(false);

    const placeholder = makeSession();
    (placeholder.execution as Record<string, unknown>).assertedApprovalReference =
      "approval:pending";
    expect(realAdapterAcceptanceSessionSchema.safeParse(placeholder).success).toBe(false);
  });

  it("bounds text evidence that must be loaded for secret-pattern scanning", () => {
    const oversized = makeSession();
    const artifacts = oversized.artifacts as Array<Record<string, unknown>>;
    if (!artifacts[0]) throw new Error("missing artifact fixture");
    artifacts[0].bytes = 10_000_001;
    expect(realAdapterAcceptanceSessionSchema.safeParse(oversized).success).toBe(false);
  });
});
