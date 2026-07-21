import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type RealAdapterAcceptanceSession,
  realAdapterAcceptanceCheckIds,
  realAdapterAdvisorKeys,
} from "@fiatlux/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  RealAdapterAcceptanceEvidenceError,
  type RealAdapterAcceptanceEvidenceOptions,
  verifyRealAdapterAcceptanceEvidence,
} from "../src/real-adapter-acceptance-evidence.js";

const gitSha = "a".repeat(40);
const roots: string[] = [];

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeSession(
  artifacts: RealAdapterAcceptanceSession["artifacts"],
): RealAdapterAcceptanceSession {
  const qualitySamples = realAdapterAdvisorKeys.map((advisor, index) => ({
    advisor,
    runId: uuid(100 + index),
    modelCallId: uuid(200 + index),
    promptVersionId: uuid(300 + index),
    completedAt: `2026-07-20T10:${String(index + 5).padStart(2, "0")}:00+08:00`,
    providerId: "approved-provider",
    model: "approved-model",
    status: "completed" as const,
    mockOrSyntheticProvider: false as const,
    dataClassification: "redacted_company_records" as const,
    inputTokens: 100 + index,
    outputTokens: 20 + index,
    latencyMs: 1_000 + index,
    toolCallIds: [uuid(400 + index)],
    citationCount: 1,
    rawResponseAuditPresent: true as const,
    scores: {
      factualGrounding: 4,
      evidenceTraceability: 4,
      factInferenceSeparation: 5,
      actionability: 4,
      safetyBoundaries: 5,
    },
    reviewerNote: `第 ${index + 1} 类顾问已逐项核对事实、推断、证据与安全边界。`,
    passed: true as const,
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
      artifactIds: [artifacts[index % artifacts.length]?.id ?? "missing"],
      note: `第 ${index + 1} 项真实适配器验收检查已完成，并由对应脱敏附件支持。`,
    })),
    artifacts,
  };
}

async function writeProtectedJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function makeFixture(): Promise<{
  root: string;
  evidenceRoot: string;
  reportDir: string;
  sessionPath: string;
  firstArtifactPath: string;
  session: RealAdapterAcceptanceSession;
  options: RealAdapterAcceptanceEvidenceOptions;
}> {
  const root = await mkdtemp(join(tmpdir(), "fiatlux-real-adapters-"));
  roots.push(root);
  const evidenceRoot = join(root, "evidence");
  const captures = join(evidenceRoot, "captures");
  const reportDir = join(root, "reports");
  await mkdir(captures, { recursive: true, mode: 0o700 });
  await mkdir(reportDir, { mode: 0o700 });
  await chmod(evidenceRoot, 0o700);
  await chmod(captures, 0o700);
  await chmod(reportDir, 0o700);

  const ids = [
    "runtime-audit",
    "provider-review",
    "pricing-proof",
    "github-permissions",
    "fallback-config",
    "secret-scan",
  ];
  const artifacts: RealAdapterAcceptanceSession["artifacts"] = [];
  for (const [index, id] of ids.entries()) {
    const content = Buffer.from(`redacted acceptance evidence ${index + 1}: ${id}\n`, "utf8");
    const file = `captures/${id}.txt`;
    const path = join(evidenceRoot, file);
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
    artifacts.push({
      id,
      file,
      sha256: sha256(content),
      bytes: content.byteLength,
      mimeType: "text/plain",
      capturedAt: `2026-07-20T11:${String(index + 20).padStart(2, "0")}:30+08:00`,
    });
  }

  const session = makeSession(artifacts);
  const sessionPath = join(root, "real-adapter-session.json");
  await writeProtectedJson(sessionPath, session);
  return {
    root,
    evidenceRoot,
    reportDir,
    sessionPath,
    firstArtifactPath: join(evidenceRoot, artifacts[0]?.file ?? "missing"),
    session,
    options: {
      sessionPath,
      evidenceRoot,
      reportDir,
      expectedVersion: "v1.0.0-rc.3",
      expectedGitSha: gitSha,
      expectedBaseUrl: "https://choice.internal.example:8443",
      expectedEnvironmentId: "fiatlux-guangzhou-office-prod",
      expectedLlmProviderId: "approved-provider",
      expectedLlmEndpoint: "https://llm.example.test/gateway",
      expectedLlmModel: "approved-model",
      expectedGitHubRepository: "LiuXiu233/fiatlux-choice",
      now: () => new Date("2026-07-20T04:05:00.000Z"),
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("real adapter acceptance evidence verifier", () => {
  it("hashes protected artifacts and writes a redacted, immutable mode-0600 report", async () => {
    const fixture = await makeFixture();
    const result = await verifyRealAdapterAcceptanceEvidence(fixture.options);
    expect(result.report.result).toBe("success");
    expect(result.report.llm.qualitySamples).toHaveLength(realAdapterAdvisorKeys.length);
    expect(result.report.execution.approvalIndependentlyVerified).toBe(false);
    expect(result.report.independentVerification.providerOrGitHubCalls).toBe(false);
    expect(result.reportSha256).toMatch(/^[0-9a-f]{64}$/);

    const serialized = await readFile(result.reportPath, "utf8");
    expect(serialized).not.toContain("captures/");
    expect(serialized).not.toContain("secret-store:");
    expect(serialized).not.toContain("逐项核对事实");
    expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.reportDir)).mode & 0o777).toBe(0o700);
  });

  it("rejects artifact mutation without creating a report", async () => {
    const fixture = await makeFixture();
    await appendFile(fixture.firstArtifactPath, "tampered");
    await expect(verifyRealAdapterAcceptanceEvidence(fixture.options)).rejects.toThrow(
      RealAdapterAcceptanceEvidenceError,
    );
    expect(await readdir(fixture.reportDir)).toEqual([]);
  });

  it("rejects a candidate or provider identity not independently supplied", async () => {
    const fixture = await makeFixture();
    await expect(
      verifyRealAdapterAcceptanceEvidence({
        ...fixture.options,
        expectedLlmModel: "different-model",
      }),
    ).rejects.toThrow(/独立期望不一致/);
  });

  it("rejects symbolic-link and group-readable evidence files", async () => {
    const symlinkFixture = await makeFixture();
    const outside = join(symlinkFixture.root, "outside.txt");
    const original = await readFile(symlinkFixture.firstArtifactPath);
    await writeFile(outside, original, { mode: 0o600 });
    await unlink(symlinkFixture.firstArtifactPath);
    await symlink(outside, symlinkFixture.firstArtifactPath);
    await expect(verifyRealAdapterAcceptanceEvidence(symlinkFixture.options)).rejects.toThrow(
      /不能是符号链接/,
    );

    const permissionFixture = await makeFixture();
    await chmod(permissionFixture.firstArtifactPath, 0o640);
    await expect(verifyRealAdapterAcceptanceEvidence(permissionFixture.options)).rejects.toThrow(
      /group\/other/,
    );
  });

  it("detects common secret material even when the declared hash is updated", async () => {
    const fixture = await makeFixture();
    const secret = Buffer.from(`GITHUB_TOKEN=github_pat_${"x".repeat(30)}\n`, "utf8");
    await writeFile(fixture.firstArtifactPath, secret, { mode: 0o600 });
    const first = fixture.session.artifacts[0];
    if (!first) throw new Error("missing fixture artifact");
    first.sha256 = sha256(secret);
    first.bytes = secret.byteLength;
    await writeProtectedJson(fixture.sessionPath, fixture.session);

    await expect(verifyRealAdapterAcceptanceEvidence(fixture.options)).rejects.toThrow(/敏感模式/);
    expect(await readdir(fixture.reportDir)).toEqual([]);
  });

  it("refuses to overwrite a deterministic report", async () => {
    const fixture = await makeFixture();
    const first = await verifyRealAdapterAcceptanceEvidence(fixture.options);
    const original = await readFile(first.reportPath);
    await expect(verifyRealAdapterAcceptanceEvidence(fixture.options)).rejects.toThrow(/拒绝覆盖/);
    expect(await readFile(first.reportPath)).toEqual(original);
    expect((await readdir(fixture.reportDir)).filter((name) => name.includes(".partial."))).toEqual(
      [],
    );
  });

  it("forces report mode 0600 even under a restrictive process umask", async () => {
    const fixture = await makeFixture();
    const previousUmask = process.umask(0o777);
    try {
      const result = await verifyRealAdapterAcceptanceEvidence(fixture.options);
      expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });
});
