import { createHash } from "node:crypto";

import type { EducationContentSnapshot } from "@fiatlux/contracts";

export const EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER = "FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH";

interface EducationReviewReference {
  id: string;
  kind: "official" | "internal";
  title: string;
  authority: string;
  location: string;
  publishedAt: string | null;
  lastVerifiedAt: string;
  reviewStatus: "draft" | "pending" | "reviewed";
  applicability: string;
  usageBoundary: string;
}

interface EducationReviewArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  version: string;
  audience: string;
  applicability: string[];
  nonPromises: string[];
  safetyNotes: string[];
  learningObjectives: string[];
  review: {
    status: "pending" | "in_review" | "changes_requested" | "reviewed";
    ownerRole: string;
    reviewerRoles: string[];
    lastReviewedAt: string | null;
    nextReviewAt: string;
    note: string;
  };
  rights: {
    status: "pending_clearance" | "cleared" | "restricted";
    basis: string;
    evidenceRefs: string[];
  };
  publication: {
    status: "not_published" | "approved_for_manual_publication" | "published_with_evidence";
    targetChannel: "fiatlux_gg_wordpress";
    externalStateLabel: string;
    evidenceUrl: string | null;
    publishedAt: string | null;
    manualBoundary: string;
  };
  aiDisclosure: {
    assisted: true;
    disclosure: string;
    humanReviewRequired: true;
    prohibitedUses: string[];
  };
  sourceRefs: string[];
  sections: Array<{
    heading: string;
    paragraphs: string[];
    bullets?: string[];
    example?: { label: string; text: string };
  }>;
  template: {
    title: string;
    instructions: string;
    fields: Array<{ label: string; guidance: string; example: string }>;
    completionRule: string;
  };
  practice: {
    title: string;
    scenario: string;
    steps: string[];
    deliverable: string;
    selfCheck: string[];
  };
  reviewQuestions: string[];
}

export interface EducationReviewLibrary {
  datasetId: string;
  title: string;
  status: "internal_draft" | "in_review" | "approved";
  audience: string;
  scope: string;
  lastUpdatedAt: string;
  nextReviewAt: string;
  maintenanceOwnerRole: string;
  publicationBoundary: string;
  references: EducationReviewReference[];
  articles: EducationReviewArticle[];
}

export interface EducationWordPressReviewBundleOptions {
  candidateGitSha: string;
  generatedAt: string;
  sourceSnapshot: EducationContentSnapshot;
  library: EducationReviewLibrary;
}

export interface EducationWordPressReviewBundleFile {
  path: string;
  mediaType: "application/json" | "text/html" | "text/markdown";
  content: string;
}

interface BundleArtifact {
  path: string;
  mediaType: EducationWordPressReviewBundleFile["mediaType"];
  bytes: number;
  sha256: string;
  purpose: "operator_readme" | "wordpress_review_html" | "governance_review_sheet";
  articleId: string | null;
}

interface BundleArticle {
  articleId: string;
  slug: string;
  title: string;
  version: string;
  sourceFile: string;
  contentSha256: string;
  reviewStatus: EducationReviewArticle["review"]["status"];
  rightsStatus: EducationReviewArticle["rights"]["status"];
  publicationStatus: EducationReviewArticle["publication"]["status"];
  publicationEligible: boolean;
  blockingReasons: string[];
  reviewHtmlPath: string;
  reviewSheetPath: string;
}

export interface EducationWordPressReviewBundleManifest {
  schemaVersion: 1;
  evidenceType: "education_wordpress_review_bundle";
  generatedAt: string;
  mode: "review_only";
  candidate: {
    gitSha: string;
    contentFiles: EducationContentSnapshot["files"];
  };
  library: {
    datasetId: string;
    status: EducationReviewLibrary["status"];
    lastUpdatedAt: string;
    nextReviewAt: string;
    articleCount: number;
  };
  articles: BundleArticle[];
  artifacts: BundleArtifact[];
  summary: {
    articleCount: number;
    publicationEligibleCount: number;
    blockedArticleCount: number;
  };
  safety: {
    reviewOnlyMarker: typeof EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER;
    externalPublicationPerformed: false;
    wordpressCredentialsAccepted: false;
    wordpressApiCalled: false;
    publicWebsiteStateVerified: false;
    manualPublicationRequired: true;
    professionalReviewSubstituted: false;
    rightsReviewSubstituted: false;
    approvalSubstituted: false;
  };
}

export interface EducationWordPressReviewBundle {
  manifest: EducationWordPressReviewBundleManifest;
  files: EducationWordPressReviewBundleFile[];
}

export class EducationWordPressReviewBundleError extends Error {
  override readonly name = "EducationWordPressReviewBundleError";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function artifact(
  file: EducationWordPressReviewBundleFile,
  purpose: BundleArtifact["purpose"],
  articleId: string | null,
): BundleArtifact {
  return {
    path: file.path,
    mediaType: file.mediaType,
    bytes: Buffer.byteLength(file.content, "utf8"),
    sha256: sha256(file.content),
    purpose,
    articleId,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");
}

function htmlParagraph(value: string, className?: string): string {
  const classAttribute = className ? ` class="${className}"` : "";
  return `<!-- wp:paragraph${className ? ` {"className":"${className}"}` : ""} -->\n<p${classAttribute}>${escapeHtml(value)}</p>\n<!-- /wp:paragraph -->`;
}

function htmlHeading(value: string, level: 2 | 3): string {
  return `<!-- wp:heading {"level":${level}} -->\n<h${level}>${escapeHtml(value)}</h${level}>\n<!-- /wp:heading -->`;
}

function htmlList(values: readonly string[]): string {
  return `<!-- wp:list -->\n<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>\n<!-- /wp:list -->`;
}

function renderReviewHtml(
  article: EducationReviewArticle,
  references: readonly EducationReviewReference[],
  candidateGitSha: string,
  contentSha256: string,
): string {
  const sections = article.sections.flatMap((section) => {
    const rendered = [htmlHeading(section.heading, 2)];
    rendered.push(...section.paragraphs.map((paragraph) => htmlParagraph(paragraph)));
    if (section.bullets && section.bullets.length > 0) rendered.push(htmlList(section.bullets));
    if (section.example) {
      rendered.push(htmlHeading(section.example.label, 3), htmlParagraph(section.example.text));
    }
    return rendered;
  });
  const sourceItems = references.map((reference) => {
    const location = reference.location.startsWith("https://")
      ? `<a href="${escapeHtml(reference.location)}">${escapeHtml(reference.title)}</a>`
      : `<code>${escapeHtml(reference.location)}</code>`;
    return `<li>${location}；${escapeHtml(reference.authority)}；复核状态 ${escapeHtml(reference.reviewStatus)}；最后核对 ${escapeHtml(reference.lastVerifiedAt)}</li>`;
  });
  const templateFields = article.template.fields.map(
    (field) =>
      `<li><strong>${escapeHtml(field.label)}</strong>：${escapeHtml(field.guidance)}<br><em>示例：${escapeHtml(field.example)}</em></li>`,
  );

  return [
    `<!-- ${EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER} -->`,
    htmlParagraph(
      `${EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER} · 内部审阅稿，尚未完成专业复核、素材权利与发布批准，禁止复制到公开 WordPress。`,
      "fiatlux-review-only-warning",
    ),
    `<!-- wp:heading {"level":1} -->\n<h1>${escapeHtml(article.title)}</h1>\n<!-- /wp:heading -->`,
    htmlParagraph(`版本 ${article.version} · 适用对象：${article.audience}`),
    htmlParagraph(article.summary),
    htmlHeading("学习目标", 2),
    htmlList(article.learningObjectives),
    htmlHeading("适用边界", 2),
    htmlList(article.applicability),
    ...sections,
    htmlHeading(article.practice.title, 2),
    htmlParagraph(article.practice.scenario),
    htmlList(article.practice.steps),
    htmlParagraph(`交付物：${article.practice.deliverable}`),
    htmlHeading(article.template.title, 2),
    htmlParagraph(article.template.instructions),
    `<!-- wp:list -->\n<ul>${templateFields.join("")}</ul>\n<!-- /wp:list -->`,
    htmlParagraph(article.template.completionRule),
    htmlHeading("安全提示与不承诺事项", 2),
    htmlList([...article.safetyNotes, ...article.nonPromises]),
    htmlHeading("AI 辅助披露", 2),
    htmlParagraph(article.aiDisclosure.disclosure),
    htmlList(article.aiDisclosure.prohibitedUses),
    htmlHeading("来源与更新时间", 2),
    `<!-- wp:list -->\n<ul>${sourceItems.join("")}</ul>\n<!-- /wp:list -->`,
    htmlParagraph(
      `候选提交 ${candidateGitSha}；逐篇内容 SHA-256 ${contentSha256}；下次复核 ${article.review.nextReviewAt}。`,
    ),
    htmlParagraph(
      "纠错入口尚未配置。只有逐篇放行会话、人工批准和公开页面验证全部完成后，才可替换本提示并发布。",
      "fiatlux-review-only-correction-placeholder",
    ),
    "",
  ].join("\n\n");
}

function renderReviewSheet(
  article: EducationReviewArticle,
  references: readonly EducationReviewReference[],
  candidateGitSha: string,
  contentSha256: string,
  blockingReasons: readonly string[],
): string {
  const lines = [
    `# ${escapeMarkdown(article.title)}：内部审阅表`,
    "",
    `> ${EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER}：本文件和配套 HTML 均不是发布批准或公开页面证据。`,
    "",
    `- 文章 ID：\`${article.id}\``,
    `- slug：\`${article.slug}\``,
    `- 版本：\`${article.version}\``,
    `- 候选 Git SHA：\`${candidateGitSha}\``,
    `- 逐篇内容 SHA-256：\`${contentSha256}\``,
    `- 内容复核状态：\`${article.review.status}\``,
    `- 素材权利状态：\`${article.rights.status}\``,
    `- 外部发布状态：\`${article.publication.status}\`（${escapeMarkdown(article.publication.externalStateLabel)}）`,
    `- 内容负责人角色：${escapeMarkdown(article.review.ownerRole)}`,
    `- 要求复核角色：${article.review.reviewerRoles.map(escapeMarkdown).join("、")}`,
    `- 最近复核：${article.review.lastReviewedAt ?? "尚未复核"}`,
    `- 下次复核：${article.review.nextReviewAt}`,
    "",
    "## 当前阻断原因",
    "",
    ...(blockingReasons.length > 0
      ? blockingReasons.map((reason) => `- [ ] ${escapeMarkdown(reason)}`)
      : ["- [ ] 结构化状态显示可进入人工发布准备，但仍须完成逐篇放行会话和可识别批准。"]),
    "",
    "## 负责人备注",
    "",
    escapeMarkdown(article.review.note),
    "",
    "## 权利依据",
    "",
    escapeMarkdown(article.rights.basis),
    "",
    `权利证据引用：${article.rights.evidenceRefs.length > 0 ? article.rights.evidenceRefs.map((item) => `\`${item}\``).join("、") : "无"}`,
    "",
    "## 逐项复核问题",
    "",
    ...article.reviewQuestions.map((question) => `- [ ] ${escapeMarkdown(question)}`),
    "",
    "## 来源适用性",
    "",
    ...references.flatMap((reference) => [
      `### ${escapeMarkdown(reference.title)}`,
      "",
      `- 标识：\`${reference.id}\``,
      `- 类型/机关：${reference.kind} / ${escapeMarkdown(reference.authority)}`,
      `- 位置：${escapeMarkdown(reference.location)}`,
      `- 发布/最后核对：${reference.publishedAt ?? "未登记"} / ${reference.lastVerifiedAt}`,
      `- 复核状态：\`${reference.reviewStatus}\``,
      `- 适用性：${escapeMarkdown(reference.applicability)}`,
      `- 使用边界：${escapeMarkdown(reference.usageBoundary)}`,
      "",
    ]),
    "## 人工操作检查表",
    "",
    "- [ ] 已使用候选提交重新生成本包并核对 SHA-256。",
    "- [ ] 九项上线事实问卷已由真实责任人完成。",
    "- [ ] 事实、专业、来源、权利、隐私、健康、内容安全和 AI 披露均有逐篇结论。",
    "- [ ] 已完成内部试讲并记录负面发现与修改。",
    "- [ ] 逐篇发布批准已取得，且同人多角色情况已披露。",
    "- [ ] WordPress 操作由获授权人员人工执行；未使用本工具登录、调用 API 或声明发布成功。",
    "- [ ] 公开页 canonical、版本、复核信息、纠错入口、移动端和可访问性已验证。",
    "- [ ] 真实 URL、post ID、截图、HTML、发布时间和批准已回填逐篇放行会话。",
    "",
    `发布边界：${escapeMarkdown(article.publication.manualBoundary)}`,
    "",
  ];
  return lines.join("\n");
}

function articleBlockingReasons(
  library: EducationReviewLibrary,
  article: EducationReviewArticle,
  references: readonly EducationReviewReference[],
): string[] {
  const reasons: string[] = [];
  if (library.status !== "approved") reasons.push(`内容库状态为 ${library.status}，尚未批准`);
  if (article.review.status !== "reviewed")
    reasons.push(`文章复核状态为 ${article.review.status}，尚未完成 reviewed`);
  if (!article.review.lastReviewedAt) reasons.push("文章没有真实最近复核日期");
  if (article.rights.status !== "cleared")
    reasons.push(`素材权利状态为 ${article.rights.status}，尚未 cleared`);
  if (article.rights.evidenceRefs.length === 0) reasons.push("素材权利没有证据引用");
  if (article.publication.status !== "approved_for_manual_publication") {
    reasons.push(`发布状态为 ${article.publication.status}，尚未批准人工发布`);
  }
  const pendingSources = references
    .filter(({ reviewStatus }) => reviewStatus !== "reviewed")
    .map(({ id }) => id);
  if (pendingSources.length > 0)
    reasons.push(`来源尚未完成适用性复核：${pendingSources.join("、")}`);
  return reasons;
}

function assertInput(options: EducationWordPressReviewBundleOptions): void {
  if (!/^[0-9a-f]{40}$/.test(options.candidateGitSha)) {
    throw new EducationWordPressReviewBundleError("候选 Git SHA 必须是完整小写 40 位提交");
  }
  if (!Number.isFinite(Date.parse(options.generatedAt))) {
    throw new EducationWordPressReviewBundleError("生成时间必须是有效 ISO 日期时间");
  }
  if (options.sourceSnapshot.files.length !== 2 || options.sourceSnapshot.articles.length !== 12) {
    throw new EducationWordPressReviewBundleError("V1 审阅包必须绑定两份候选内容文件和 12 篇文章");
  }
  if (options.library.articles.length !== 12) {
    throw new EducationWordPressReviewBundleError("合并内容库必须精确包含 12 篇文章");
  }
}

export function buildEducationWordPressReviewBundle(
  options: EducationWordPressReviewBundleOptions,
): EducationWordPressReviewBundle {
  assertInput(options);
  const referenceById = new Map(
    options.library.references.map((reference) => [reference.id, reference]),
  );
  const snapshotById = new Map(
    options.sourceSnapshot.articles.map((article) => [article.articleId, article]),
  );
  const articleFiles: EducationWordPressReviewBundleFile[] = [];
  const bundleArticles: BundleArticle[] = [];

  for (const [index, article] of options.library.articles.entries()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
      throw new EducationWordPressReviewBundleError(
        `文章 slug 不可安全用于文件名：${article.slug}`,
      );
    }
    const snapshot = snapshotById.get(article.id);
    if (
      !snapshot ||
      snapshot.slug !== article.slug ||
      snapshot.title !== article.title ||
      snapshot.version !== article.version
    ) {
      throw new EducationWordPressReviewBundleError(`文章与候选 Git 快照身份不一致：${article.id}`);
    }
    const computedContentSha256 = sha256(JSON.stringify(article));
    if (computedContentSha256 !== snapshot.contentSha256) {
      throw new EducationWordPressReviewBundleError(
        `文章与候选 Git 快照内容哈希不一致：${article.id}`,
      );
    }
    const references = article.sourceRefs.map((sourceRef) => {
      const reference = referenceById.get(sourceRef);
      if (!reference) {
        throw new EducationWordPressReviewBundleError(
          `文章引用了不存在的来源：${article.id}/${sourceRef}`,
        );
      }
      return reference;
    });
    const blockingReasons = articleBlockingReasons(options.library, article, references);
    const number = String(index + 1).padStart(2, "0");
    const reviewHtmlPath = `articles/${number}-${article.slug}.review.html`;
    const reviewSheetPath = `reviews/${number}-${article.slug}.review.md`;
    articleFiles.push(
      {
        path: reviewHtmlPath,
        mediaType: "text/html",
        content: renderReviewHtml(
          article,
          references,
          options.candidateGitSha,
          snapshot.contentSha256,
        ),
      },
      {
        path: reviewSheetPath,
        mediaType: "text/markdown",
        content: renderReviewSheet(
          article,
          references,
          options.candidateGitSha,
          snapshot.contentSha256,
          blockingReasons,
        ),
      },
    );
    bundleArticles.push({
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      version: article.version,
      sourceFile: snapshot.sourceFile,
      contentSha256: snapshot.contentSha256,
      reviewStatus: article.review.status,
      rightsStatus: article.rights.status,
      publicationStatus: article.publication.status,
      publicationEligible: blockingReasons.length === 0,
      blockingReasons,
      reviewHtmlPath,
      reviewSheetPath,
    });
  }

  const eligibleCount = bundleArticles.filter(
    ({ publicationEligible }) => publicationEligible,
  ).length;
  const readme: EducationWordPressReviewBundleFile = {
    path: "README.md",
    mediaType: "text/markdown",
    content: [
      "# FIAT LUX 电竞教育 WordPress 内部审阅包",
      "",
      `> ${EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER}：本目录只用于内部审阅，不是发布包、专业意见、权利许可或批准证明。`,
      "",
      `- 候选 Git SHA：\`${options.candidateGitSha}\``,
      `- 生成时间：${options.generatedAt}`,
      `- 文章数量：${bundleArticles.length}`,
      `- 结构状态可进入人工发布准备：${eligibleCount}`,
      `- 被阻断文章：${bundleArticles.length - eligibleCount}`,
      "",
      "每篇 `articles/*.review.html` 是带显著禁止发布标记的 WordPress 块编辑器审阅稿；配套 `reviews/*.review.md` 保存治理状态、来源适用性、逐项问题和人工检查表。只有另行完成逐篇放行会话、真实批准和 WordPress 人工操作后，才能生成公开页面证据。",
      "",
      "本工具不接受 WordPress 用户名、密码、Cookie、nonce 或应用密码，不发起网络请求，不调用 WordPress API，也不会把文件生成写成外部发布成功。`manifest.json` 最后写入；缺少它表示目录不完整。",
      "",
    ].join("\n"),
  };
  const artifactFiles = [readme, ...articleFiles];
  const artifacts = artifactFiles.map((file) => {
    const article = bundleArticles.find(
      ({ reviewHtmlPath, reviewSheetPath }) =>
        reviewHtmlPath === file.path || reviewSheetPath === file.path,
    );
    const purpose =
      file.path === "README.md"
        ? "operator_readme"
        : file.mediaType === "text/html"
          ? "wordpress_review_html"
          : "governance_review_sheet";
    return artifact(file, purpose, article?.articleId ?? null);
  });
  const manifest: EducationWordPressReviewBundleManifest = {
    schemaVersion: 1,
    evidenceType: "education_wordpress_review_bundle",
    generatedAt: options.generatedAt,
    mode: "review_only",
    candidate: {
      gitSha: options.candidateGitSha,
      contentFiles: options.sourceSnapshot.files,
    },
    library: {
      datasetId: options.library.datasetId,
      status: options.library.status,
      lastUpdatedAt: options.library.lastUpdatedAt,
      nextReviewAt: options.library.nextReviewAt,
      articleCount: options.library.articles.length,
    },
    articles: bundleArticles,
    artifacts,
    summary: {
      articleCount: bundleArticles.length,
      publicationEligibleCount: eligibleCount,
      blockedArticleCount: bundleArticles.length - eligibleCount,
    },
    safety: {
      reviewOnlyMarker: EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER,
      externalPublicationPerformed: false,
      wordpressCredentialsAccepted: false,
      wordpressApiCalled: false,
      publicWebsiteStateVerified: false,
      manualPublicationRequired: true,
      professionalReviewSubstituted: false,
      rightsReviewSubstituted: false,
      approvalSubstituted: false,
    },
  };
  const manifestFile: EducationWordPressReviewBundleFile = {
    path: "manifest.json",
    mediaType: "application/json",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
  return { manifest, files: [...artifactFiles, manifestFile] };
}
