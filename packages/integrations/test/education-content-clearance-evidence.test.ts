import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type EducationContentClearanceSession,
  educationContentClearanceSessionSchema,
  educationContentReviewIds,
  educationLaunchQuestionnaireIds,
  educationLegacyPlaceholderUrls,
  educationV1ContentFilePaths,
} from "@fiatlux/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  EducationContentClearanceEvidenceError,
  loadEducationContentCandidateFromGit,
  loadEducationContentSnapshotFromGit,
  verifyEducationContentClearanceEvidence,
} from "../src/education-content-clearance-evidence.js";

interface Fixture {
  root: string;
  repositoryRoot: string;
  evidenceRoot: string;
  reportDir: string;
  sessionPath: string;
  gitSha: string;
  session: EducationContentClearanceSession;
}

interface FetchOverrides {
  missingMarkerForArticle?: number;
  missingMetadataForArticle?: number;
  placeholderForArticle?: number;
  reviewOnlyMarkerForArticle?: number;
  legacyStatusForIndex?: number;
}

const roots: string[] = [];

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeSourceArticles(start: number, count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const number = String(start + offset).padStart(2, "0");
    return {
      id: `education-article-${number}`,
      slug: `education-article-${number}`,
      title: `电竞教育文章 ${number}`,
      version: "1.0.0",
      sourceRefs: [`source-${number}`],
      sections: [{ heading: `核心章节 ${number}` }],
      template: { title: `实践模板 ${number}` },
    };
  });
}

async function createRepository(root: string): Promise<{ repositoryRoot: string; gitSha: string }> {
  const repositoryRoot = join(root, "repository");
  await mkdir(join(repositoryRoot, "content", "education"), { recursive: true });
  const packages = [
    {
      path: educationV1ContentFilePaths[0],
      datasetId: "fiatlux-education-foundation",
      articles: makeSourceArticles(1, 4),
    },
    {
      path: educationV1ContentFilePaths[1],
      datasetId: "fiatlux-education-expansion",
      articles: makeSourceArticles(5, 8),
    },
  ];
  for (const contentPackage of packages) {
    await writeFile(
      join(repositoryRoot, contentPackage.path),
      `${JSON.stringify(
        {
          schemaVersion: "1.0.0",
          datasetId: contentPackage.datasetId,
          articles: contentPackage.articles,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  execFileSync("git", ["-C", repositoryRoot, "init", "-q"]);
  execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "tests@fiatlux.gg"]);
  execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "FIAT LUX Tests"]);
  execFileSync("git", ["-C", repositoryRoot, "add", "content/education"]);
  execFileSync("git", ["-C", repositoryRoot, "commit", "-q", "-m", "education fixture"]);
  const gitSha = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return { repositoryRoot, gitSha };
}

async function writeProtectedFile(path: string, content: string): Promise<Buffer> {
  const bytes = Buffer.from(content, "utf8");
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return bytes;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "fiatlux-education-clearance-"));
  roots.push(root);
  await chmod(root, 0o700);
  const { repositoryRoot, gitSha } = await createRepository(root);
  const contentSnapshot = await loadEducationContentSnapshotFromGit(repositoryRoot, gitSha);
  const evidenceRoot = join(root, "evidence");
  const capturesDir = join(evidenceRoot, "captures");
  const reportDir = join(root, "reports");
  await mkdir(capturesDir, { recursive: true, mode: 0o700 });
  await mkdir(reportDir, { mode: 0o700 });
  await chmod(evidenceRoot, 0o700);
  await chmod(capturesDir, 0o700);
  await chmod(reportDir, 0o700);

  const artifactIds = new Set<string>([
    "questionnaire-proof",
    "review-proof",
    "source-proof",
    "rights-proof",
    "secret-scan",
    "final-approval",
  ]);
  const articleClearances = contentSnapshot.articles.map((article, index) => {
    const number = String(index + 1).padStart(2, "0");
    const approvalArtifactId = `article-${number}-approval`;
    const htmlExportArtifactId = `article-${number}-html`;
    const desktopCaptureArtifactId = `article-${number}-desktop`;
    const mobileCaptureArtifactId = `article-${number}-mobile`;
    for (const id of [
      approvalArtifactId,
      htmlExportArtifactId,
      desktopCaptureArtifactId,
      mobileCaptureArtifactId,
    ]) {
      artifactIds.add(id);
    }
    return {
      articleId: article.articleId,
      slug: article.slug,
      version: article.version,
      contentSha256: article.contentSha256,
      responsibleIdentity: "内容负责人甲",
      reviews: educationContentReviewIds.map((id) => ({
        id,
        result: "passed" as const,
        reviewerIdentity: "专业复核人乙",
        reviewerRole: "电竞教育与法务合规复核人",
        reviewerMode: "different_person" as const,
        reviewedAt: "2026-07-20T09:00:00+08:00",
        evidenceArtifactIds: ["review-proof"],
        conclusion: `文章 ${number} 的事实、专业边界、权利、隐私和内容安全已经按本类别逐项核验。`,
      })),
      sourceClearances: article.sourceRefs.map((sourceRef) => ({
        sourceRef,
        result: "current_and_applicable" as const,
        reviewerIdentity: "来源复核人丙",
        reviewerRole: "法务合规与来源复核人",
        reviewedAt: "2026-07-20T10:00:00+08:00",
        evidenceArtifactIds: ["source-proof"],
        applicabilityConclusion: `来源 ${sourceRef} 已核对发布机关、有效状态、适用范围和文章引用语境。`,
      })),
      rightsMaterials: [
        {
          materialId: `article-${number}-text`,
          kind: "article_text" as const,
          description: `文章 ${number} 的公司原创正文和练习模板`,
          result: "cleared" as const,
          basis: "company_original_authorship" as const,
          rightsHolder: "耀光（广州）电子竞技有限公司",
          territory: "中国境内",
          channels: ["fiatlux_gg_wordpress" as const, "internal_training" as const],
          expiresAt: null,
          evidenceArtifactIds: ["rights-proof"],
        },
      ],
      blockingIssuesOpen: 0 as const,
      publicationApproval: {
        decision: "approved" as const,
        approverIdentity: "发布批准人丁",
        approverRole: "教育内容与法务发布负责人",
        approverMode: "different_person" as const,
        approvalReference: `approval:education:article-${number}:20260720`,
        approvedAt: "2026-07-20T11:00:00+08:00",
        evidenceArtifactIds: [approvalArtifactId],
      },
      publication: {
        status: "published_with_evidence" as const,
        targetChannel: "fiatlux_gg_wordpress" as const,
        publicUrl: `https://fiatlux.gg/education/article-${number}/`,
        canonicalUrl: `https://fiatlux.gg/education/article-${number}/`,
        wordpressPostId: String(1000 + index),
        publisherIdentity: "官网发布人戊",
        publishedAt: "2026-07-20T12:00:00+08:00",
        publiclyObservedAt: "2026-07-20T12:10:00+08:00",
        httpStatus: 200 as const,
        unauthenticatedAccess: true as const,
        titleAndVersionVisible: true as const,
        reviewerAndReviewDateVisible: true as const,
        correctionEntryVisible: true as const,
        desktopAndMobileQaPassed: true as const,
        basicAccessibilityCheckPassed: true as const,
        placeholderTextAbsent: true as const,
        displayedVersion: article.version,
        displayedReviewerRole: "电竞教育与法务合规复核人",
        displayedReviewDate: "2026-07-20",
        correctionUrl: "https://fiatlux.gg/contact/",
        htmlExportArtifactId,
        desktopCaptureArtifactId,
        mobileCaptureArtifactId,
      },
      correctionOwnerIdentity: "内容纠错负责人己",
      correctionSlaBusinessDays: 5,
      nextReviewAt: "2026-10-20",
    };
  });
  const legacyPages = educationLegacyPlaceholderUrls.map((originalUrl, index) => {
    const number = String(index + 1).padStart(2, "0");
    const httpCaptureArtifactId = `legacy-${number}-http`;
    const visualCaptureArtifactId = `legacy-${number}-visual`;
    artifactIds.add(httpCaptureArtifactId);
    artifactIds.add(visualCaptureArtifactId);
    return {
      originalUrl,
      action: "withdrawn" as const,
      httpStatus: 404 as const,
      replacementUrl: null,
      mappedArticleId: null,
      observedAt: "2026-07-20T13:00:00+08:00",
      placeholderTextAbsent: true as const,
      httpCaptureArtifactId,
      visualCaptureArtifactId,
    };
  });
  const artifacts = [];
  let artifactIndex = 1;
  for (const id of artifactIds) {
    const bytes = await writeProtectedFile(join(capturesDir, `${id}.txt`), `evidence:${id}\n`);
    artifacts.push({
      id,
      file: `captures/${id}.txt`,
      sha256: sha256(bytes),
      bytes: bytes.length,
      mimeType: "text/plain" as const,
      capturedAt: "2026-07-20T10:30:00+08:00",
      personalInformationScope: id.includes("approval")
        ? ("reviewer_identity_only" as const)
        : ("none" as const),
    });
    artifactIndex += 1;
  }
  expect(artifactIndex).toBeGreaterThan(10);
  const unknownSession = {
    schemaVersion: 1,
    evidenceType: "education_content_clearance_session",
    sessionId: "education-clearance-20260720-001",
    candidate: {
      version: "v1.0.0-rc.4",
      gitSha,
      baseUrl: "https://choice.internal.example/",
      environmentId: "fiatlux-guangzhou-office-prod",
    },
    execution: {
      startedAt: "2026-07-20T08:00:00+08:00",
      finishedAt: "2026-07-20T15:00:00+08:00",
      timezone: "Asia/Shanghai",
      operatorIdentity: "会话操作者甲",
    },
    contentSnapshot,
    questionnaire: educationLaunchQuestionnaireIds.map((id) => ({
      id,
      decision: "cleared",
      reviewerIdentity: "业务与合规复核人庚",
      reviewerRole: "产品、法务、财税与数据安全复核人",
      reviewedAt: "2026-07-20T08:30:00+08:00",
      effectiveFrom: "2026-07-20",
      effectiveUntil: null,
      evidenceArtifactIds: ["questionnaire-proof"],
      conclusion: `上线事实问卷 ${id} 已按成人范围、实际经营模式和外部发布边界完成核验。`,
    })),
    articleClearances,
    legacyPages,
    privacy: {
      rawWordpressCredentialsCaptured: false,
      authorizationHeadersCaptured: false,
      sessionCookiesCaptured: false,
      learnerPersonalInformationCaptured: false,
      sensitivePersonalInformationCaptured: false,
      reviewerIdentityDisclosureLimited: true,
      secretScanPassed: true,
      secretScanArtifactId: "secret-scan",
    },
    finalApproval: {
      decision: "approved",
      approverIdentity: "公司发布批准人辛",
      approverRole: "公司负责人",
      approverMode: "different_person",
      approvalReference: "approval:education:final:20260720",
      approvedAt: "2026-07-20T14:00:00+08:00",
      evidenceArtifactIds: ["final-approval"],
    },
    artifacts,
  };
  const session = educationContentClearanceSessionSchema.parse(unknownSession);
  const sessionPath = join(root, "session.json");
  await writeProtectedFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  return { root, repositoryRoot, evidenceRoot, reportDir, sessionPath, gitSha, session };
}

function fetchForSession(
  session: EducationContentClearanceSession,
  overrides: FetchOverrides = {},
) {
  return async (input: string | URL): Promise<Response> => {
    const url = String(input);
    const articleIndex = session.articleClearances.findIndex(
      ({ publication }) => publication.publicUrl === url,
    );
    if (articleIndex >= 0) {
      const clearance = session.articleClearances[articleIndex];
      const snapshot = session.contentSnapshot.articles[articleIndex];
      if (!clearance || !snapshot) throw new Error("invalid test fixture");
      const markers = [...snapshot.verificationMarkers];
      if (overrides.missingMarkerForArticle === articleIndex) markers.pop();
      const placeholder =
        overrides.placeholderForArticle === articleIndex
          ? "This paragraph serves as an introduction to the topic."
          : overrides.reviewOnlyMarkerForArticle === articleIndex
            ? "FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH"
            : "";
      const metadata =
        overrides.missingMetadataForArticle === articleIndex
          ? ""
          : `<p>${clearance.publication.displayedVersion}</p><p>${clearance.publication.displayedReviewerRole}</p><time>${clearance.publication.displayedReviewDate}</time>`;
      const html = `<!doctype html><html><head><link href="${clearance.publication.canonicalUrl}" rel="canonical"></head><body><article>${markers.map((marker) => `<p>${marker}</p>`).join("")}${metadata}${placeholder}<a href="${clearance.publication.correctionUrl}">内容纠错</a></article></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const legacyIndex = session.legacyPages.findIndex(({ originalUrl }) => originalUrl === url);
    if (legacyIndex >= 0) {
      return new Response("not found", {
        status: overrides.legacyStatusForIndex === legacyIndex ? 200 : 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

function optionsFor(fixture: Fixture, fetchImpl = fetchForSession(fixture.session)) {
  return {
    sessionPath: fixture.sessionPath,
    evidenceRoot: fixture.evidenceRoot,
    reportDir: fixture.reportDir,
    repositoryRoot: fixture.repositoryRoot,
    expectedVersion: fixture.session.candidate.version,
    expectedGitSha: fixture.gitSha,
    expectedBaseUrl: fixture.session.candidate.baseUrl,
    expectedEnvironmentId: fixture.session.candidate.environmentId,
    fetchImpl,
    now: () => new Date("2026-07-20T08:00:00.000Z"),
  };
}

async function rewriteSession(
  fixture: Fixture,
  mutate: (session: EducationContentClearanceSession) => void,
): Promise<void> {
  const session = structuredClone(fixture.session);
  mutate(session);
  await writeProtectedFile(fixture.sessionPath, `${JSON.stringify(session, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("education content clearance evidence", () => {
  it("loads raw candidate documents from the exact commit instead of the working tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiatlux-education-candidate-"));
    roots.push(root);
    await chmod(root, 0o700);
    const { repositoryRoot, gitSha } = await createRepository(root);
    await writeFile(
      join(repositoryRoot, educationV1ContentFilePaths[0]),
      "this uncommitted working-tree file is deliberately invalid JSON\n",
      "utf8",
    );

    const candidate = await loadEducationContentCandidateFromGit(repositoryRoot, gitSha);

    expect(candidate.snapshot.articles).toHaveLength(12);
    expect(candidate.documents).toHaveLength(2);
    expect(candidate.documents[0]).toMatchObject({
      path: educationV1ContentFilePaths[0],
      document: {
        datasetId: "fiatlux-education-foundation",
      },
    });
  });

  it("binds the candidate Git snapshot, protected artifacts and all public pages", async () => {
    const fixture = await createFixture();
    const result = await verifyEducationContentClearanceEvidence(optionsFor(fixture));

    expect(result.report.result).toBe("success");
    expect(result.report.articles).toHaveLength(12);
    expect(result.report.legacyPages).toHaveLength(7);
    expect(result.report.independentVerification.gitContentSnapshot).toBe(true);
    expect(result.report.independentVerification.approvalAuthenticity).toBe(false);
    expect(result.report.articles.every(({ publicProbe }) => publicProbe.status === 200)).toBe(
      true,
    );
    expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    expect(sha256(await readFile(result.reportPath))).toBe(result.reportSha256);
  });

  it("rejects independently supplied candidate identity mismatches before public requests", async () => {
    const fixture = await createFixture();
    let fetchCalls = 0;
    await expect(
      verifyEducationContentClearanceEvidence({
        ...optionsFor(fixture, async () => {
          fetchCalls += 1;
          return new Response("unexpected");
        }),
        expectedVersion: "v1.0.0-rc.5",
      }),
    ).rejects.toThrow("独立期望不一致");
    expect(fetchCalls).toBe(0);
  });

  it("rejects a session snapshot that differs from the candidate commit", async () => {
    const fixture = await createFixture();
    await rewriteSession(fixture, (session) => {
      const first = session.contentSnapshot.articles[0];
      const clearance = session.articleClearances[0];
      if (first && clearance) {
        first.contentSha256 = "f".repeat(64);
        clearance.contentSha256 = first.contentSha256;
      }
    });
    await expect(verifyEducationContentClearanceEvidence(optionsFor(fixture))).rejects.toThrow(
      "与候选 Git 提交",
    );
  });

  it("rejects artifact byte changes", async () => {
    const fixture = await createFixture();
    await writeProtectedFile(
      join(fixture.evidenceRoot, "captures", "review-proof.txt"),
      "tampered evidence\n",
    );
    await expect(verifyEducationContentClearanceEvidence(optionsFor(fixture))).rejects.toThrow(
      /字节数不一致|SHA-256 不一致/,
    );
  });

  it("rejects public pages that omit candidate content markers", async () => {
    const fixture = await createFixture();
    await expect(
      verifyEducationContentClearanceEvidence(
        optionsFor(fixture, fetchForSession(fixture.session, { missingMarkerForArticle: 0 })),
      ),
    ).rejects.toThrow("未完整呈现候选内容标记");
  });

  it("rejects public pages that omit registered version or review metadata", async () => {
    const fixture = await createFixture();
    await expect(
      verifyEducationContentClearanceEvidence(
        optionsFor(fixture, fetchForSession(fixture.session, { missingMetadataForArticle: 0 })),
      ),
    ).rejects.toThrow("未呈现登记的版本、复核角色或复核日期");
  });

  it("rejects legacy placeholder text on a claimed published page", async () => {
    const fixture = await createFixture();
    await expect(
      verifyEducationContentClearanceEvidence(
        optionsFor(fixture, fetchForSession(fixture.session, { placeholderForArticle: 0 })),
      ),
    ).rejects.toThrow("WordPress introduction template");
  });

  it("rejects a review-only marker on a claimed published page", async () => {
    const fixture = await createFixture();
    await expect(
      verifyEducationContentClearanceEvidence(
        optionsFor(fixture, fetchForSession(fixture.session, { reviewOnlyMarkerForArticle: 0 })),
      ),
    ).rejects.toThrow("FIAT LUX review-only bundle marker");
  });

  it("rejects legacy page status that contradicts its disposition", async () => {
    const fixture = await createFixture();
    await expect(
      verifyEducationContentClearanceEvidence(
        optionsFor(fixture, fetchForSession(fixture.session, { legacyStatusForIndex: 0 })),
      ),
    ).rejects.toThrow("旧模板页面状态与登记不一致");
  });

  it("stops reading a chunked public response after the 5 MB limit", async () => {
    const fixture = await createFixture();
    const normalFetch = fetchForSession(fixture.session);
    let articleRequestCount = 0;
    const oversizedFetch = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (
        fixture.session.articleClearances.some(({ publication }) => publication.publicUrl === url)
      ) {
        articleRequestCount += 1;
        if (articleRequestCount === 1) {
          return new Response(new Uint8Array(5_000_001), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      }
      return normalFetch(input);
    };
    await expect(
      verifyEducationContentClearanceEvidence(optionsFor(fixture, oversizedFetch)),
    ).rejects.toThrow("超过 5 MB 限制");
  });

  it("refuses to overwrite an existing successful report", async () => {
    const fixture = await createFixture();
    await verifyEducationContentClearanceEvidence(optionsFor(fixture));
    await expect(verifyEducationContentClearanceEvidence(optionsFor(fixture))).rejects.toThrow(
      "拒绝覆盖",
    );
  });

  it("rejects a session file that is accessible to group or other", async () => {
    const fixture = await createFixture();
    await chmod(fixture.sessionPath, 0o644);
    await expect(
      verifyEducationContentClearanceEvidence(optionsFor(fixture)),
    ).rejects.toBeInstanceOf(EducationContentClearanceEvidenceError);
  });
});
