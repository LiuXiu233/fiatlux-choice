import { z } from "zod";

export const educationV1ContentFilePaths = [
  "content/education/foundation-articles.json",
  "content/education/expansion-articles.json",
] as const;

export const educationContentReviewIds = [
  "subject_matter_and_facts",
  "source_currency_and_applicability",
  "advertising_consumer_and_no_promises",
  "copyright_and_material_rights",
  "portrait_privacy_and_personal_information",
  "health_and_wellbeing_boundary",
  "content_safety_and_community_rules",
  "internal_trial_and_correction",
] as const;

export const educationLaunchQuestionnaireIds = [
  "audience_and_age",
  "payment_and_refund",
  "delivery_format",
  "course_classification",
  "credentials_and_marketing",
  "operating_entity_and_channels",
  "intellectual_property",
  "personal_information_and_cross_border",
  "ai_and_human_accountability",
] as const;

export const educationLegacyPlaceholderUrls = [
  "https://fiatlux.gg/how-fiat-lux-esports-supports-gaming-talent/",
  "https://fiatlux.gg/key-skills-every-esports-athlete-should-develop/",
  "https://fiatlux.gg/why-esports-is-the-future-of-competitive-sports/",
  "https://fiatlux.gg/the-growing-world-of-u-s-esports-tournaments/",
  "https://fiatlux.gg/behind-the-scenes-of-esports-talent-development/",
  "https://fiatlux.gg/how-to-excel-in-competitive-gaming-leagues/",
  "https://fiatlux.gg/top-strategies-for-aspiring-esports-athletes/",
] as const;

const offsetDateTimeSchema = z.string().datetime({ offset: true });
const localDateSchema = z.string().date();
const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/, "必须使用完整小写 Git commit SHA");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "必须使用 64 位小写 SHA-256");
const versionSchema = z
  .string()
  .regex(
    /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
    "必须使用 vMAJOR.MINOR.PATCH[-PRERELEASE]",
  );
const articleVersionSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/, "文章必须使用语义化版本号");
const stableIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{2,119}$/, "必须是 3–120 位小写稳定标识");
const articleIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "文章标识必须使用小写短横线格式");
const artifactIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,119}$/, "附件 ID 必须是 3–120 位小写稳定标识");
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
const governedTextSchema = z
  .string()
  .trim()
  .min(20)
  .max(4_000)
  .refine((value) => !/REPLACE_WITH|待填写|占位符/i.test(value), "结论不能保留模板占位值");
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

function isFiatLuxPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "fiatlux.gg" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith("/") &&
      url.pathname !== "/" &&
      !/^\/(?:wp-admin|wp-json)(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const fiatLuxPublicUrlSchema = z
  .string()
  .url()
  .refine(isFiatLuxPublicUrl, "必须是 fiatlux.gg 上无凭据、query、fragment 的公开 HTTPS 内容 URL");
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

const contentFileSnapshotSchema = z
  .object({
    path: z.enum(educationV1ContentFilePaths),
    datasetId: articleIdSchema,
    schemaVersion: articleVersionSchema,
    sha256: sha256Schema,
    bytes: z.number().int().min(1).max(20_000_000),
  })
  .strict();

const articleSnapshotSchema = z
  .object({
    articleId: articleIdSchema,
    slug: articleIdSchema,
    title: z.string().trim().min(4).max(160),
    version: articleVersionSchema,
    sourceFile: z.enum(educationV1ContentFilePaths),
    contentSha256: sha256Schema,
    sourceRefs: z.array(articleIdSchema).min(1).max(30),
    verificationMarkers: z.tuple([
      z.string().trim().min(4).max(200),
      z.string().trim().min(4).max(200),
      z.string().trim().min(4).max(200),
    ]),
  })
  .strict();

export const educationContentSnapshotSchema = z
  .object({
    files: z.array(contentFileSnapshotSchema).length(educationV1ContentFilePaths.length),
    articles: z.array(articleSnapshotSchema).length(12),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedCounts = [4, 8] as const;
    for (const [index, path] of educationV1ContentFilePaths.entries()) {
      const actual = snapshot.articles.filter(({ sourceFile }) => sourceFile === path).length;
      if (actual !== expectedCounts[index]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["articles"],
          message: `${path} 必须精确提供 ${expectedCounts[index]} 篇 V1 内容，实际 ${actual} 篇`,
        });
      }
    }
  });

const reviewerModeSchema = z.enum(["different_person", "same_person_dual_role_disclosed"]);
const clearanceReviewSchema = z
  .object({
    id: z.enum(educationContentReviewIds),
    result: z.literal("passed"),
    reviewerIdentity: z.string().trim().min(2).max(200),
    reviewerRole: z.string().trim().min(2).max(200),
    reviewerMode: reviewerModeSchema,
    reviewedAt: offsetDateTimeSchema,
    evidenceArtifactIds: z.array(artifactIdSchema).min(1).max(20),
    conclusion: governedTextSchema,
  })
  .strict();

const sourceClearanceSchema = z
  .object({
    sourceRef: articleIdSchema,
    result: z.literal("current_and_applicable"),
    reviewerIdentity: z.string().trim().min(2).max(200),
    reviewerRole: z.string().trim().min(2).max(200),
    reviewedAt: offsetDateTimeSchema,
    evidenceArtifactIds: z.array(artifactIdSchema).min(1).max(20),
    applicabilityConclusion: governedTextSchema,
  })
  .strict();

const rightsMaterialSchema = z
  .object({
    materialId: stableIdSchema,
    kind: z.enum([
      "article_text",
      "template",
      "image",
      "audio",
      "video",
      "game_capture",
      "quotation",
      "other",
    ]),
    description: z.string().trim().min(5).max(500),
    result: z.literal("cleared"),
    basis: z.enum([
      "company_original_authorship",
      "written_license",
      "public_domain",
      "statutory_exception_reviewed",
      "no_third_party_material",
    ]),
    rightsHolder: z.string().trim().min(2).max(300),
    territory: z.string().trim().min(2).max(200),
    channels: z
      .array(z.enum(["fiatlux_gg_wordpress", "internal_training"]))
      .min(1)
      .max(2),
    expiresAt: offsetDateTimeSchema.nullable(),
    evidenceArtifactIds: z.array(artifactIdSchema).min(1).max(20),
  })
  .strict();

const humanApprovalSchema = z
  .object({
    decision: z.literal("approved"),
    approverIdentity: z.string().trim().min(2).max(200),
    approverRole: z.string().trim().min(2).max(200),
    approverMode: reviewerModeSchema,
    approvalReference: evidenceReferenceSchema,
    approvedAt: offsetDateTimeSchema,
    evidenceArtifactIds: z.array(artifactIdSchema).min(1).max(20),
  })
  .strict();

const articlePublicationSchema = z
  .object({
    status: z.literal("published_with_evidence"),
    targetChannel: z.literal("fiatlux_gg_wordpress"),
    publicUrl: fiatLuxPublicUrlSchema,
    canonicalUrl: fiatLuxPublicUrlSchema,
    wordpressPostId: z.string().regex(/^[1-9][0-9]{0,19}$/, "WordPress post ID 必须是正整数文本"),
    publisherIdentity: z.string().trim().min(2).max(200),
    publishedAt: offsetDateTimeSchema,
    publiclyObservedAt: offsetDateTimeSchema,
    httpStatus: z.literal(200),
    unauthenticatedAccess: z.literal(true),
    titleAndVersionVisible: z.literal(true),
    reviewerAndReviewDateVisible: z.literal(true),
    correctionEntryVisible: z.literal(true),
    desktopAndMobileQaPassed: z.literal(true),
    basicAccessibilityCheckPassed: z.literal(true),
    placeholderTextAbsent: z.literal(true),
    displayedVersion: articleVersionSchema,
    displayedReviewerRole: z.string().trim().min(2).max(200),
    displayedReviewDate: localDateSchema,
    correctionUrl: fiatLuxPublicUrlSchema,
    htmlExportArtifactId: artifactIdSchema,
    desktopCaptureArtifactId: artifactIdSchema,
    mobileCaptureArtifactId: artifactIdSchema,
  })
  .strict();

const articleClearanceSchema = z
  .object({
    articleId: articleIdSchema,
    slug: articleIdSchema,
    version: articleVersionSchema,
    contentSha256: sha256Schema,
    responsibleIdentity: z.string().trim().min(2).max(200),
    reviews: z.array(clearanceReviewSchema).length(educationContentReviewIds.length),
    sourceClearances: z.array(sourceClearanceSchema).min(1).max(30),
    rightsMaterials: z.array(rightsMaterialSchema).min(1).max(100),
    blockingIssuesOpen: z.literal(0),
    publicationApproval: humanApprovalSchema,
    publication: articlePublicationSchema,
    correctionOwnerIdentity: z.string().trim().min(2).max(200),
    correctionSlaBusinessDays: z.number().int().min(1).max(30),
    nextReviewAt: localDateSchema,
  })
  .strict();

const questionnaireDecisionSchema = z
  .object({
    id: z.enum(educationLaunchQuestionnaireIds),
    decision: z.literal("cleared"),
    reviewerIdentity: z.string().trim().min(2).max(200),
    reviewerRole: z.string().trim().min(2).max(200),
    reviewedAt: offsetDateTimeSchema,
    effectiveFrom: localDateSchema,
    effectiveUntil: localDateSchema.nullable(),
    evidenceArtifactIds: z.array(artifactIdSchema).min(1).max(30),
    conclusion: governedTextSchema,
  })
  .strict();

const legacyCommonSchema = z.object({
  originalUrl: z.enum(educationLegacyPlaceholderUrls),
  observedAt: offsetDateTimeSchema,
  placeholderTextAbsent: z.literal(true),
  httpCaptureArtifactId: artifactIdSchema,
  visualCaptureArtifactId: artifactIdSchema,
});
const legacyPageDispositionSchema = z.discriminatedUnion("action", [
  legacyCommonSchema
    .extend({
      action: z.literal("withdrawn"),
      httpStatus: z.union([z.literal(404), z.literal(410)]),
      replacementUrl: z.null(),
      mappedArticleId: z.null(),
    })
    .strict(),
  legacyCommonSchema
    .extend({
      action: z.literal("redirected"),
      httpStatus: z.union([z.literal(301), z.literal(308)]),
      replacementUrl: fiatLuxPublicUrlSchema,
      mappedArticleId: articleIdSchema,
    })
    .strict(),
  legacyCommonSchema
    .extend({
      action: z.literal("rewritten_in_place"),
      httpStatus: z.literal(200),
      replacementUrl: z.null(),
      mappedArticleId: articleIdSchema,
    })
    .strict(),
]);

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
      "image/webp",
      "text/csv",
      "text/html",
      "text/plain",
    ]),
    capturedAt: offsetDateTimeSchema,
    personalInformationScope: z.enum(["none", "reviewer_identity_only"]),
  })
  .strict();

function addOrderedCoverageIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  expected: readonly string[],
  path: (string | number)[],
  label: string,
): void {
  if (
    values.length !== expected.length ||
    values.some((value, index) => value !== expected[index])
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `${label}必须按固定顺序完整覆盖：${expected.join("、")}`,
    });
  }
}

export const educationContentClearanceSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceType: z.literal("education_content_clearance_session"),
    sessionId: z.string().regex(/^[a-z0-9][a-z0-9._-]{7,119}$/),
    candidate: z
      .object({
        version: versionSchema,
        gitSha: gitCommitSchema,
        baseUrl: targetOriginSchema,
        environmentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$/),
      })
      .strict(),
    execution: z
      .object({
        startedAt: offsetDateTimeSchema,
        finishedAt: offsetDateTimeSchema,
        timezone: z.literal("Asia/Shanghai"),
        operatorIdentity: z.string().trim().min(2).max(200),
      })
      .strict(),
    contentSnapshot: educationContentSnapshotSchema,
    questionnaire: z
      .array(questionnaireDecisionSchema)
      .length(educationLaunchQuestionnaireIds.length),
    articleClearances: z.array(articleClearanceSchema).length(12),
    legacyPages: z.array(legacyPageDispositionSchema).length(educationLegacyPlaceholderUrls.length),
    privacy: z
      .object({
        rawWordpressCredentialsCaptured: z.literal(false),
        authorizationHeadersCaptured: z.literal(false),
        sessionCookiesCaptured: z.literal(false),
        learnerPersonalInformationCaptured: z.literal(false),
        sensitivePersonalInformationCaptured: z.literal(false),
        reviewerIdentityDisclosureLimited: z.literal(true),
        secretScanPassed: z.literal(true),
        secretScanArtifactId: artifactIdSchema,
      })
      .strict(),
    finalApproval: humanApprovalSchema,
    artifacts: z.array(artifactSchema).min(10).max(500),
  })
  .strict()
  .superRefine((session, context) => {
    const start = Date.parse(session.execution.startedAt);
    const finish = Date.parse(session.execution.finishedAt);
    const addIssue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (start >= finish) addIssue(["execution", "finishedAt"], "finishedAt 必须晚于 startedAt");

    addOrderedCoverageIssues(
      context,
      session.contentSnapshot.files.map(({ path }) => path),
      educationV1ContentFilePaths,
      ["contentSnapshot", "files"],
      "内容文件",
    );
    addOrderedCoverageIssues(
      context,
      session.questionnaire.map(({ id }) => id),
      educationLaunchQuestionnaireIds,
      ["questionnaire"],
      "上线事实问卷",
    );
    addOrderedCoverageIssues(
      context,
      session.legacyPages.map(({ originalUrl }) => originalUrl),
      educationLegacyPlaceholderUrls,
      ["legacyPages"],
      "旧模板页面处置",
    );

    const snapshotIds = new Set<string>();
    const snapshotSlugs = new Set<string>();
    for (const [index, article] of session.contentSnapshot.articles.entries()) {
      if (snapshotIds.has(article.articleId)) {
        addIssue(["contentSnapshot", "articles", index, "articleId"], "文章标识不能重复");
      }
      if (snapshotSlugs.has(article.slug)) {
        addIssue(["contentSnapshot", "articles", index, "slug"], "文章 slug 不能重复");
      }
      snapshotIds.add(article.articleId);
      snapshotSlugs.add(article.slug);
      if (new Set(article.sourceRefs).size !== article.sourceRefs.length) {
        addIssue(["contentSnapshot", "articles", index, "sourceRefs"], "文章来源不能重复");
      }
      if (new Set(article.verificationMarkers).size !== article.verificationMarkers.length) {
        addIssue(
          ["contentSnapshot", "articles", index, "verificationMarkers"],
          "公开页核验标记不能重复",
        );
      }
    }

    const questionnaireWindows = session.questionnaire.map((item, index) => {
      const reviewedAt = Date.parse(item.reviewedAt);
      if (reviewedAt < start || reviewedAt > finish) {
        addIssue(["questionnaire", index, "reviewedAt"], "问卷复核必须位于会话窗口内");
      }
      if (item.effectiveUntil && item.effectiveUntil < item.effectiveFrom) {
        addIssue(["questionnaire", index, "effectiveUntil"], "问卷失效日不能早于生效日");
      }
      return item;
    });

    const publicUrls = new Set<string>();
    const wordpressPostIds = new Set<string>();
    const publicationApprovalReferences = new Set<string>();
    const articleApprovalArtifactIds = new Set<string>();
    const publicationArtifactIds = new Set<string>();
    let latestRequiredApprovalTime = start;
    for (const [index, clearance] of session.articleClearances.entries()) {
      const snapshot = session.contentSnapshot.articles[index];
      if (
        !snapshot ||
        clearance.articleId !== snapshot.articleId ||
        clearance.slug !== snapshot.slug ||
        clearance.version !== snapshot.version ||
        clearance.contentSha256 !== snapshot.contentSha256
      ) {
        addIssue(
          ["articleClearances", index],
          "逐篇放行记录必须按快照顺序精确绑定文章标识、slug、版本和内容哈希",
        );
      }
      addOrderedCoverageIssues(
        context,
        clearance.reviews.map(({ id }) => id),
        educationContentReviewIds,
        ["articleClearances", index, "reviews"],
        "逐篇复核",
      );
      addOrderedCoverageIssues(
        context,
        clearance.sourceClearances.map(({ sourceRef }) => sourceRef),
        snapshot?.sourceRefs ?? [],
        ["articleClearances", index, "sourceClearances"],
        "逐篇来源复核",
      );

      let latestReviewTime = start;
      for (const [reviewIndex, review] of clearance.reviews.entries()) {
        const reviewedAt = Date.parse(review.reviewedAt);
        if (reviewedAt < start || reviewedAt > finish) {
          addIssue(
            ["articleClearances", index, "reviews", reviewIndex, "reviewedAt"],
            "逐篇复核必须位于会话窗口内",
          );
        }
        latestReviewTime = Math.max(latestReviewTime, reviewedAt);
        const samePerson = review.reviewerIdentity === clearance.responsibleIdentity;
        if (
          (samePerson && review.reviewerMode !== "same_person_dual_role_disclosed") ||
          (!samePerson && review.reviewerMode !== "different_person")
        ) {
          addIssue(
            ["articleClearances", index, "reviews", reviewIndex, "reviewerMode"],
            "复核人与内容负责人是否同一人必须如实披露",
          );
        }
      }
      for (const [sourceIndex, source] of clearance.sourceClearances.entries()) {
        const reviewedAt = Date.parse(source.reviewedAt);
        if (reviewedAt < start || reviewedAt > finish) {
          addIssue(
            ["articleClearances", index, "sourceClearances", sourceIndex, "reviewedAt"],
            "来源复核必须位于会话窗口内",
          );
        }
        latestReviewTime = Math.max(latestReviewTime, reviewedAt);
      }
      if (
        new Set(clearance.rightsMaterials.map(({ materialId }) => materialId)).size !==
        clearance.rightsMaterials.length
      ) {
        addIssue(["articleClearances", index, "rightsMaterials"], "逐篇素材权利标识不能重复");
      }
      for (const [materialIndex, material] of clearance.rightsMaterials.entries()) {
        if (!material.channels.includes("fiatlux_gg_wordpress")) {
          addIssue(
            ["articleClearances", index, "rightsMaterials", materialIndex, "channels"],
            "公开文章的每项素材权利必须覆盖 fiatlux_gg_wordpress 渠道",
          );
        }
      }

      const approvalAt = Date.parse(clearance.publicationApproval.approvedAt);
      const sameApprover =
        clearance.publicationApproval.approverIdentity === clearance.responsibleIdentity;
      if (
        (sameApprover &&
          clearance.publicationApproval.approverMode !== "same_person_dual_role_disclosed") ||
        (!sameApprover && clearance.publicationApproval.approverMode !== "different_person")
      ) {
        addIssue(
          ["articleClearances", index, "publicationApproval", "approverMode"],
          "发布批准人与内容负责人是否同一人必须如实披露",
        );
      }
      if (approvalAt < latestReviewTime || approvalAt > finish) {
        addIssue(
          ["articleClearances", index, "publicationApproval", "approvedAt"],
          "逐篇发布批准必须在全部复核后且位于会话窗口内",
        );
      }
      const publishedAt = Date.parse(clearance.publication.publishedAt);
      const observedAt = Date.parse(clearance.publication.publiclyObservedAt);
      if (publishedAt < approvalAt || observedAt < publishedAt || observedAt > finish) {
        addIssue(
          ["articleClearances", index, "publication"],
          "人工批准、公开发布和无登录观察必须按顺序位于会话窗口内",
        );
      }
      if (clearance.publication.publicUrl !== clearance.publication.canonicalUrl) {
        addIssue(
          ["articleClearances", index, "publication", "canonicalUrl"],
          "canonical URL 必须与登记的公开 URL 完全一致",
        );
      }
      if (publicUrls.has(clearance.publication.publicUrl)) {
        addIssue(
          ["articleClearances", index, "publication", "publicUrl"],
          "十二篇文章必须使用不同公开 URL",
        );
      }
      publicUrls.add(clearance.publication.publicUrl);
      if (wordpressPostIds.has(clearance.publication.wordpressPostId)) {
        addIssue(
          ["articleClearances", index, "publication", "wordpressPostId"],
          "十二篇文章必须使用不同 WordPress post ID",
        );
      }
      wordpressPostIds.add(clearance.publication.wordpressPostId);
      if (publicationApprovalReferences.has(clearance.publicationApproval.approvalReference)) {
        addIssue(
          ["articleClearances", index, "publicationApproval", "approvalReference"],
          "逐篇发布必须使用不同批准记录",
        );
      }
      publicationApprovalReferences.add(clearance.publicationApproval.approvalReference);
      for (const artifactId of clearance.publicationApproval.evidenceArtifactIds) {
        articleApprovalArtifactIds.add(artifactId);
      }
      if (
        new Set([
          clearance.publication.htmlExportArtifactId,
          clearance.publication.desktopCaptureArtifactId,
          clearance.publication.mobileCaptureArtifactId,
        ]).size !== 3
      ) {
        addIssue(
          ["articleClearances", index, "publication"],
          "HTML 导出、桌面截图和移动截图必须是三个不同附件",
        );
      }
      for (const [field, artifactId] of [
        ["htmlExportArtifactId", clearance.publication.htmlExportArtifactId],
        ["desktopCaptureArtifactId", clearance.publication.desktopCaptureArtifactId],
        ["mobileCaptureArtifactId", clearance.publication.mobileCaptureArtifactId],
      ] as const) {
        if (publicationArtifactIds.has(artifactId)) {
          addIssue(
            ["articleClearances", index, "publication", field],
            "每篇文章必须使用自己独立的 HTML、桌面和移动端发布附件",
          );
        }
        publicationArtifactIds.add(artifactId);
      }
      if (clearance.publication.displayedVersion !== clearance.version) {
        addIssue(
          ["articleClearances", index, "publication", "displayedVersion"],
          "公开页显示版本必须与候选文章版本一致",
        );
      }
      if (
        !clearance.reviews.some(
          ({ reviewerRole, reviewedAt }) =>
            reviewerRole === clearance.publication.displayedReviewerRole &&
            reviewedAt.slice(0, 10) === clearance.publication.displayedReviewDate,
        )
      ) {
        addIssue(
          ["articleClearances", index, "publication"],
          "公开页显示的复核角色和日期必须对应本次逐篇复核记录",
        );
      }
      for (const [materialIndex, material] of clearance.rightsMaterials.entries()) {
        if (
          material.expiresAt !== null &&
          Date.parse(material.expiresAt) < Date.parse(clearance.publication.publishedAt)
        ) {
          addIssue(
            ["articleClearances", index, "rightsMaterials", materialIndex, "expiresAt"],
            "素材权利不得在文章发布前已经到期",
          );
        }
      }
      if (clearance.nextReviewAt < clearance.publication.publishedAt.slice(0, 10)) {
        addIssue(["articleClearances", index, "nextReviewAt"], "下次复核日不得早于发布日期");
      }
      for (const questionnaire of questionnaireWindows) {
        const publicationDate = clearance.publication.publishedAt.slice(0, 10);
        if (
          publicationDate < questionnaire.effectiveFrom ||
          (questionnaire.effectiveUntil !== null && publicationDate > questionnaire.effectiveUntil)
        ) {
          addIssue(
            ["questionnaire"],
            `问卷 ${questionnaire.id} 未覆盖文章 ${clearance.articleId} 的发布日期`,
          );
        }
        if (Date.parse(questionnaire.reviewedAt) > approvalAt) {
          addIssue(
            ["questionnaire"],
            `问卷 ${questionnaire.id} 必须在文章 ${clearance.articleId} 发布批准前完成`,
          );
        }
      }
      latestRequiredApprovalTime = Math.max(latestRequiredApprovalTime, observedAt);
    }

    const legacyArtifactIds = new Set<string>();
    for (const [index, legacy] of session.legacyPages.entries()) {
      const observedAt = Date.parse(legacy.observedAt);
      if (observedAt < start || observedAt > finish) {
        addIssue(["legacyPages", index, "observedAt"], "旧模板页面处置观察必须位于会话窗口内");
      }
      if (legacy.httpCaptureArtifactId === legacy.visualCaptureArtifactId) {
        addIssue(["legacyPages", index], "旧页面 HTTP 记录和视觉记录必须使用不同附件");
      }
      for (const [field, artifactId] of [
        ["httpCaptureArtifactId", legacy.httpCaptureArtifactId],
        ["visualCaptureArtifactId", legacy.visualCaptureArtifactId],
      ] as const) {
        if (legacyArtifactIds.has(artifactId)) {
          addIssue(
            ["legacyPages", index, field],
            "每个旧模板页面必须使用自己独立的 HTTP 与视觉附件",
          );
        }
        legacyArtifactIds.add(artifactId);
      }
      if (legacy.action !== "withdrawn") {
        const mapped = session.articleClearances.find(
          ({ articleId }) => articleId === legacy.mappedArticleId,
        );
        if (!mapped) {
          addIssue(
            ["legacyPages", index, "mappedArticleId"],
            "重定向或原位重写必须映射本次放行文章",
          );
        } else if (
          (legacy.action === "redirected" &&
            legacy.replacementUrl !== mapped.publication.publicUrl) ||
          (legacy.action === "rewritten_in_place" &&
            legacy.originalUrl !== mapped.publication.publicUrl)
        ) {
          addIssue(["legacyPages", index], "旧页面处置 URL 必须与映射文章的公开 URL 一致");
        }
      }
      latestRequiredApprovalTime = Math.max(latestRequiredApprovalTime, observedAt);
    }

    const artifactIds = new Set<string>();
    const artifactFiles = new Set<string>();
    for (const [index, artifact] of session.artifacts.entries()) {
      if (artifactIds.has(artifact.id)) addIssue(["artifacts", index, "id"], "附件 ID 不能重复");
      if (artifactFiles.has(artifact.file))
        addIssue(["artifacts", index, "file"], "附件路径不能重复");
      artifactIds.add(artifact.id);
      artifactFiles.add(artifact.file);
      const capturedAt = Date.parse(artifact.capturedAt);
      if (capturedAt < start || capturedAt > finish) {
        addIssue(["artifacts", index, "capturedAt"], "附件采集时间必须位于会话窗口内");
      }
      if (
        ["application/json", "text/csv", "text/html", "text/plain"].includes(artifact.mimeType) &&
        artifact.bytes > 10_000_000
      ) {
        addIssue(["artifacts", index, "bytes"], "需要读取和扫描的文本附件不得超过 10 MB");
      }
    }

    const referencedArtifactIds = new Set<string>([session.privacy.secretScanArtifactId]);
    for (const questionnaire of session.questionnaire) {
      for (const id of questionnaire.evidenceArtifactIds) referencedArtifactIds.add(id);
    }
    for (const clearance of session.articleClearances) {
      for (const review of clearance.reviews) {
        for (const id of review.evidenceArtifactIds) referencedArtifactIds.add(id);
      }
      for (const source of clearance.sourceClearances) {
        for (const id of source.evidenceArtifactIds) referencedArtifactIds.add(id);
      }
      for (const material of clearance.rightsMaterials) {
        for (const id of material.evidenceArtifactIds) referencedArtifactIds.add(id);
      }
      for (const id of clearance.publicationApproval.evidenceArtifactIds)
        referencedArtifactIds.add(id);
      referencedArtifactIds.add(clearance.publication.htmlExportArtifactId);
      referencedArtifactIds.add(clearance.publication.desktopCaptureArtifactId);
      referencedArtifactIds.add(clearance.publication.mobileCaptureArtifactId);
    }
    for (const legacy of session.legacyPages) {
      referencedArtifactIds.add(legacy.httpCaptureArtifactId);
      referencedArtifactIds.add(legacy.visualCaptureArtifactId);
    }
    for (const id of session.finalApproval.evidenceArtifactIds) referencedArtifactIds.add(id);
    for (const id of referencedArtifactIds) {
      if (!artifactIds.has(id)) addIssue(["artifacts"], `引用了未登记附件：${id}`);
    }
    for (const id of artifactIds) {
      if (!referencedArtifactIds.has(id))
        addIssue(["artifacts"], `存在未被任何放行记录引用的孤立附件：${id}`);
    }

    const finalApprovedAt = Date.parse(session.finalApproval.approvedAt);
    const sameFinalApprover =
      session.finalApproval.approverIdentity === session.execution.operatorIdentity;
    if (
      (sameFinalApprover &&
        session.finalApproval.approverMode !== "same_person_dual_role_disclosed") ||
      (!sameFinalApprover && session.finalApproval.approverMode !== "different_person")
    ) {
      addIssue(["finalApproval", "approverMode"], "最终批准人与会话操作者是否同一人必须如实披露");
    }
    if (finalApprovedAt < latestRequiredApprovalTime || finalApprovedAt > finish) {
      addIssue(
        ["finalApproval", "approvedAt"],
        "最终放行批准必须晚于全部公开观察与旧页面处置且位于会话窗口内",
      );
    }
    if (publicationApprovalReferences.has(session.finalApproval.approvalReference)) {
      addIssue(["finalApproval", "approvalReference"], "最终批准不得复用任何逐篇发布批准记录");
    }
    if (
      session.finalApproval.evidenceArtifactIds.some((id) => articleApprovalArtifactIds.has(id))
    ) {
      addIssue(["finalApproval", "evidenceArtifactIds"], "最终批准不得复用逐篇批准附件");
    }
  });

export type EducationContentSnapshot = z.infer<typeof educationContentSnapshotSchema>;
export type EducationContentClearanceSession = z.infer<
  typeof educationContentClearanceSessionSchema
>;
