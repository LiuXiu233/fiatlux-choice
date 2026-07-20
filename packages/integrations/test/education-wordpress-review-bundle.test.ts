import { createHash } from "node:crypto";

import type { EducationContentSnapshot } from "@fiatlux/contracts";
import { describe, expect, it } from "vitest";
import {
  buildEducationWordPressReviewBundle,
  EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER,
  type EducationReviewLibrary,
} from "../src/education-wordpress-review-bundle.js";

const candidateGitSha = "a".repeat(40);

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function firstOrThrow<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (!value) throw new Error(`测试夹具缺少${label}`);
  return value;
}

function makeArticle(index: number): EducationReviewLibrary["articles"][number] {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `article-${number}`,
    slug: `article-${number}`,
    title: `电竞教育内部审阅文章 ${number}`,
    summary: `这是第 ${number} 篇用于验证 WordPress 内部审阅包的结构化摘要，不代表已经对外发布。`,
    version: "0.1.0",
    audience: "中国境内成年电竞学习者",
    applicability: ["仅用于内部审阅。", "不用于公开招生或结果承诺。"],
    nonPromises: [
      "不承诺段位或胜率。",
      "不承诺签约或就业。",
      "不承诺收入或证书。",
      "不替代健康或法律意见。",
    ],
    safetyNotes: ["不得填写密码或验证码。", "不适时应停止并寻求适当帮助。"],
    learningObjectives: ["识别事实和推断。", "形成可复核动作。"],
    review: {
      status: "pending",
      ownerRole: "电竞教育负责人",
      reviewerRoles: ["成人电竞教练", "法务合规负责人"],
      lastReviewedAt: null,
      nextReviewAt: "2026-10-20",
      note: "需要真实试讲和实名复核；<script>alert('review')</script>\n## 不能注入标题。",
    },
    rights: {
      status: "pending_clearance",
      basis: "内部原创草案，尚未取得签名权利清单。",
      evidenceRefs: [],
    },
    publication: {
      status: "not_published",
      targetChannel: "fiatlux_gg_wordpress",
      externalStateLabel: "WordPress 未发布",
      evidenceUrl: null,
      publishedAt: null,
      manualBoundary: "只能由获授权人员在复核和批准完成后人工发布。",
    },
    aiDisclosure: {
      assisted: true,
      disclosure: "本草案由 AI 协助结构化，必须由人工复核。",
      humanReviewRequired: true,
      prohibitedUses: ["不得自动作出处分。", "不得把模型推断写成事实。"],
    },
    sourceRefs: ["official-source"],
    sections: [
      {
        heading: "第一部分",
        paragraphs: ["需要转义的 <script>alert('x')</script> 只是文本。"],
        bullets: ["第一项", "第二项"],
        example: { label: "示例", text: "只用于内部说明。" },
      },
      { heading: "第二部分", paragraphs: ["继续使用可观察证据。"] },
      { heading: "第三部分", paragraphs: ["结论仍需人工确认。"] },
    ],
    template: {
      title: "内部练习模板",
      instructions: "只填写最少必要信息。",
      fields: Array.from({ length: 4 }, (_, fieldIndex) => ({
        label: `字段 ${fieldIndex + 1}`,
        guidance: "填写可观察事实。",
        example: "去标识示例。",
      })),
      completionRule: "所有字段和停止条件明确后才可试行。",
    },
    practice: {
      title: "内部练习",
      scenario: "选择一个不包含真实身份的场景。",
      steps: ["记录事实。", "区分推断。", "确定下一动作。"],
      deliverable: "一份内部练习记录。",
      selfCheck: ["是否最小化数据？", "是否避免承诺？", "是否保留停止条件？"],
    },
    reviewQuestions: ["事实依据是什么？", "缺失信息是什么？", "哪些风险尚未关闭？"],
  };
}

function makeFixture(): {
  library: EducationReviewLibrary;
  sourceSnapshot: EducationContentSnapshot;
} {
  const articles = Array.from({ length: 12 }, (_, index) => makeArticle(index));
  return {
    library: {
      datasetId: "fiatlux-choice-esports-education-library",
      title: "FIAT LUX 电竞教育版本化内部内容库",
      status: "internal_draft",
      audience: "中国境内成年电竞学习者",
      scope: "内部审阅，不是招生页面。",
      lastUpdatedAt: "2026-07-20",
      nextReviewAt: "2026-10-20",
      maintenanceOwnerRole: "电竞教育负责人",
      publicationBoundary: "必须完成复核、权利和人工批准后再由获授权人员操作 WordPress。",
      references: [
        {
          id: "official-source",
          kind: "official",
          title: "官方来源",
          authority: "官方机关",
          location: "https://example.gov.cn/source",
          publishedAt: "2026-01-01",
          lastVerifiedAt: "2026-07-20",
          reviewStatus: "pending",
          applicability: "需要由专业人员确定适用性。",
          usageBoundary: "未复核前不能支持确定性结论。",
        },
      ],
      articles,
    },
    sourceSnapshot: {
      files: [
        {
          path: "content/education/foundation-articles.json",
          datasetId: "foundations",
          schemaVersion: "1.0.0",
          sha256: "b".repeat(64),
          bytes: 100,
        },
        {
          path: "content/education/expansion-articles.json",
          datasetId: "expansion",
          schemaVersion: "1.0.0",
          sha256: "c".repeat(64),
          bytes: 200,
        },
      ],
      articles: articles.map((article, index) => ({
        articleId: article.id,
        slug: article.slug,
        title: article.title,
        version: article.version,
        sourceFile:
          index < 4
            ? "content/education/foundation-articles.json"
            : "content/education/expansion-articles.json",
        contentSha256: digest(JSON.stringify(article)),
        sourceRefs: article.sourceRefs,
        verificationMarkers: [
          article.title,
          article.sections[0]?.heading ?? "missing",
          article.template.title,
        ],
      })),
    },
  };
}

describe("education WordPress review bundle", () => {
  it("builds a hash-bound review-only package and blocks every current draft", () => {
    const fixture = makeFixture();
    const bundle = buildEducationWordPressReviewBundle({
      candidateGitSha,
      generatedAt: "2026-07-20T12:00:00.000Z",
      ...fixture,
    });

    expect(bundle.manifest.mode).toBe("review_only");
    expect(bundle.manifest.summary).toEqual({
      articleCount: 12,
      publicationEligibleCount: 0,
      blockedArticleCount: 12,
    });
    expect(bundle.manifest.safety).toMatchObject({
      reviewOnlyMarker: EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER,
      externalPublicationPerformed: false,
      wordpressCredentialsAccepted: false,
      wordpressApiCalled: false,
      publicWebsiteStateVerified: false,
      manualPublicationRequired: true,
    });
    expect(bundle.files).toHaveLength(26);
    expect(bundle.files.at(-1)?.path).toBe("manifest.json");
    expect(bundle.manifest.artifacts).toHaveLength(25);
    expect(bundle.manifest.articles.every(({ publicationEligible }) => !publicationEligible)).toBe(
      true,
    );

    const html = bundle.files.find(({ path }) => path.endsWith(".review.html"));
    expect(html?.content).toContain(EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER);
    expect(html?.content).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html?.content).not.toContain("<script>alert('x')</script>");
    const htmlArtifact = bundle.manifest.artifacts.find(({ path }) => path === html?.path);
    expect(htmlArtifact?.sha256).toBe(digest(html?.content ?? ""));
    expect(htmlArtifact?.bytes).toBe(Buffer.byteLength(html?.content ?? "", "utf8"));
    const reviewSheet = bundle.files.find(({ path }) => path.endsWith(".review.md"));
    expect(reviewSheet?.content).toContain(
      "&lt;script&gt;alert('review')&lt;/script&gt; ## 不能注入标题。",
    );
    expect(reviewSheet?.content).not.toContain("<script>alert('review')</script>");
  });

  it("remains review-only even when structured statuses become publication-eligible", () => {
    const fixture = makeFixture();
    fixture.library.status = "approved";
    firstOrThrow(fixture.library.references, "来源").reviewStatus = "reviewed";
    for (const article of fixture.library.articles) {
      article.review.status = "reviewed";
      article.review.lastReviewedAt = "2026-07-20";
      article.rights.status = "cleared";
      article.rights.evidenceRefs = [`rights:${article.id}`];
      article.publication.status = "approved_for_manual_publication";
    }
    fixture.sourceSnapshot.articles.forEach((snapshot, index) => {
      snapshot.contentSha256 = digest(JSON.stringify(fixture.library.articles[index]));
    });

    const bundle = buildEducationWordPressReviewBundle({
      candidateGitSha,
      generatedAt: "2026-07-20T12:00:00.000Z",
      ...fixture,
    });

    expect(bundle.manifest.summary.publicationEligibleCount).toBe(12);
    expect(bundle.manifest.summary.blockedArticleCount).toBe(0);
    expect(bundle.manifest.mode).toBe("review_only");
    expect(bundle.manifest.safety.externalPublicationPerformed).toBe(false);
    expect(
      bundle.files
        .filter(({ mediaType }) => mediaType === "text/html")
        .every(({ content }) => content.includes(EDUCATION_WORDPRESS_REVIEW_ONLY_MARKER)),
    ).toBe(true);
  });

  it("rejects incomplete candidates, hash drift, missing sources and invalid commit identities", () => {
    const fixture = makeFixture();
    expect(() =>
      buildEducationWordPressReviewBundle({
        candidateGitSha: "abc",
        generatedAt: "2026-07-20T12:00:00.000Z",
        ...fixture,
      }),
    ).toThrow("候选 Git SHA 必须是完整小写 40 位提交");

    const incomplete = makeFixture();
    incomplete.library.articles.pop();
    expect(() =>
      buildEducationWordPressReviewBundle({
        candidateGitSha,
        generatedAt: "2026-07-20T12:00:00.000Z",
        ...incomplete,
      }),
    ).toThrow("合并内容库必须精确包含 12 篇文章");

    const hashDrift = makeFixture();
    firstOrThrow(hashDrift.library.articles, "文章").summary =
      "修改后的摘要必须触发候选内容哈希不一致。";
    expect(() =>
      buildEducationWordPressReviewBundle({
        candidateGitSha,
        generatedAt: "2026-07-20T12:00:00.000Z",
        ...hashDrift,
      }),
    ).toThrow("文章与候选 Git 快照内容哈希不一致");

    const missingSource = makeFixture();
    const missingSourceArticle = firstOrThrow(missingSource.library.articles, "文章");
    missingSourceArticle.sourceRefs = ["missing-source"];
    firstOrThrow(missingSource.sourceSnapshot.articles, "候选快照文章").contentSha256 = digest(
      JSON.stringify(missingSourceArticle),
    );
    expect(() =>
      buildEducationWordPressReviewBundle({
        candidateGitSha,
        generatedAt: "2026-07-20T12:00:00.000Z",
        ...missingSource,
      }),
    ).toThrow("文章引用了不存在的来源");
  });
});
