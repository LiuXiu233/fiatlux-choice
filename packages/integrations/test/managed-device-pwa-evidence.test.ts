import { createHash } from "node:crypto";
import {
  appendFile,
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

import { managedDevicePwaCheckIds } from "@fiatlux/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedDevicePwaEvidenceError,
  type ManagedDevicePwaEvidenceOptions,
  verifyManagedDevicePwaEvidence,
} from "../src/managed-device-pwa-evidence.js";

const previousGitSha = "a".repeat(40);
const candidateGitSha = "b".repeat(40);
const roots: string[] = [];

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makeFixture(): Promise<{
  root: string;
  evidenceRoot: string;
  reportDir: string;
  sessionPath: string;
  firstArtifactPath: string;
  options: ManagedDevicePwaEvidenceOptions;
}> {
  const root = await mkdtemp(join(tmpdir(), "fiatlux-managed-device-"));
  roots.push(root);
  const evidenceRoot = join(root, "evidence");
  const reportDir = join(root, "reports");
  const captures = join(evidenceRoot, "captures");
  await mkdir(captures, { recursive: true });

  const artifactIds = ["managed-status", "install-update", "offline-online", "clear-auth"];
  const artifactContents = artifactIds.map((id, index) =>
    Buffer.from(`redacted managed-device fixture ${index + 1}: ${id}\n`, "utf8"),
  );
  const artifacts = [];
  for (const [index, id] of artifactIds.entries()) {
    const content = artifactContents[index];
    if (!content) throw new Error("fixture content missing");
    const relativePath = `captures/${id}.png`;
    await writeFile(join(evidenceRoot, relativePath), content);
    artifacts.push({
      id,
      file: relativePath,
      sha256: sha256(content),
      bytes: content.byteLength,
      mimeType: "image/png",
      capturedAt: `2026-07-20T14:${String(index + 2).padStart(2, "0")}:00+08:00`,
    });
  }

  const session = {
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
    artifacts,
  };
  const sessionPath = join(root, "managed-device-session.json");
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  return {
    root,
    evidenceRoot,
    reportDir,
    sessionPath,
    firstArtifactPath: join(evidenceRoot, artifacts[0]?.file ?? "missing"),
    options: {
      sessionPath,
      evidenceRoot,
      reportDir,
      expectedVersion: "v1.0.0-rc.2",
      expectedGitSha: candidateGitSha,
      expectedBaseUrl: "https://choice.internal.example:8443",
      expectedEnvironmentId: "fiatlux-guangzhou-office-prod",
      now: () => new Date("2026-07-20T06:30:00.000Z"),
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed-device PWA evidence verifier", () => {
  it("hashes real attachments and atomically writes a redacted mode-0600 report", async () => {
    const fixture = await makeFixture();
    const result = await verifyManagedDevicePwaEvidence(fixture.options);
    expect(result.report.result).toBe("success");
    expect(result.report.sessionId).toBe("device-session-20260720-001");
    expect(result.report.checks).toHaveLength(managedDevicePwaCheckIds.length);
    expect(result.report.artifacts).toHaveLength(4);
    expect(result.report.device.physicalDeviceIndependentlyVerified).toBe(false);
    expect(result.report.device.managementStatusIndependentlyVerified).toBe(false);
    expect(result.report.execution.approvalIndependentlyVerified).toBe(false);
    expect(result.reportSha256).toMatch(/^[0-9a-f]{64}$/);

    const serialized = await readFile(result.reportPath, "utf8");
    expect(serialized).not.toContain("captures/");
    expect(serialized).not.toContain("受控测试步骤");
    expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.reportDir)).mode & 0o777).toBe(0o700);
  });

  it("rejects attachment mutation before creating any success or partial report", async () => {
    const fixture = await makeFixture();
    await appendFile(fixture.firstArtifactPath, "tampered");
    await expect(verifyManagedDevicePwaEvidence(fixture.options)).rejects.toThrow(
      ManagedDevicePwaEvidenceError,
    );
    await expect(readdir(fixture.reportDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a candidate identity not independently supplied by the caller", async () => {
    const fixture = await makeFixture();
    await expect(
      verifyManagedDevicePwaEvidence({
        ...fixture.options,
        expectedGitSha: "c".repeat(40),
      }),
    ).rejects.toThrow(/独立期望不一致/);
  });

  it("rejects a target environment not independently supplied by the caller", async () => {
    const fixture = await makeFixture();
    await expect(
      verifyManagedDevicePwaEvidence({
        ...fixture.options,
        expectedEnvironmentId: "unapproved-environment",
      }),
    ).rejects.toThrow(/独立期望不一致/);
  });

  it("rejects a symbolic-link attachment even when its target bytes would match", async () => {
    const fixture = await makeFixture();
    const outside = join(fixture.root, "outside.png");
    const original = await readFile(fixture.firstArtifactPath);
    await writeFile(outside, original);
    await unlink(fixture.firstArtifactPath);
    await symlink(outside, fixture.firstArtifactPath);
    await expect(verifyManagedDevicePwaEvidence(fixture.options)).rejects.toThrow(/不能是符号链接/);
  });

  it("refuses to overwrite a deterministic same-name report", async () => {
    const fixture = await makeFixture();
    const first = await verifyManagedDevicePwaEvidence(fixture.options);
    const original = await readFile(first.reportPath);
    await expect(verifyManagedDevicePwaEvidence(fixture.options)).rejects.toThrow(/拒绝覆盖/);
    expect(await readFile(first.reportPath)).toEqual(original);
    expect((await readdir(fixture.reportDir)).filter((name) => name.includes(".partial."))).toEqual(
      [],
    );
  });
});
