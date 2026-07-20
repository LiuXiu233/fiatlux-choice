import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, link, lstat, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  type EducationContentClearanceSession,
  type EducationContentSnapshot,
  educationContentClearanceSessionSchema,
  educationContentSnapshotSchema,
  educationV1ContentFilePaths,
} from "@fiatlux/contracts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface EducationContentClearanceEvidenceOptions {
  sessionPath: string;
  evidenceRoot: string;
  reportDir: string;
  repositoryRoot: string;
  expectedVersion: string;
  expectedGitSha: string;
  expectedBaseUrl: string;
  expectedEnvironmentId: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface VerifiedArtifact {
  id: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  capturedAt: string;
  personalInformationScope: "none" | "reviewer_identity_only";
  textSecretPatternScan: "passed" | "not_applicable_binary";
}

interface PublicPageProbe {
  url: string;
  status: number;
  contentType: string | null;
  bytes: number;
  bodySha256: string;
  matchedMarkers: string[];
  versionMatched: true;
  reviewMetadataMatched: true;
  canonicalMatched: boolean;
  correctionLinkMatched: boolean;
  placeholderScan: "passed";
}

interface LegacyPageProbe {
  url: string;
  action: "withdrawn" | "redirected" | "rewritten_in_place";
  status: number;
  location: string | null;
  bytes: number;
  bodySha256: string;
  matchedArticleId: string | null;
  placeholderScan: "passed" | "not_applicable";
}

export interface EducationContentClearanceVerificationReport {
  schemaVersion: 1;
  evidenceType: "education_content_clearance_verification";
  generatedAt: string;
  result: "success";
  sessionId: string;
  candidate: EducationContentClearanceSession["candidate"];
  execution: EducationContentClearanceSession["execution"] & {
    approvalIndependentlyVerified: false;
  };
  contentSnapshot: EducationContentSnapshot;
  questionnaire: Array<{
    id: EducationContentClearanceSession["questionnaire"][number]["id"];
    decision: "cleared";
    reviewedAt: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
    evidenceArtifactIds: string[];
  }>;
  articles: Array<{
    articleId: string;
    slug: string;
    version: string;
    contentSha256: string;
    reviewIds: string[];
    sourceRefs: string[];
    rightsMaterialCount: number;
    publicationApprovalReference: string;
    publishedAt: string;
    publicProbe: PublicPageProbe;
    nextReviewAt: string;
  }>;
  legacyPages: LegacyPageProbe[];
  finalApproval: EducationContentClearanceSession["finalApproval"];
  privacy: EducationContentClearanceSession["privacy"];
  artifacts: VerifiedArtifact[];
  hashes: {
    sessionJsonSha256: string;
  };
  independentVerification: {
    candidateIdentity: true;
    gitContentSnapshot: true;
    artifactBytesAndHashes: true;
    textSecretPatterns: true;
    unauthenticatedPublicHttp: true;
    publicContentMarkers: true;
    professionalJudgment: false;
    rightsValidity: false;
    reviewerIdentity: false;
    approvalAuthenticity: false;
    visualAndAccessibilityQuality: false;
  };
  boundaries: string[];
}

export interface EducationContentClearanceEvidenceResult {
  report: EducationContentClearanceVerificationReport;
  reportPath: string;
  reportSha256: string;
}

export class EducationContentClearanceEvidenceError extends Error {
  override readonly name = "EducationContentClearanceEvidenceError";
}

const execFileAsync = promisify(execFile);
const textualMimeTypes = new Set(["application/json", "text/csv", "text/html", "text/plain"]);
const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "Authorization header", pattern: /authorization\s*[:=]\s*(?:bearer|basic)\s+\S+/i },
  { name: "GitHub legacy token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "provider API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "private key", pattern: /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "WordPress login cookie", pattern: /wordpress_(?:logged_in|sec)_[A-Za-z0-9_%-]+/i },
  { name: "WordPress nonce", pattern: /(?:_wpnonce|X-WP-Nonce)\s*[:=]\s*[A-Za-z0-9_-]+/i },
];
const publicPlaceholderPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "WordPress introduction template", pattern: /this paragraph serves as an introduction/i },
  { name: "WordPress conclusion template", pattern: /this paragraph serves as a conclusion/i },
  { name: "Lorem ipsum", pattern: /lorem ipsum/i },
  { name: "evidence template placeholder", pattern: /REPLACE_WITH_/i },
];

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

async function readStats(path: string, label: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EducationContentClearanceEvidenceError(`${label} 不存在或不可读：${message}`);
  }
}

function requireCurrentOwner(stats: Stats, label: string): void {
  const currentUid = process.getuid?.();
  if (currentUid !== undefined && stats.uid !== currentUid) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须由当前验收操作者拥有`);
  }
}

async function requireProtectedRegularFile(path: string, label: string): Promise<number> {
  const stats = await readStats(path, label);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须是普通文件且不能是符号链接`);
  }
  requireCurrentOwner(stats, label);
  if ((stats.mode & 0o077) !== 0) {
    throw new EducationContentClearanceEvidenceError(`${label} 不能向 group/other 开放权限`);
  }
  return stats.size;
}

async function requireProtectedDirectory(path: string, label: string): Promise<string> {
  const stats = await readStats(path, label);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须是普通目录且不能是符号链接`);
  }
  requireCurrentOwner(stats, label);
  if ((stats.mode & 0o777) !== 0o700) {
    throw new EducationContentClearanceEvidenceError(`${label} 权限必须精确为 0700`);
  }
  return realpath(path);
}

async function requireRepositoryRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new EducationContentClearanceEvidenceError("仓库根目录必须使用绝对路径");
  }
  const stats = await readStats(path, "仓库根目录");
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new EducationContentClearanceEvidenceError("仓库根目录必须是普通目录且不能是符号链接");
  }
  requireCurrentOwner(stats, "仓库根目录");
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
  const displayed = error.issues
    .slice(0, 30)
    .map(
      ({ path, message }) =>
        `${path.length > 0 ? path.map(String).join(".") : "<root>"}: ${message}`,
    )
    .join("；");
  const remaining = error.issues.length - 30;
  return remaining > 0 ? `${displayed}；另有 ${remaining} 项错误未显示` : displayed;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须是非空字符串`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new EducationContentClearanceEvidenceError(`${label} 必须是非空字符串数组`);
  }
  return value as string[];
}

async function gitBytes(repositoryRoot: string, args: string[], label: string): Promise<Buffer> {
  try {
    const result = (await execFileAsync("git", ["-C", repositoryRoot, ...args], {
      encoding: "buffer",
      maxBuffer: 20_000_000,
      windowsHide: true,
    })) as unknown as { stdout: Buffer };
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EducationContentClearanceEvidenceError(`${label} 读取失败：${message}`);
  }
}

export async function loadEducationContentSnapshotFromGit(
  repositoryRootInput: string,
  gitSha: string,
): Promise<EducationContentSnapshot> {
  if (!/^[0-9a-f]{40}$/.test(gitSha)) {
    throw new EducationContentClearanceEvidenceError("候选 Git SHA 必须是完整小写 40 位提交");
  }
  const repositoryRoot = await requireRepositoryRoot(repositoryRootInput);
  await gitBytes(repositoryRoot, ["cat-file", "-e", `${gitSha}^{commit}`], "候选提交");

  const files: EducationContentSnapshot["files"] = [];
  const articles: EducationContentSnapshot["articles"] = [];
  const seenArticleIds = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const path of educationV1ContentFilePaths) {
    const bytes = await gitBytes(repositoryRoot, ["show", `${gitSha}:${path}`], `候选内容 ${path}`);
    let unknownDocument: unknown;
    try {
      unknownDocument = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EducationContentClearanceEvidenceError(
        `候选内容 ${path} 不是有效 JSON：${message}`,
      );
    }
    const document = requireRecord(unknownDocument, `候选内容 ${path}`);
    const datasetId = requireString(document.datasetId, `${path}.datasetId`);
    const schemaVersion = requireString(document.schemaVersion, `${path}.schemaVersion`);
    if (!Array.isArray(document.articles) || document.articles.length === 0) {
      throw new EducationContentClearanceEvidenceError(`${path}.articles 必须是非空数组`);
    }
    files.push({ path, datasetId, schemaVersion, sha256: sha256Bytes(bytes), bytes: bytes.length });
    for (const [index, unknownArticle] of document.articles.entries()) {
      const article = requireRecord(unknownArticle, `${path}.articles.${index}`);
      const articleId = requireString(article.id, `${path}.articles.${index}.id`);
      const slug = requireString(article.slug, `${path}.articles.${index}.slug`);
      const title = requireString(article.title, `${path}.articles.${index}.title`);
      const version = requireString(article.version, `${path}.articles.${index}.version`);
      const sourceRefs = requireStringArray(
        article.sourceRefs,
        `${path}.articles.${index}.sourceRefs`,
      );
      if (seenArticleIds.has(articleId) || seenSlugs.has(slug)) {
        throw new EducationContentClearanceEvidenceError(
          `候选内容存在重复文章标识或 slug：${articleId}`,
        );
      }
      seenArticleIds.add(articleId);
      seenSlugs.add(slug);
      if (!Array.isArray(article.sections) || article.sections.length === 0) {
        throw new EducationContentClearanceEvidenceError(
          `${path}.articles.${index}.sections 必须是非空数组`,
        );
      }
      const firstSection = requireRecord(
        article.sections[0],
        `${path}.articles.${index}.sections.0`,
      );
      const template = requireRecord(article.template, `${path}.articles.${index}.template`);
      articles.push({
        articleId,
        slug,
        title,
        version,
        sourceFile: path,
        contentSha256: sha256Bytes(Buffer.from(JSON.stringify(article), "utf8")),
        sourceRefs,
        verificationMarkers: [
          title,
          requireString(firstSection.heading, `${path}.articles.${index}.sections.0.heading`),
          requireString(template.title, `${path}.articles.${index}.template.title`),
        ],
      });
    }
  }
  const parsed = educationContentSnapshotSchema.safeParse({ files, articles });
  if (!parsed.success) {
    throw new EducationContentClearanceEvidenceError(
      `候选电竞教育快照无效：${formatSchemaError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function requireExpectedIdentity(
  session: EducationContentClearanceSession,
  options: EducationContentClearanceEvidenceOptions,
): void {
  if (
    session.candidate.version !== options.expectedVersion ||
    session.candidate.gitSha !== options.expectedGitSha ||
    session.candidate.baseUrl !== options.expectedBaseUrl ||
    session.candidate.environmentId !== options.expectedEnvironmentId
  ) {
    throw new EducationContentClearanceEvidenceError(
      "会话身份与命令行独立期望不一致；拒绝仅信任会话自报的版本、提交或目标环境",
    );
  }
}

function scanTextForSecrets(content: string, label: string): void {
  for (const secretPattern of secretPatterns) {
    secretPattern.pattern.lastIndex = 0;
    if (secretPattern.pattern.test(content)) {
      throw new EducationContentClearanceEvidenceError(
        `${label} 命中敏感模式：${secretPattern.name}`,
      );
    }
  }
}

async function verifyArtifacts(
  session: EducationContentClearanceSession,
  evidenceRoot: string,
): Promise<VerifiedArtifact[]> {
  const verified: VerifiedArtifact[] = [];
  for (const artifact of session.artifacts) {
    const candidatePath = resolve(evidenceRoot, artifact.file);
    if (!pathIsWithin(evidenceRoot, candidatePath)) {
      throw new EducationContentClearanceEvidenceError(`附件路径越出证据根目录：${artifact.id}`);
    }
    const bytes = await requireProtectedRegularFile(candidatePath, `附件 ${artifact.id}`);
    const canonicalPath = await realpath(candidatePath);
    if (!pathIsWithin(evidenceRoot, canonicalPath)) {
      throw new EducationContentClearanceEvidenceError(
        `附件真实路径越出证据根目录：${artifact.id}`,
      );
    }
    if (bytes !== artifact.bytes) {
      throw new EducationContentClearanceEvidenceError(
        `附件字节数不一致：${artifact.id} 期望 ${artifact.bytes}，实际 ${bytes}`,
      );
    }
    const digest = await sha256File(canonicalPath);
    if (digest !== artifact.sha256) {
      throw new EducationContentClearanceEvidenceError(
        `附件 SHA-256 不一致：${artifact.id} 期望 ${artifact.sha256}，实际 ${digest}`,
      );
    }
    let artifactPatternScan: VerifiedArtifact["textSecretPatternScan"] = "not_applicable_binary";
    if (textualMimeTypes.has(artifact.mimeType)) {
      scanTextForSecrets(await readFile(canonicalPath, "utf8"), `文本附件 ${artifact.id}`);
      artifactPatternScan = "passed";
    }
    verified.push({
      id: artifact.id,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      mimeType: artifact.mimeType,
      capturedAt: artifact.capturedAt,
      personalInformationScope: artifact.personalInformationScope,
      textSecretPatternScan: artifactPatternScan,
    });
  }
  return verified;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function normalizedHtmlText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedMarker(value: string): string {
  return decodeHtmlEntities(value).normalize("NFKC").replace(/\s+/g, " ").trim();
}

function htmlAttribute(tag: string, name: string): string | null {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = expression.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function canonicalUrlMatches(html: string, expected: string): boolean {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  return tags.some((tag) => {
    const rel = htmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = htmlAttribute(tag, "href");
    if (!rel.includes("canonical") || !href) return false;
    try {
      return new URL(decodeHtmlEntities(href), expected).href === expected;
    } catch {
      return false;
    }
  });
}

async function publicGet(fetchImpl: FetchLike, url: string): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "FIAT-LUX-CHOICE-V1-Education-Evidence/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EducationContentClearanceEvidenceError(`公开页面只读请求失败 ${url}：${message}`);
  }
}

async function readPublicBody(response: Response, url: string): Promise<Buffer> {
  const limit = 5_000_000;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new EducationContentClearanceEvidenceError(`公开页面超过 5 MB 限制：${url}`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel("public page size limit exceeded").catch(() => undefined);
        throw new EducationContentClearanceEvidenceError(`公开页面超过 5 MB 限制：${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

function requireNoPublicPlaceholders(html: string, url: string): void {
  for (const placeholder of publicPlaceholderPatterns) {
    placeholder.pattern.lastIndex = 0;
    if (placeholder.pattern.test(html)) {
      throw new EducationContentClearanceEvidenceError(
        `公开页面仍包含 ${placeholder.name}：${url}`,
      );
    }
  }
}

async function verifyPublishedArticle(
  fetchImpl: FetchLike,
  clearance: EducationContentClearanceSession["articleClearances"][number],
  snapshot: EducationContentSnapshot["articles"][number],
): Promise<PublicPageProbe> {
  const { publicUrl, canonicalUrl, correctionUrl } = clearance.publication;
  const response = await publicGet(fetchImpl, publicUrl);
  if (response.status !== 200 || response.redirected) {
    throw new EducationContentClearanceEvidenceError(
      `公开文章必须无跳转返回 HTTP 200：${publicUrl} 实际 ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("text/html")) {
    throw new EducationContentClearanceEvidenceError(`公开文章未返回 HTML：${publicUrl}`);
  }
  const body = await readPublicBody(response, publicUrl);
  const html = body.toString("utf8");
  requireNoPublicPlaceholders(html, publicUrl);
  const text = normalizedHtmlText(html);
  const matchedMarkers = snapshot.verificationMarkers.filter((marker) =>
    text.includes(normalizedMarker(marker)),
  );
  if (matchedMarkers.length !== snapshot.verificationMarkers.length) {
    throw new EducationContentClearanceEvidenceError(
      `公开文章未完整呈现候选内容标记：${publicUrl}（${matchedMarkers.length}/${snapshot.verificationMarkers.length}）`,
    );
  }
  const versionMatched = text.includes(normalizedMarker(clearance.publication.displayedVersion));
  const reviewMetadataMatched =
    text.includes(normalizedMarker(clearance.publication.displayedReviewerRole)) &&
    text.includes(normalizedMarker(clearance.publication.displayedReviewDate));
  if (!versionMatched || !reviewMetadataMatched) {
    throw new EducationContentClearanceEvidenceError(
      `公开文章未呈现登记的版本、复核角色或复核日期：${publicUrl}`,
    );
  }
  const canonicalMatched = canonicalUrlMatches(html, canonicalUrl);
  if (!canonicalMatched) {
    throw new EducationContentClearanceEvidenceError(`公开文章 canonical URL 不匹配：${publicUrl}`);
  }
  const correctionPath = new URL(correctionUrl).pathname;
  const correctionLinkMatched = html.includes(correctionUrl) || html.includes(correctionPath);
  if (!correctionLinkMatched) {
    throw new EducationContentClearanceEvidenceError(`公开文章缺少登记的纠错入口：${publicUrl}`);
  }
  return {
    url: publicUrl,
    status: response.status,
    contentType,
    bytes: body.length,
    bodySha256: sha256Bytes(body),
    matchedMarkers,
    versionMatched: true,
    reviewMetadataMatched: true,
    canonicalMatched,
    correctionLinkMatched,
    placeholderScan: "passed",
  };
}

async function verifyLegacyPage(
  fetchImpl: FetchLike,
  legacy: EducationContentClearanceSession["legacyPages"][number],
  session: EducationContentClearanceSession,
): Promise<LegacyPageProbe> {
  const response = await publicGet(fetchImpl, legacy.originalUrl);
  const body = await readPublicBody(response, legacy.originalUrl);
  const base = {
    url: legacy.originalUrl,
    action: legacy.action,
    status: response.status,
    location: response.headers.get("location"),
    bytes: body.length,
    bodySha256: sha256Bytes(body),
  };
  if (response.status !== legacy.httpStatus) {
    throw new EducationContentClearanceEvidenceError(
      `旧模板页面状态与登记不一致：${legacy.originalUrl} 期望 ${legacy.httpStatus}，实际 ${response.status}`,
    );
  }
  if (legacy.action === "withdrawn") {
    return { ...base, matchedArticleId: null, placeholderScan: "not_applicable" };
  }
  if (legacy.action === "redirected") {
    const location = response.headers.get("location");
    let resolvedLocation: string | null = null;
    try {
      resolvedLocation = location ? new URL(location, legacy.originalUrl).href : null;
    } catch {
      resolvedLocation = null;
    }
    if (resolvedLocation !== legacy.replacementUrl) {
      throw new EducationContentClearanceEvidenceError(
        `旧模板页面重定向目标不匹配：${legacy.originalUrl}`,
      );
    }
    return {
      ...base,
      location: resolvedLocation,
      matchedArticleId: legacy.mappedArticleId,
      placeholderScan: "not_applicable",
    };
  }
  const snapshot = session.contentSnapshot.articles.find(
    ({ articleId }) => articleId === legacy.mappedArticleId,
  );
  if (!snapshot) {
    throw new EducationContentClearanceEvidenceError(
      `旧页面映射文章不存在：${legacy.mappedArticleId}`,
    );
  }
  const html = body.toString("utf8");
  requireNoPublicPlaceholders(html, legacy.originalUrl);
  const text = normalizedHtmlText(html);
  if (snapshot.verificationMarkers.some((marker) => !text.includes(normalizedMarker(marker)))) {
    throw new EducationContentClearanceEvidenceError(
      `原位重写页面未完整呈现映射文章：${legacy.originalUrl}`,
    );
  }
  return {
    ...base,
    matchedArticleId: legacy.mappedArticleId,
    placeholderScan: "passed",
  };
}

async function writeReportAtomically(
  report: EducationContentClearanceVerificationReport,
  reportDir: string,
): Promise<{ reportPath: string; reportSha256: string }> {
  const reportName = `education-content-clearance-${report.sessionId}-${report.candidate.gitSha.slice(0, 7)}.json`;
  const reportPath = join(reportDir, reportName);
  const partialPath = join(reportDir, `.${reportName}.partial.${process.pid}`);
  if ((await pathExists(reportPath)) || (await pathExists(partialPath))) {
    throw new EducationContentClearanceEvidenceError("目标报告或 partial 路径已存在，拒绝覆盖");
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
      throw new EducationContentClearanceEvidenceError("成功报告权限不是 0600");
    }
    return { reportPath, reportSha256: await sha256File(reportPath) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(partialPath, { force: true }).catch(() => undefined);
    if (reportLinked) await unlink(reportPath).catch(() => undefined);
    if (error instanceof EducationContentClearanceEvidenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new EducationContentClearanceEvidenceError(`无法原子写入教育内容放行报告：${message}`);
  }
}

export async function verifyEducationContentClearanceEvidence(
  options: EducationContentClearanceEvidenceOptions,
): Promise<EducationContentClearanceEvidenceResult> {
  if (
    !isAbsolute(options.sessionPath) ||
    !isAbsolute(options.evidenceRoot) ||
    !isAbsolute(options.reportDir) ||
    !isAbsolute(options.repositoryRoot)
  ) {
    throw new EducationContentClearanceEvidenceError(
      "会话、证据根目录、报告目录和仓库根目录必须使用绝对路径",
    );
  }
  const sessionPath = resolve(options.sessionPath);
  const sessionSize = await requireProtectedRegularFile(sessionPath, "教育内容放行会话 JSON");
  if (sessionSize > 5_000_000) {
    throw new EducationContentClearanceEvidenceError("教育内容放行会话 JSON 不得超过 5 MB");
  }
  const sessionBytes = await readFile(sessionPath);
  scanTextForSecrets(sessionBytes.toString("utf8"), "教育内容放行会话 JSON");
  let unknownSession: unknown;
  try {
    unknownSession = JSON.parse(sessionBytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EducationContentClearanceEvidenceError(`教育内容放行会话不是有效 JSON：${message}`);
  }
  const parsed = educationContentClearanceSessionSchema.safeParse(unknownSession);
  if (!parsed.success) {
    throw new EducationContentClearanceEvidenceError(
      `教育内容放行会话无效：${formatSchemaError(parsed.error)}`,
    );
  }
  requireExpectedIdentity(parsed.data, options);
  const gitSnapshot = await loadEducationContentSnapshotFromGit(
    options.repositoryRoot,
    options.expectedGitSha,
  );
  if (JSON.stringify(parsed.data.contentSnapshot) !== JSON.stringify(gitSnapshot)) {
    throw new EducationContentClearanceEvidenceError(
      "会话内容快照与候选 Git 提交中的两份内容包不一致",
    );
  }

  const evidenceRoot = await requireProtectedDirectory(options.evidenceRoot, "证据根目录");
  const reportDir = await requireProtectedDirectory(options.reportDir, "报告目录");
  if (
    evidenceRoot === reportDir ||
    pathIsWithin(evidenceRoot, reportDir) ||
    pathIsWithin(reportDir, evidenceRoot)
  ) {
    throw new EducationContentClearanceEvidenceError("证据根目录与报告目录必须是相互隔离的目录");
  }
  const artifacts = await verifyArtifacts(parsed.data, evidenceRoot);
  const fetchImpl = options.fetchImpl ?? fetch;
  const publicProbes: PublicPageProbe[] = [];
  for (const [index, clearance] of parsed.data.articleClearances.entries()) {
    const snapshot = gitSnapshot.articles[index];
    if (!snapshot) throw new EducationContentClearanceEvidenceError("候选快照缺少逐篇文章");
    publicProbes.push(await verifyPublishedArticle(fetchImpl, clearance, snapshot));
  }
  const legacyProbes: LegacyPageProbe[] = [];
  for (const legacy of parsed.data.legacyPages) {
    legacyProbes.push(await verifyLegacyPage(fetchImpl, legacy, parsed.data));
  }

  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  if (Date.parse(generatedAt) < Date.parse(parsed.data.execution.finishedAt)) {
    throw new EducationContentClearanceEvidenceError("报告生成时间不能早于放行会话结束时间");
  }
  const report: EducationContentClearanceVerificationReport = {
    schemaVersion: 1,
    evidenceType: "education_content_clearance_verification",
    generatedAt,
    result: "success",
    sessionId: parsed.data.sessionId,
    candidate: parsed.data.candidate,
    execution: { ...parsed.data.execution, approvalIndependentlyVerified: false },
    contentSnapshot: gitSnapshot,
    questionnaire: parsed.data.questionnaire.map(
      ({ id, decision, reviewedAt, effectiveFrom, effectiveUntil, evidenceArtifactIds }) => ({
        id,
        decision,
        reviewedAt,
        effectiveFrom,
        effectiveUntil,
        evidenceArtifactIds,
      }),
    ),
    articles: parsed.data.articleClearances.map((clearance, index) => ({
      articleId: clearance.articleId,
      slug: clearance.slug,
      version: clearance.version,
      contentSha256: clearance.contentSha256,
      reviewIds: clearance.reviews.map(({ id }) => id),
      sourceRefs: clearance.sourceClearances.map(({ sourceRef }) => sourceRef),
      rightsMaterialCount: clearance.rightsMaterials.length,
      publicationApprovalReference: clearance.publicationApproval.approvalReference,
      publishedAt: clearance.publication.publishedAt,
      publicProbe: publicProbes[index] as PublicPageProbe,
      nextReviewAt: clearance.nextReviewAt,
    })),
    legacyPages: legacyProbes,
    finalApproval: parsed.data.finalApproval,
    privacy: parsed.data.privacy,
    artifacts,
    hashes: { sessionJsonSha256: sha256Bytes(sessionBytes) },
    independentVerification: {
      candidateIdentity: true,
      gitContentSnapshot: true,
      artifactBytesAndHashes: true,
      textSecretPatterns: true,
      unauthenticatedPublicHttp: true,
      publicContentMarkers: true,
      professionalJudgment: false,
      rightsValidity: false,
      reviewerIdentity: false,
      approvalAuthenticity: false,
      visualAndAccessibilityQuality: false,
    },
    boundaries: [
      "The verifier reads the exact candidate commit from local Git, binds both governed content files and all 12 article hashes, and verifies protected attachment bytes and hashes.",
      "It performs unauthenticated read-only GET requests to the 12 registered fiatlux.gg pages and seven legacy placeholder URLs; it does not log in, submit forms or modify WordPress.",
      "Public checks prove HTTP state, candidate text markers, canonical/correction links and selected placeholder absence at one point in time; they do not prove exhaustive visual, accessibility, legal or pedagogical quality.",
      "Professional conclusions, rights validity, reviewer identity, internal trials and approval authenticity remain human assertions requiring independent review through the matching company approval record.",
      "Binary attachments are hash-bound but not semantically inspected or exhaustively secret-scanned; session and reports must remain access-controlled and only redacted summaries may enter the repository.",
    ],
  };
  const written = await writeReportAtomically(report, reportDir);
  return { report, ...written };
}
