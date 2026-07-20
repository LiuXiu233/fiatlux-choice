import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, link, lstat, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

import {
  type RealAdapterAcceptanceSession,
  realAdapterAcceptanceSessionSchema,
} from "@fiatlux/contracts";

export interface RealAdapterAcceptanceEvidenceOptions {
  sessionPath: string;
  evidenceRoot: string;
  reportDir: string;
  expectedVersion: string;
  expectedGitSha: string;
  expectedBaseUrl: string;
  expectedEnvironmentId: string;
  expectedLlmProviderId: string;
  expectedLlmEndpoint: string;
  expectedLlmModel: string;
  expectedGitHubRepository: string;
  now?: () => Date;
}

export interface RealAdapterAcceptanceVerificationReport {
  schemaVersion: 1;
  evidenceType: "real_adapter_acceptance_verification";
  generatedAt: string;
  result: "success";
  sessionId: string;
  candidate: RealAdapterAcceptanceSession["candidate"];
  execution: RealAdapterAcceptanceSession["execution"] & {
    approvalIndependentlyVerified: false;
  };
  llm: {
    mode: "compatible";
    providerId: string;
    endpoint: string;
    model: string;
    maxOutputTokens: number;
    credential: Omit<RealAdapterAcceptanceSession["llm"]["credential"], "secretStoreReference">;
    liveConnectionCheckId: string;
    qualityReviewer: RealAdapterAcceptanceSession["llm"]["qualityReviewer"];
    qualitySamples: Array<{
      advisor: string;
      runId: string;
      modelCallId: string;
      promptVersionId: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      toolCallCount: number;
      citationCount: number;
      scores: RealAdapterAcceptanceSession["llm"]["qualitySamples"][number]["scores"];
      passed: true;
    }>;
    humanEditAudit: RealAdapterAcceptanceSession["llm"]["humanEditAudit"];
    dataProcessing: Omit<
      RealAdapterAcceptanceSession["llm"]["dataProcessing"],
      "agreementReference"
    > & { agreementReferenceRecorded: true };
    cost: RealAdapterAcceptanceSession["llm"]["cost"];
  };
  github: {
    mode: "read_only";
    apiOrigin: "https://api.github.com";
    repository: string;
    credential: Omit<RealAdapterAcceptanceSession["github"]["credential"], "secretStoreReference">;
    repositorySelection: "selected_repositories";
    selectedRepositories: string[];
    permissions: RealAdapterAcceptanceSession["github"]["permissions"];
    permissionProofArtifactId: string;
    liveRead: RealAdapterAcceptanceSession["github"]["liveRead"];
  };
  drills: RealAdapterAcceptanceSession["drills"];
  privacy: RealAdapterAcceptanceSession["privacy"];
  checks: Array<{
    id: RealAdapterAcceptanceSession["checks"][number]["id"];
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
    textSecretPatternScan: "passed" | "not_applicable_binary";
  }>;
  hashes: { sessionJsonSha256: string };
  independentVerification: {
    candidateIdentity: true;
    artifactBytesAndHashes: true;
    textSecretPatterns: true;
    providerOrGitHubCalls: false;
    leastPrivilegeConfiguration: false;
    humanQualityJudgment: false;
    credentialRevocation: false;
    approval: false;
  };
  boundaries: string[];
}

export interface RealAdapterAcceptanceEvidenceResult {
  report: RealAdapterAcceptanceVerificationReport;
  reportPath: string;
  reportSha256: string;
}

export class RealAdapterAcceptanceEvidenceError extends Error {
  override readonly name = "RealAdapterAcceptanceEvidenceError";
}

const textualMimeTypes = new Set(["application/json", "text/csv", "text/plain"]);
const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "Authorization header", pattern: /authorization\s*[:=]\s*(?:bearer|basic)\s+\S+/i },
  { name: "GitHub legacy token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "provider API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "private key", pattern: /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "LLM_API_KEY assignment", pattern: /(?:^|\n)\s*LLM_API_KEY\s*=\s*[^\s#][^\n]*/ },
  { name: "GITHUB_TOKEN assignment", pattern: /(?:^|\n)\s*GITHUB_TOKEN\s*=\s*[^\s#][^\n]*/ },
];

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

async function readStats(path: string, label: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RealAdapterAcceptanceEvidenceError(`${label} 不存在或不可读：${message}`);
  }
}

function requireCurrentOwner(stats: Stats, label: string): void {
  const currentUid = process.getuid?.();
  if (currentUid !== undefined && stats.uid !== currentUid) {
    throw new RealAdapterAcceptanceEvidenceError(`${label} 必须由当前验收操作者拥有`);
  }
}

async function requireProtectedRegularFile(path: string, label: string): Promise<number> {
  const stats = await readStats(path, label);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new RealAdapterAcceptanceEvidenceError(`${label} 必须是普通文件且不能是符号链接`);
  }
  requireCurrentOwner(stats, label);
  if ((stats.mode & 0o077) !== 0) {
    throw new RealAdapterAcceptanceEvidenceError(`${label} 不能向 group/other 开放权限`);
  }
  return stats.size;
}

async function requireProtectedDirectory(path: string, label: string): Promise<string> {
  const stats = await readStats(path, label);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new RealAdapterAcceptanceEvidenceError(`${label} 必须是普通目录且不能是符号链接`);
  }
  requireCurrentOwner(stats, label);
  if ((stats.mode & 0o777) !== 0o700) {
    throw new RealAdapterAcceptanceEvidenceError(`${label} 权限必须精确为 0700`);
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

function pathIsWithin(parent: string, candidate: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return candidate.startsWith(prefix);
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
  session: RealAdapterAcceptanceSession,
  options: RealAdapterAcceptanceEvidenceOptions,
): void {
  if (
    session.candidate.version !== options.expectedVersion ||
    session.candidate.gitSha !== options.expectedGitSha ||
    session.candidate.baseUrl !== options.expectedBaseUrl ||
    session.candidate.environmentId !== options.expectedEnvironmentId ||
    session.llm.providerId !== options.expectedLlmProviderId ||
    session.llm.endpoint !== options.expectedLlmEndpoint ||
    session.llm.model !== options.expectedLlmModel ||
    session.github.repository.toLowerCase() !== options.expectedGitHubRepository.toLowerCase()
  ) {
    throw new RealAdapterAcceptanceEvidenceError(
      "会话身份与命令行独立期望不一致；拒绝仅信任会话自报的候选、目标环境、模型或 GitHub 仓库身份",
    );
  }
}

async function verifyArtifacts(
  session: RealAdapterAcceptanceSession,
  evidenceRoot: string,
): Promise<RealAdapterAcceptanceVerificationReport["artifacts"]> {
  const verified: RealAdapterAcceptanceVerificationReport["artifacts"] = [];
  for (const artifact of session.artifacts) {
    const candidatePath = resolve(evidenceRoot, artifact.file);
    if (!pathIsWithin(evidenceRoot, candidatePath)) {
      throw new RealAdapterAcceptanceEvidenceError(`附件路径越出证据根目录：${artifact.id}`);
    }
    const bytes = await requireProtectedRegularFile(candidatePath, `附件 ${artifact.id}`);
    const canonicalPath = await realpath(candidatePath);
    if (!pathIsWithin(evidenceRoot, canonicalPath)) {
      throw new RealAdapterAcceptanceEvidenceError(`附件真实路径越出证据根目录：${artifact.id}`);
    }
    if (bytes !== artifact.bytes) {
      throw new RealAdapterAcceptanceEvidenceError(
        `附件字节数不一致：${artifact.id} 期望 ${artifact.bytes}，实际 ${bytes}`,
      );
    }
    const digest = await sha256File(canonicalPath);
    if (digest !== artifact.sha256) {
      throw new RealAdapterAcceptanceEvidenceError(
        `附件 SHA-256 不一致：${artifact.id} 期望 ${artifact.sha256}，实际 ${digest}`,
      );
    }
    let textSecretPatternScan: "passed" | "not_applicable_binary" = "not_applicable_binary";
    if (textualMimeTypes.has(artifact.mimeType)) {
      const content = await readFile(canonicalPath, "utf8");
      for (const secretPattern of secretPatterns) {
        if (secretPattern.pattern.test(content)) {
          throw new RealAdapterAcceptanceEvidenceError(
            `文本附件命中敏感模式 ${secretPattern.name}：${artifact.id}`,
          );
        }
      }
      textSecretPatternScan = "passed";
    }
    verified.push({
      id: artifact.id,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      mimeType: artifact.mimeType,
      capturedAt: artifact.capturedAt,
      textSecretPatternScan,
    });
  }
  return verified;
}

async function writeReportAtomically(
  report: RealAdapterAcceptanceVerificationReport,
  reportDir: string,
): Promise<{ reportPath: string; reportSha256: string }> {
  const reportName = `real-adapter-acceptance-${report.sessionId}-${report.candidate.gitSha.slice(0, 7)}.json`;
  const reportPath = join(reportDir, reportName);
  const partialPath = join(reportDir, `.${reportName}.partial.${process.pid}`);
  if ((await pathExists(reportPath)) || (await pathExists(partialPath))) {
    throw new RealAdapterAcceptanceEvidenceError("目标报告或 partial 路径已存在，拒绝覆盖");
  }

  const body = `${JSON.stringify(report, null, 2)}\n`;
  let handle: FileHandle | undefined;
  let reportLinked = false;
  try {
    handle = await open(partialPath, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(partialPath, 0o600);
    await link(partialPath, reportPath);
    reportLinked = true;
    await unlink(partialPath);
    const stats = await lstat(reportPath);
    if ((stats.mode & 0o777) !== 0o600) {
      throw new RealAdapterAcceptanceEvidenceError("成功报告权限不是 0600");
    }
    return { reportPath, reportSha256: await sha256File(reportPath) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(partialPath, { force: true }).catch(() => undefined);
    if (reportLinked) await unlink(reportPath).catch(() => undefined);
    if (error instanceof RealAdapterAcceptanceEvidenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RealAdapterAcceptanceEvidenceError(`无法原子写入真实适配器报告：${message}`);
  }
}

export async function verifyRealAdapterAcceptanceEvidence(
  options: RealAdapterAcceptanceEvidenceOptions,
): Promise<RealAdapterAcceptanceEvidenceResult> {
  if (
    !isAbsolute(options.sessionPath) ||
    !isAbsolute(options.evidenceRoot) ||
    !isAbsolute(options.reportDir)
  ) {
    throw new RealAdapterAcceptanceEvidenceError("会话、证据根目录和报告目录必须使用绝对路径");
  }
  const sessionPath = resolve(options.sessionPath);
  const sessionSize = await requireProtectedRegularFile(sessionPath, "真实适配器会话 JSON");
  if (sessionSize > 1_000_000) {
    throw new RealAdapterAcceptanceEvidenceError("真实适配器会话 JSON 不得超过 1 MB");
  }
  const sessionBytes = await readFile(sessionPath);
  let unknownSession: unknown;
  try {
    unknownSession = JSON.parse(sessionBytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RealAdapterAcceptanceEvidenceError(`真实适配器会话不是有效 JSON：${message}`);
  }
  const parsed = realAdapterAcceptanceSessionSchema.safeParse(unknownSession);
  if (!parsed.success) {
    throw new RealAdapterAcceptanceEvidenceError(
      `真实适配器会话无效：${formatSchemaError(parsed.error)}`,
    );
  }
  requireExpectedIdentity(parsed.data, options);

  const evidenceRoot = await requireProtectedDirectory(options.evidenceRoot, "证据根目录");
  const reportDir = await requireProtectedDirectory(options.reportDir, "报告目录");
  if (
    evidenceRoot === reportDir ||
    pathIsWithin(evidenceRoot, reportDir) ||
    pathIsWithin(reportDir, evidenceRoot)
  ) {
    throw new RealAdapterAcceptanceEvidenceError("证据根目录与报告目录必须是相互隔离的目录");
  }
  const artifacts = await verifyArtifacts(parsed.data, evidenceRoot);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  if (Date.parse(generatedAt) < Date.parse(parsed.data.execution.finishedAt)) {
    throw new RealAdapterAcceptanceEvidenceError("报告生成时间不能早于验收会话结束时间");
  }

  const { secretStoreReference: _llmSecretStoreReference, ...llmCredential } =
    parsed.data.llm.credential;
  const { secretStoreReference: _githubSecretStoreReference, ...githubCredential } =
    parsed.data.github.credential;
  const { agreementReference: _agreementReference, ...dataProcessing } =
    parsed.data.llm.dataProcessing;
  const report: RealAdapterAcceptanceVerificationReport = {
    schemaVersion: 1,
    evidenceType: "real_adapter_acceptance_verification",
    generatedAt,
    result: "success",
    sessionId: parsed.data.sessionId,
    candidate: parsed.data.candidate,
    execution: { ...parsed.data.execution, approvalIndependentlyVerified: false },
    llm: {
      mode: parsed.data.llm.mode,
      providerId: parsed.data.llm.providerId,
      endpoint: parsed.data.llm.endpoint,
      model: parsed.data.llm.model,
      maxOutputTokens: parsed.data.llm.maxOutputTokens,
      credential: llmCredential,
      liveConnectionCheckId: parsed.data.llm.liveConnectionCheckId,
      qualityReviewer: parsed.data.llm.qualityReviewer,
      qualitySamples: parsed.data.llm.qualitySamples.map((sample) => ({
        advisor: sample.advisor,
        runId: sample.runId,
        modelCallId: sample.modelCallId,
        promptVersionId: sample.promptVersionId,
        inputTokens: sample.inputTokens,
        outputTokens: sample.outputTokens,
        latencyMs: sample.latencyMs,
        toolCallCount: sample.toolCallIds.length,
        citationCount: sample.citationCount,
        scores: sample.scores,
        passed: sample.passed,
      })),
      humanEditAudit: parsed.data.llm.humanEditAudit,
      dataProcessing: { ...dataProcessing, agreementReferenceRecorded: true },
      cost: parsed.data.llm.cost,
    },
    github: {
      mode: parsed.data.github.mode,
      apiOrigin: parsed.data.github.apiOrigin,
      repository: parsed.data.github.repository,
      credential: githubCredential,
      repositorySelection: parsed.data.github.repositorySelection,
      selectedRepositories: parsed.data.github.selectedRepositories,
      permissions: parsed.data.github.permissions,
      permissionProofArtifactId: parsed.data.github.permissionProofArtifactId,
      liveRead: parsed.data.github.liveRead,
    },
    drills: parsed.data.drills,
    privacy: parsed.data.privacy,
    checks: parsed.data.checks.map(({ id, result, observedAt, artifactIds }) => ({
      id,
      result,
      observedAt,
      artifactIds,
    })),
    artifacts,
    hashes: { sessionJsonSha256: sha256Bytes(sessionBytes) },
    independentVerification: {
      candidateIdentity: true,
      artifactBytesAndHashes: true,
      textSecretPatterns: true,
      providerOrGitHubCalls: false,
      leastPrivilegeConfiguration: false,
      humanQualityJudgment: false,
      credentialRevocation: false,
      approval: false,
    },
    boundaries: [
      "The offline verifier binds independently supplied candidate/provider/repository identity and verifies artifact bytes, hashes and selected text secret patterns.",
      "Provider calls, GitHub authentication, least-privilege settings, quality scores, data-processing terms and credential drills remain operator assertions requiring semantic and independent human review.",
      "Binary images and PDFs are hash-bound but are not semantically inspected or exhaustively secret-scanned by this verifier.",
      "The asserted approval reference is not independently checked; V1 readiness requires a separate matching company approval record.",
      "This report does not create, revoke, rotate or use credentials and does not call the LLM provider, GitHub or the target application.",
    ],
  };
  const written = await writeReportAtomically(report, reportDir);
  return { report, ...written };
}
