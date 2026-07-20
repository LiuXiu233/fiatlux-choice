import { describe, expect, it } from "vitest";

import { managedDevicePwaCheckIds, managedDevicePwaSessionSchema } from "../src/index.js";

const previousGitSha = "a".repeat(40);
const candidateGitSha = "b".repeat(40);

function makeSession(): Record<string, unknown> {
  const artifactIds = ["managed-status", "install-update", "offline-online", "clear-auth"];
  return {
    schemaVersion: 1,
    evidenceType: "managed_device_pwa_session",
    sessionId: "device-session-20260720-001",
    candidate: {
      version: "v1.0.0-rc.2",
      gitSha: candidateGitSha,
      baseUrl: "https://choice.internal.example:8443",
      environmentId: "fiatlux-guangzhou-office-prod",
    },
    device: {
      assetId: "managed-phone-01",
      assetIdIsPseudonymous: true,
      isPhysicalDevice: true,
      isSimulator: false,
      managementStatus: "company_managed",
      managementEvidenceReference: "mdm:managed-phone-01:20260720",
      platform: "ios",
      osVersion: "19.5",
      browserName: "Safari",
      browserVersion: "19.5",
      serialOrImeiRecorded: false,
    },
    installation: {
      installSource: "browser_ui",
      displayMode: "standalone",
      previousVersion: "v1.0.0-rc.1",
      previousGitSha,
      candidateVersion: "v1.0.0-rc.2",
      candidateGitSha,
      updateMethod: "service_worker_auto_update",
      serviceWorkerUpdateObserved: true,
      previousBuildIdentityObserved: "构建 v1.0.0-rc.1 · aaaaaaa",
      candidateBuildIdentityObserved: "构建 v1.0.0-rc.2 · bbbbbbb",
    },
    execution: {
      startedAt: "2026-07-20T14:00:00+08:00",
      finishedAt: "2026-07-20T14:30:00+08:00",
      timezone: "Asia/Shanghai",
      operatorIdentity: "device-operator-01",
      assertedApprovalReference: "CHANGE-2026-0050",
    },
    privacy: {
      rawCredentialsCaptured: false,
      sessionCookiesCaptured: false,
      deviceSerialOrImeiCaptured: false,
      companyDataRedacted: true,
    },
    checks: managedDevicePwaCheckIds.map((id, index) => ({
      id,
      result: "passed",
      observedAt: `2026-07-20T14:${String(index + 1).padStart(2, "0")}:00+08:00`,
      artifactIds: [artifactIds[index % artifactIds.length]],
      note: `受控测试步骤 ${index + 1} 已由设备操作者观察并留存脱敏证据。`,
    })),
    artifacts: artifactIds.map((id, index) => ({
      id,
      file: `captures/${id}.png`,
      sha256: String(index + 1).repeat(64),
      bytes: index + 1,
      mimeType: "image/png",
      capturedAt: `2026-07-20T14:${String(index + 2).padStart(2, "0")}:00+08:00`,
    })),
  };
}

describe("managed device PWA evidence contract", () => {
  it("accepts a complete physical managed-device install, update, offline and clear session", () => {
    expect(managedDevicePwaSessionSchema.safeParse(makeSession()).success).toBe(true);
  });

  it("rejects a missing or reordered mandatory check", () => {
    const missing = makeSession();
    (missing.checks as unknown[]).pop();
    expect(managedDevicePwaSessionSchema.safeParse(missing).success).toBe(false);

    const reordered = makeSession();
    const checks = reordered.checks as Array<Record<string, unknown>>;
    [checks[0], checks[1]] = [checks[1] ?? {}, checks[0] ?? {}];
    expect(managedDevicePwaSessionSchema.safeParse(reordered).success).toBe(false);
  });

  it("rejects a simulator or non-managed device assertion", () => {
    const simulator = makeSession();
    const device = simulator.device as Record<string, unknown>;
    device.isPhysicalDevice = false;
    device.isSimulator = true;
    expect(managedDevicePwaSessionSchema.safeParse(simulator).success).toBe(false);
  });

  it("rejects an alleged update without a distinct prior version and Git SHA", () => {
    const unchanged = makeSession();
    const installation = unchanged.installation as Record<string, unknown>;
    installation.previousVersion = "v1.0.0-rc.2";
    installation.previousGitSha = candidateGitSha;
    installation.previousBuildIdentityObserved = "构建 v1.0.0-rc.2 · bbbbbbb";
    expect(managedDevicePwaSessionSchema.safeParse(unchanged).success).toBe(false);
  });

  it("rejects an environment label that cannot be safely bound to an approved target", () => {
    const invalid = makeSession();
    const candidate = invalid.candidate as Record<string, unknown>;
    candidate.environmentId = "office prod\nforged";
    expect(managedDevicePwaSessionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unknown attachment references and orphaned attachments", () => {
    const unknown = makeSession();
    const checks = unknown.checks as Array<Record<string, unknown>>;
    checks[0] = { ...checks[0], artifactIds: ["missing-artifact"] };
    expect(managedDevicePwaSessionSchema.safeParse(unknown).success).toBe(false);
  });

  it("rejects evidence outside the session window or privacy capture of credentials", () => {
    const invalid = makeSession();
    const artifacts = invalid.artifacts as Array<Record<string, unknown>>;
    artifacts[0] = { ...artifacts[0], capturedAt: "2026-07-20T13:59:59+08:00" };
    const privacy = invalid.privacy as Record<string, unknown>;
    privacy.rawCredentialsCaptured = true;
    expect(managedDevicePwaSessionSchema.safeParse(invalid).success).toBe(false);
  });
});
