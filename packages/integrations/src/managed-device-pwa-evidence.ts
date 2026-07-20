import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, link, lstat, mkdir, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

import { type ManagedDevicePwaSession, managedDevicePwaSessionSchema } from "@fiatlux/contracts";

export interface ManagedDevicePwaEvidenceOptions {
  sessionPath: string;
  evidenceRoot: string;
  reportDir: string;
  expectedVersion: string;
  expectedGitSha: string;
  expectedBaseUrl: string;
  expectedEnvironmentId: string;
  now?: () => Date;
}

export interface ManagedDevicePwaVerificationReport {
  schemaVersion: 1;
  evidenceType: "managed_device_pwa_verification";
  generatedAt: string;
  result: "success";
  sessionId: ManagedDevicePwaSession["sessionId"];
  candidate: ManagedDevicePwaSession["candidate"];
  device: ManagedDevicePwaSession["device"] & {
    physicalDeviceIndependentlyVerified: false;
    managementStatusIndependentlyVerified: false;
  };
  installation: ManagedDevicePwaSession["installation"];
  execution: ManagedDevicePwaSession["execution"] & {
    approvalIndependentlyVerified: false;
  };
  checks: Array<{
    id: ManagedDevicePwaSession["checks"][number]["id"];
    result: "passed";
    observedAt: string;
    artifactIds: string[];
  }>;
  artifacts: Array<{
    id: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    capturedAt: string;
  }>;
  privacy: ManagedDevicePwaSession["privacy"];
  hashes: {
    sessionJsonSha256: string;
  };
  boundaries: string[];
}

export interface ManagedDevicePwaEvidenceResult {
  report: ManagedDevicePwaVerificationReport;
  reportPath: string;
  reportSha256: string;
}

export class ManagedDevicePwaEvidenceError extends Error {
  override readonly name = "ManagedDevicePwaEvidenceError";
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function requireRegularFile(path: string, label: string): Promise<number> {
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedDevicePwaEvidenceError(`${label} 不存在或不可读：${message}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ManagedDevicePwaEvidenceError(`${label} 必须是普通文件且不能是符号链接`);
  }
  return stats.size;
}

async function requirePlainDirectory(path: string, label: string): Promise<string> {
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedDevicePwaEvidenceError(`${label} 不存在或不可读：${message}`);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ManagedDevicePwaEvidenceError(`${label} 必须是普通目录且不能是符号链接`);
  }
  return realpath(path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function formatSchemaError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map(
      ({ path, message }) =>
        `${path.length > 0 ? path.map(String).join(".") : "<root>"}: ${message}`,
    )
    .join("；");
}

function requireExpectedIdentity(
  session: ManagedDevicePwaSession,
  options: ManagedDevicePwaEvidenceOptions,
): void {
  if (
    session.candidate.version !== options.expectedVersion ||
    session.candidate.gitSha !== options.expectedGitSha ||
    session.candidate.baseUrl !== options.expectedBaseUrl ||
    session.candidate.environmentId !== options.expectedEnvironmentId
  ) {
    throw new ManagedDevicePwaEvidenceError(
      "会话候选身份与命令行独立期望不一致；拒绝仅信任会话自报版本、Git SHA、URL 或环境 ID",
    );
  }
}

async function verifyArtifacts(
  session: ManagedDevicePwaSession,
  evidenceRoot: string,
): Promise<void> {
  const rootPrefix = evidenceRoot.endsWith(sep) ? evidenceRoot : `${evidenceRoot}${sep}`;
  for (const artifact of session.artifacts) {
    const candidatePath = resolve(evidenceRoot, artifact.file);
    if (!candidatePath.startsWith(rootPrefix)) {
      throw new ManagedDevicePwaEvidenceError(`附件路径越出证据根目录：${artifact.id}`);
    }
    const bytes = await requireRegularFile(candidatePath, `附件 ${artifact.id}`);
    const canonicalPath = await realpath(candidatePath);
    if (!canonicalPath.startsWith(rootPrefix)) {
      throw new ManagedDevicePwaEvidenceError(`附件真实路径越出证据根目录：${artifact.id}`);
    }
    if (bytes !== artifact.bytes) {
      throw new ManagedDevicePwaEvidenceError(
        `附件字节数不一致：${artifact.id} 期望 ${artifact.bytes}，实际 ${bytes}`,
      );
    }
    const digest = await sha256File(canonicalPath);
    if (digest !== artifact.sha256) {
      throw new ManagedDevicePwaEvidenceError(
        `附件 SHA-256 不一致：${artifact.id} 期望 ${artifact.sha256}，实际 ${digest}`,
      );
    }
  }
}

async function writeReportAtomically(
  report: ManagedDevicePwaVerificationReport,
  reportDir: string,
): Promise<{ reportPath: string; reportSha256: string }> {
  const timestamp = report.generatedAt.replace(/[-:]/g, "").replace("T", "-");
  const reportName = `managed-device-pwa-${timestamp}-${report.candidate.gitSha.slice(0, 7)}-${report.device.assetId}.json`;
  const reportPath = join(reportDir, reportName);
  const partialPath = join(reportDir, `.${reportName}.partial.${process.pid}`);
  if ((await pathExists(reportPath)) || (await pathExists(partialPath))) {
    throw new ManagedDevicePwaEvidenceError("目标报告或 partial 路径已存在，拒绝覆盖");
  }

  const body = `${JSON.stringify(report, null, 2)}\n`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(partialPath, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(partialPath, 0o600);
    await link(partialPath, reportPath);
    await unlink(partialPath);
    return { reportPath, reportSha256: await sha256File(reportPath) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(partialPath, { force: true }).catch(() => undefined);
    if (error instanceof ManagedDevicePwaEvidenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedDevicePwaEvidenceError(`无法原子写入受管真机报告：${message}`);
  }
}

export async function verifyManagedDevicePwaEvidence(
  options: ManagedDevicePwaEvidenceOptions,
): Promise<ManagedDevicePwaEvidenceResult> {
  if (!isAbsolute(options.evidenceRoot) || !isAbsolute(options.reportDir)) {
    throw new ManagedDevicePwaEvidenceError("证据根目录和报告目录必须使用绝对路径");
  }
  const sessionPath = resolve(options.sessionPath);
  const sessionSize = await requireRegularFile(sessionPath, "受管真机会话 JSON");
  if (sessionSize > 1_000_000) {
    throw new ManagedDevicePwaEvidenceError("受管真机会话 JSON 不得超过 1 MB");
  }
  const sessionBytes = await readFile(sessionPath);
  let unknownSession: unknown;
  try {
    unknownSession = JSON.parse(sessionBytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedDevicePwaEvidenceError(`受管真机会话不是有效 JSON：${message}`);
  }
  const parsed = managedDevicePwaSessionSchema.safeParse(unknownSession);
  if (!parsed.success) {
    throw new ManagedDevicePwaEvidenceError(`受管真机会话无效：${formatSchemaError(parsed.error)}`);
  }
  requireExpectedIdentity(parsed.data, options);

  const evidenceRoot = await requirePlainDirectory(options.evidenceRoot, "证据根目录");
  await verifyArtifacts(parsed.data, evidenceRoot);

  await mkdir(options.reportDir, { recursive: true, mode: 0o700 });
  const reportDir = await requirePlainDirectory(options.reportDir, "报告目录");
  await chmod(reportDir, 0o700);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const report: ManagedDevicePwaVerificationReport = {
    schemaVersion: 1,
    evidenceType: "managed_device_pwa_verification",
    generatedAt,
    result: "success",
    sessionId: parsed.data.sessionId,
    candidate: parsed.data.candidate,
    device: {
      ...parsed.data.device,
      physicalDeviceIndependentlyVerified: false,
      managementStatusIndependentlyVerified: false,
    },
    installation: parsed.data.installation,
    execution: {
      ...parsed.data.execution,
      approvalIndependentlyVerified: false,
    },
    checks: parsed.data.checks.map(({ id, result, observedAt, artifactIds }) => ({
      id,
      result,
      observedAt,
      artifactIds,
    })),
    artifacts: parsed.data.artifacts.map(({ id, sha256, bytes, mimeType, capturedAt }) => ({
      id,
      sha256,
      bytes,
      mimeType,
      capturedAt,
    })),
    privacy: parsed.data.privacy,
    hashes: { sessionJsonSha256: sha256Bytes(sessionBytes) },
    boundaries: [
      "Physical-device, company-management and operator observations are asserted by the session author and are not independently verified by this offline verifier.",
      "The approval reference is operator-supplied and must be checked through an independent company approval channel.",
      "Artifact byte lengths and SHA-256 values are verified, but their semantic truth, capture device and absence of off-screen sensitive data still require human review.",
      "This report does not deploy, install, update, clear, log in to or otherwise control a device, browser, PWA or external system.",
    ],
  };
  const written = await writeReportAtomically(report, reportDir);
  return { report, ...written };
}
