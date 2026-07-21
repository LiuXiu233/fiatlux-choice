import { z } from "zod";

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "必须使用 YYYY-MM-DD 日期");
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "必须使用语义化版本号");
const identifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "必须使用小写短横线标识符");
const governedTextSchema = z.string().trim().min(2).max(4_000);

export const educationReferenceSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(["official", "internal"]),
    title: z.string().trim().min(2).max(300),
    authority: z.string().trim().min(2).max(200),
    location: z.string().trim().min(3).max(2_000),
    publishedAt: localDateSchema.nullable(),
    lastVerifiedAt: localDateSchema,
    reviewStatus: z.enum(["draft", "pending", "reviewed"]),
    applicability: governedTextSchema,
    usageBoundary: governedTextSchema,
  })
  .strict();

const articleReviewSchema = z
  .object({
    status: z.enum(["pending", "in_review", "changes_requested", "reviewed"]),
    ownerRole: z.string().trim().min(2).max(100),
    reviewerRoles: z.array(z.string().trim().min(2).max(100)).min(2),
    lastReviewedAt: localDateSchema.nullable(),
    nextReviewAt: localDateSchema,
    note: governedTextSchema,
  })
  .strict();

const articleRightsSchema = z
  .object({
    status: z.enum(["pending_clearance", "cleared", "restricted"]),
    basis: governedTextSchema,
    evidenceRefs: z.array(z.string().trim().min(1).max(300)),
  })
  .strict();

const articlePublicationSchema = z
  .object({
    status: z.enum(["not_published", "approved_for_manual_publication", "published_with_evidence"]),
    targetChannel: z.enum(["fiatlux_gg_wordpress"]),
    externalStateLabel: z.string().trim().min(2).max(100),
    evidenceUrl: z.string().url().nullable(),
    publishedAt: localDateSchema.nullable(),
    manualBoundary: governedTextSchema,
  })
  .strict();

const articleAiDisclosureSchema = z
  .object({
    assisted: z.literal(true),
    disclosure: governedTextSchema,
    humanReviewRequired: z.literal(true),
    prohibitedUses: z.array(governedTextSchema).min(2),
  })
  .strict();

const articleSectionSchema = z
  .object({
    heading: z.string().trim().min(2).max(160),
    paragraphs: z.array(governedTextSchema).min(1),
    bullets: z.array(governedTextSchema).optional(),
    example: z
      .object({
        label: z.string().trim().min(2).max(100),
        text: governedTextSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const articleTemplateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    instructions: governedTextSchema,
    fields: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(100),
            guidance: governedTextSchema,
            example: governedTextSchema,
          })
          .strict(),
      )
      .min(4),
    completionRule: governedTextSchema,
  })
  .strict();

const articlePracticeSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    scenario: governedTextSchema,
    steps: z.array(governedTextSchema).min(3),
    deliverable: governedTextSchema,
    selfCheck: z.array(governedTextSchema).min(3),
  })
  .strict();

export const educationArticleSchema = z
  .object({
    id: identifierSchema,
    slug: identifierSchema,
    title: z.string().trim().min(4).max(160),
    summary: z.string().trim().min(20).max(500),
    version: semverSchema,
    audience: z.string().trim().min(4).max(200),
    applicability: z.array(governedTextSchema).min(2),
    nonPromises: z.array(governedTextSchema).min(4),
    safetyNotes: z.array(governedTextSchema).min(2),
    learningObjectives: z.array(governedTextSchema).min(2),
    review: articleReviewSchema,
    rights: articleRightsSchema,
    publication: articlePublicationSchema,
    aiDisclosure: articleAiDisclosureSchema,
    sourceRefs: z.array(identifierSchema).min(1),
    sections: z.array(articleSectionSchema).min(3),
    template: articleTemplateSchema,
    practice: articlePracticeSchema,
    reviewQuestions: z.array(governedTextSchema).min(3),
  })
  .strict();

export const educationContentStructureSchema = z
  .object({
    $schema: z.string().trim().min(3).max(500),
    schemaVersion: semverSchema,
    datasetId: identifierSchema,
    title: z.string().trim().min(4).max(200),
    status: z.enum(["internal_draft", "in_review", "approved"]),
    audience: z.string().trim().min(4).max(200),
    scope: governedTextSchema,
    lastUpdatedAt: localDateSchema,
    nextReviewAt: localDateSchema,
    maintenanceOwnerRole: z.string().trim().min(2).max(100),
    publicationBoundary: governedTextSchema,
    references: z.array(educationReferenceSchema).min(1),
    articles: z.array(educationArticleSchema).min(4),
  })
  .strict();

export const educationContentSchema = educationContentStructureSchema.superRefine(
  (document, context) => {
    const referenceIds = new Set<string>();
    for (const [index, reference] of document.references.entries()) {
      if (referenceIds.has(reference.id)) {
        context.addIssue({
          code: "custom",
          path: ["references", index, "id"],
          message: `来源标识重复：${reference.id}`,
        });
      }
      referenceIds.add(reference.id);
      if (reference.kind === "official" && !reference.location.startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: ["references", index, "location"],
          message: "官方来源必须使用 HTTPS 链接",
        });
      }
      if (reference.kind === "internal" && !reference.location.startsWith("docs/")) {
        context.addIssue({
          code: "custom",
          path: ["references", index, "location"],
          message: "内部来源必须指向版本库 docs/ 路径",
        });
      }
    }

    const articleIds = new Set<string>();
    const slugs = new Set<string>();
    for (const [index, article] of document.articles.entries()) {
      if (articleIds.has(article.id)) {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "id"],
          message: `文章标识重复：${article.id}`,
        });
      }
      if (slugs.has(article.slug)) {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "slug"],
          message: `文章 slug 重复：${article.slug}`,
        });
      }
      articleIds.add(article.id);
      slugs.add(article.slug);

      for (const [sourceIndex, sourceRef] of article.sourceRefs.entries()) {
        if (!referenceIds.has(sourceRef)) {
          context.addIssue({
            code: "custom",
            path: ["articles", index, "sourceRefs", sourceIndex],
            message: `文章引用了不存在的来源：${sourceRef}`,
          });
        }
      }

      const publicationReady =
        article.review.status === "reviewed" && article.rights.status === "cleared";
      if (!publicationReady && article.publication.status !== "not_published") {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "publication", "status"],
          message: "未完成人工复核和权利确认的文章只能标记为未发布",
        });
      }
      if (
        article.publication.status === "published_with_evidence" &&
        (!article.publication.evidenceUrl || !article.publication.publishedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "publication"],
          message: "对外已发布状态必须同时提供外部 URL 和发布日期证据",
        });
      }
      if (
        article.publication.status !== "published_with_evidence" &&
        (article.publication.evidenceUrl || article.publication.publishedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "publication"],
          message: "未发布状态不得预填外部发布证据",
        });
      }
      if (article.review.nextReviewAt < document.lastUpdatedAt) {
        context.addIssue({
          code: "custom",
          path: ["articles", index, "review", "nextReviewAt"],
          message: "文章下次复核日不得早于数据集更新时间",
        });
      }
    }
  },
);

export type EducationContent = z.infer<typeof educationContentSchema>;
export type EducationArticle = EducationContent["articles"][number];

export function parseEducationContent(input: unknown): EducationContent {
  return educationContentSchema.parse(input);
}

export function buildEducationContentJsonSchema(): Record<string, unknown> {
  const generated = JSON.parse(
    JSON.stringify(
      z.toJSONSchema(educationContentStructureSchema, {
        target: "draft-2020-12",
        io: "input",
        reused: "ref",
      }),
    ),
  ) as Record<string, unknown>;
  return {
    ...generated,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://fiatlux.gg/schemas/education-content.schema.json",
    title: "FIAT LUX 电竞教育内容包",
    description:
      "版本化电竞教育文章、人工复核、素材权利、发布边界、来源、AI 披露、练习与模板的结构约束；跨记录语义约束由 TypeScript 校验器补充执行。",
  };
}
