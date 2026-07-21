import { describe, expect, it } from "vitest";

import {
  educationContentClearanceSessionSchema,
  educationContentReviewIds,
  educationLaunchQuestionnaireIds,
  educationLegacyPlaceholderUrls,
  educationV1ContentFilePaths,
} from "../src/index.js";

function digest(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function makeSession() {
  const articleSnapshots = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      articleId: `education-article-${number}`,
      slug: `education-article-${number}`,
      title: `电竞教育文章 ${number}`,
      version: "1.0.0",
      sourceFile: educationV1ContentFilePaths[index < 4 ? 0 : 1],
      contentSha256: digest(100 + index),
      sourceRefs: [`source-${number}`],
      verificationMarkers: [
        `电竞教育文章 ${number}`,
        `核心章节 ${number}`,
        `实践模板 ${number}`,
      ] as [string, string, string],
    };
  });
  const artifactIds = new Set<string>([
    "questionnaire-proof",
    "review-proof",
    "source-proof",
    "rights-proof",
    "secret-scan",
    "final-approval",
  ]);
  const articleClearances = articleSnapshots.map((article, index) => {
    const number = String(index + 1).padStart(2, "0");
    const approvalArtifactId = `article-${number}-approval`;
    const htmlArtifactId = `article-${number}-html`;
    const desktopArtifactId = `article-${number}-desktop`;
    const mobileArtifactId = `article-${number}-mobile`;
    for (const id of [approvalArtifactId, htmlArtifactId, desktopArtifactId, mobileArtifactId]) {
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
          expiresAt: null as string | null,
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
        htmlExportArtifactId: htmlArtifactId,
        desktopCaptureArtifactId: desktopArtifactId,
        mobileCaptureArtifactId: mobileArtifactId,
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
  return {
    schemaVersion: 1 as const,
    evidenceType: "education_content_clearance_session" as const,
    sessionId: "education-clearance-20260720-001",
    candidate: {
      version: "v1.0.0-rc.4",
      gitSha: "a".repeat(40),
      baseUrl: "https://choice.internal.example/",
      environmentId: "fiatlux-guangzhou-office-prod",
    },
    execution: {
      startedAt: "2026-07-20T08:00:00+08:00",
      finishedAt: "2026-07-20T15:00:00+08:00",
      timezone: "Asia/Shanghai" as const,
      operatorIdentity: "会话操作者甲",
    },
    contentSnapshot: {
      files: [
        {
          path: educationV1ContentFilePaths[0],
          datasetId: "fiatlux-education-foundation",
          schemaVersion: "1.0.0",
          sha256: "b".repeat(64),
          bytes: 1000,
        },
        {
          path: educationV1ContentFilePaths[1],
          datasetId: "fiatlux-education-expansion",
          schemaVersion: "1.0.0",
          sha256: "c".repeat(64),
          bytes: 2000,
        },
      ],
      articles: articleSnapshots,
    },
    questionnaire: educationLaunchQuestionnaireIds.map((id) => ({
      id,
      decision: "cleared" as const,
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
      rawWordpressCredentialsCaptured: false as const,
      authorizationHeadersCaptured: false as const,
      sessionCookiesCaptured: false as const,
      learnerPersonalInformationCaptured: false as const,
      sensitivePersonalInformationCaptured: false as const,
      reviewerIdentityDisclosureLimited: true as const,
      secretScanPassed: true as const,
      secretScanArtifactId: "secret-scan",
    },
    finalApproval: {
      decision: "approved" as const,
      approverIdentity: "公司发布批准人辛",
      approverRole: "公司负责人",
      approverMode: "different_person" as const,
      approvalReference: "approval:education:final:20260720",
      approvedAt: "2026-07-20T14:00:00+08:00",
      evidenceArtifactIds: ["final-approval"],
    },
    artifacts: [...artifactIds].map((id, index) => ({
      id,
      file: `captures/${id}.json`,
      sha256: digest(1000 + index),
      bytes: 100 + index,
      mimeType: "application/json" as const,
      capturedAt: "2026-07-20T10:30:00+08:00",
      personalInformationScope: id.includes("approval")
        ? ("reviewer_identity_only" as const)
        : ("none" as const),
    })),
  };
}

function expectInvalid(session: ReturnType<typeof makeSession>, message: string): void {
  const parsed = educationContentClearanceSessionSchema.safeParse(session);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(parsed.error.issues.map((issue) => issue.message).join("；")).toContain(message);
  }
}

describe("educationContentClearanceSessionSchema", () => {
  it("accepts an exact 12-article, nine-questionnaire and seven-legacy-page clearance", () => {
    expect(educationContentClearanceSessionSchema.safeParse(makeSession()).success).toBe(true);
  });

  it("rejects reordered per-article review coverage", () => {
    const session = makeSession();
    session.articleClearances[0]?.reviews.reverse();
    expectInvalid(session, "逐篇复核必须按固定顺序完整覆盖");
  });

  it("rejects a clearance that does not bind the article content hash", () => {
    const session = makeSession();
    if (session.articleClearances[0]) session.articleClearances[0].contentSha256 = "f".repeat(64);
    expectInvalid(session, "精确绑定文章标识、slug、版本和内容哈希");
  });

  it("requires the V1 content split to remain exactly four foundation and eight expansion articles", () => {
    const session = makeSession();
    const first = session.contentSnapshot.articles[0];
    if (first) first.sourceFile = educationV1ContentFilePaths[1];
    expectInvalid(session, "精确提供 4 篇 V1 内容");
  });

  it("requires honest same-person dual-role disclosure", () => {
    const session = makeSession();
    const first = session.articleClearances[0];
    if (first?.reviews[0]) first.reviews[0].reviewerIdentity = first.responsibleIdentity;
    expectInvalid(session, "是否同一人必须如实披露");
  });

  it("rejects reused public URLs, post IDs, approvals and publication captures", () => {
    const session = makeSession();
    const first = session.articleClearances[0];
    const second = session.articleClearances[1];
    if (first && second) {
      second.publication.publicUrl = first.publication.publicUrl;
      second.publication.canonicalUrl = first.publication.canonicalUrl;
      second.publication.wordpressPostId = first.publication.wordpressPostId;
      second.publicationApproval.approvalReference = first.publicationApproval.approvalReference;
      second.publication.htmlExportArtifactId = first.publication.htmlExportArtifactId;
    }
    const parsed = educationContentClearanceSessionSchema.safeParse(session);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message).join("；");
      expect(messages).toContain("不同公开 URL");
      expect(messages).toContain("不同 WordPress post ID");
      expect(messages).toContain("不同批准记录");
      expect(messages).toContain("自己独立的 HTML");
    }
  });

  it("rejects questionnaires that do not cover the publication date", () => {
    const session = makeSession();
    if (session.questionnaire[0]) session.questionnaire[0].effectiveFrom = "2026-07-21";
    expectInvalid(session, "未覆盖文章");
  });

  it("requires questionnaires before approval and rights that cover the public channel and date", () => {
    const lateQuestionnaire = makeSession();
    if (lateQuestionnaire.questionnaire[0]) {
      lateQuestionnaire.questionnaire[0].reviewedAt = "2026-07-20T11:30:00+08:00";
    }
    expectInvalid(lateQuestionnaire, "发布批准前完成");

    const missingChannel = makeSession();
    const firstMaterial = missingChannel.articleClearances[0]?.rightsMaterials[0];
    if (firstMaterial) firstMaterial.channels = ["internal_training"];
    expectInvalid(missingChannel, "必须覆盖 fiatlux_gg_wordpress");

    const expiredRights = makeSession();
    const expiringMaterial = expiredRights.articleClearances[0]?.rightsMaterials[0];
    if (expiringMaterial) expiringMaterial.expiresAt = "2026-07-20T11:59:00+08:00";
    expectInvalid(expiredRights, "发布前已经到期");
  });

  it("binds displayed version and review metadata to the reviewed candidate", () => {
    const wrongVersion = makeSession();
    if (wrongVersion.articleClearances[0]) {
      wrongVersion.articleClearances[0].publication.displayedVersion = "2.0.0";
    }
    expectInvalid(wrongVersion, "显示版本必须与候选文章版本一致");

    const wrongReviewer = makeSession();
    if (wrongReviewer.articleClearances[0]) {
      wrongReviewer.articleClearances[0].publication.displayedReviewerRole = "不存在的复核角色";
    }
    expectInvalid(wrongReviewer, "必须对应本次逐篇复核记录");
  });

  it("rejects a final approval recorded before public observations", () => {
    const session = makeSession();
    session.finalApproval.approvedAt = "2026-07-20T12:30:00+08:00";
    expectInvalid(session, "最终放行批准必须晚于");
  });

  it("does not allow the final approval to reuse an article approval record or artifact", () => {
    const session = makeSession();
    const articleApproval = session.articleClearances[0]?.publicationApproval;
    if (articleApproval) {
      session.finalApproval.approvalReference = articleApproval.approvalReference;
      session.finalApproval.evidenceArtifactIds = [...articleApproval.evidenceArtifactIds];
    }
    const parsed = educationContentClearanceSessionSchema.safeParse(session);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message).join("；");
      expect(messages).toContain("最终批准不得复用任何逐篇发布批准记录");
      expect(messages).toContain("最终批准不得复用逐篇批准附件");
    }
  });

  it("rejects missing and orphaned artifacts", () => {
    const missing = makeSession();
    missing.artifacts = missing.artifacts.filter(({ id }) => id !== "secret-scan");
    expectInvalid(missing, "引用了未登记附件");

    const orphaned = makeSession();
    orphaned.artifacts.push({
      id: "orphaned-proof",
      file: "captures/orphaned-proof.json",
      sha256: "d".repeat(64),
      bytes: 50,
      mimeType: "application/json",
      capturedAt: "2026-07-20T10:30:00+08:00",
      personalInformationScope: "none",
    });
    expectInvalid(orphaned, "孤立附件");
  });

  it("rejects a publication URL with a query or a non-fiatlux host", () => {
    const session = makeSession();
    if (session.articleClearances[0]) {
      session.articleClearances[0].publication.publicUrl =
        "https://example.com/education/article-01/?preview=true";
    }
    expectInvalid(session, "必须是 fiatlux.gg");
  });
});
