import rawExpansionContent from "../../../../content/education/expansion-articles.json";
import rawFoundationContent from "../../../../content/education/foundation-articles.json";
import { type EducationContent, parseEducationContent } from "./education-content-schema";

type EducationReference = EducationContent["references"][number];
type EducationArticle = EducationContent["articles"][number];

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Builds the governed in-app library from independently maintained content packages.
 * Each package must be valid by itself. Shared references may be reused only when their
 * complete governed metadata matches; article ownership must remain unique to one package.
 */
export function mergeEducationContentPackages(inputs: readonly unknown[]): EducationContent {
  const packages = inputs.map((input) => parseEducationContent(input));
  const [firstPackage, ...remainingPackages] = packages;
  if (!firstPackage) {
    throw new Error("电竞教育内容库至少需要一个有效内容包");
  }

  for (const contentPackage of remainingPackages) {
    if (contentPackage.$schema !== firstPackage.$schema) {
      throw new Error(`电竞教育内容包 JSON Schema 不一致：${contentPackage.datasetId}`);
    }
    if (contentPackage.schemaVersion !== firstPackage.schemaVersion) {
      throw new Error(`电竞教育内容包结构版本不一致：${contentPackage.datasetId}`);
    }
  }

  const referencesById = new Map<string, EducationReference>();
  const articles: EducationArticle[] = [];
  const articleIds = new Set<string>();
  const articleSlugs = new Set<string>();

  for (const contentPackage of packages) {
    for (const reference of contentPackage.references) {
      const existing = referencesById.get(reference.id);
      if (existing && !valuesMatch(existing, reference)) {
        throw new Error(`电竞教育来源元数据冲突：${reference.id}`);
      }
      referencesById.set(reference.id, existing ?? reference);
    }

    for (const article of contentPackage.articles) {
      if (articleIds.has(article.id)) {
        throw new Error(`电竞教育文章由多个内容包重复声明：${article.id}`);
      }
      if (articleSlugs.has(article.slug)) {
        throw new Error(`电竞教育文章 slug 由多个内容包重复声明：${article.slug}`);
      }
      articleIds.add(article.id);
      articleSlugs.add(article.slug);
      articles.push(article);
    }
  }

  const lastUpdatedAt = packages.reduce(
    (latest, contentPackage) =>
      contentPackage.lastUpdatedAt > latest ? contentPackage.lastUpdatedAt : latest,
    firstPackage.lastUpdatedAt,
  );
  const nextReviewAt = packages.reduce(
    (earliest, contentPackage) =>
      contentPackage.nextReviewAt < earliest ? contentPackage.nextReviewAt : earliest,
    firstPackage.nextReviewAt,
  );
  const status = packages.some(({ status: packageStatus }) => packageStatus === "internal_draft")
    ? "internal_draft"
    : packages.some(({ status: packageStatus }) => packageStatus === "in_review")
      ? "in_review"
      : "approved";

  return parseEducationContent({
    $schema: firstPackage.$schema,
    schemaVersion: firstPackage.schemaVersion,
    datasetId: "fiatlux-choice-esports-education-library",
    title: "FIAT LUX 电竞教育版本化内部内容库",
    status,
    audience: "中国境内成年电竞学习者、教练、赛事执行者与小型团队",
    scope: `${articles.length} 篇与具体游戏无关的版本化教学文章，用于成人小班内部试讲、内容复核和低人力持续运营；不是公开招生页面、学员门户或专业意见。`,
    lastUpdatedAt,
    nextReviewAt,
    maintenanceOwnerRole: "电竞教育负责人",
    publicationBoundary:
      "内容包合并、站内可读或自动化测试通过均不代表已对外发布。每篇文章只有在业务、教练、法务合规、隐私、健康内容和素材权利完成适用复核后，才可由获授权人员在 WordPress 人工发布并回填真实 URL、日期和证据。",
    references: [...referencesById.values()],
    articles,
  });
}

export const educationContentPackages = [
  parseEducationContent(rawFoundationContent),
  parseEducationContent(rawExpansionContent),
] as const;

export const educationContent = mergeEducationContentPackages(educationContentPackages);
