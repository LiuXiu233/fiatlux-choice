import { describe, expect, it } from "vitest";
import officialSources from "../../../../content/compliance/official-sources.json";
import generatedJsonSchema from "../../../../content/education/education-content.schema.json";
import rawExpansionContent from "../../../../content/education/expansion-articles.json";
import rawFoundationContent from "../../../../content/education/foundation-articles.json";
import {
  educationContent,
  educationContentPackages,
  mergeEducationContentPackages,
} from "./education-content";
import {
  buildEducationContentJsonSchema,
  educationContentSchema,
  parseEducationContent,
} from "./education-content-schema";

const requiredArticleIds = [
  "adult-team-training-pilot-retrospective",
  "coach-actionable-feedback",
  "effective-replay-review",
  "ergonomics-and-rest-self-check",
  "esports-career-probability-cost-and-alternatives",
  "four-week-competitive-training-goal",
  "game-account-device-community-security",
  "minimum-team-voice-protocol",
  "player-to-coach-skill-and-duty-boundary",
  "small-esports-event-risk-register",
  "structured-review-after-a-loss",
  "tournament-registration-to-archive-checkpoints",
];

describe("education content governance", () => {
  it("validates two independent packages and the complete 12-article library", () => {
    const foundation = parseEducationContent(rawFoundationContent);
    const expansion = parseEducationContent(rawExpansionContent);

    expect(foundation.articles).toHaveLength(4);
    expect(expansion.articles).toHaveLength(8);
    expect(educationContentPackages).toHaveLength(2);
    expect(educationContent.articles.map((article) => article.id).sort()).toEqual(
      requiredArticleIds,
    );
    expect(educationContent.references).toHaveLength(10);
    expect(educationContent.datasetId).toBe("fiatlux-choice-esports-education-library");
    expect(educationContent.status).toBe("internal_draft");
    expect(educationContent.audience).toContain("成年");
    expect(educationContent.lastUpdatedAt).toBe("2026-07-20");
    expect(educationContent.nextReviewAt).toBe("2026-10-19");

    for (const article of educationContent.articles) {
      expect(article.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(article.audience).toMatch(/成年|成人/);
      expect(article.review.status).toBe("pending");
      expect(article.review.reviewerRoles.length).toBeGreaterThanOrEqual(2);
      expect(article.rights.status).toBe("pending_clearance");
      expect(article.publication.status).toBe("not_published");
      expect(article.publication.externalStateLabel).toBe("WordPress 未发布");
      expect(article.publication.evidenceUrl).toBeNull();
      expect(article.publication.publishedAt).toBeNull();
      expect(article.aiDisclosure.humanReviewRequired).toBe(true);
      expect(article.sections.length).toBeGreaterThanOrEqual(3);
      expect(article.template.fields.length).toBeGreaterThanOrEqual(4);
      expect(article.practice.steps.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the checked-in JSON Schema synchronized with the executable structure schema", () => {
    expect(generatedJsonSchema).toEqual(buildEducationContentJsonSchema());
  });

  it("anchors every official article reference to matching pending compliance metadata", () => {
    const complianceById = new Map(
      officialSources.sources.map((source) => [source.id, source] as const),
    );

    const officialReferences = educationContent.references.filter(
      ({ kind }) => kind === "official",
    );
    expect(officialReferences).toHaveLength(8);

    for (const reference of officialReferences) {
      const official = complianceById.get(reference.id);
      expect(official, reference.id).toBeDefined();
      expect(reference.title).toBe(official?.title);
      expect(reference.authority).toBe(official?.authority);
      expect(reference.location).toBe(official?.sourceUrl);
      expect(reference.publishedAt).toBe(official?.published);
      expect(reference.lastVerifiedAt).toBe(official?.lastVerifiedAt);
      expect(reference.reviewStatus).toBe(official?.reviewStatus);
      expect(reference.reviewStatus).toBe("pending");
    }

    const healthSource = complianceById.get("cn-health-literacy-2024");
    expect(healthSource?.documentNo).toBe("国卫办宣传函〔2024〕191号");
    expect(healthSource?.lastVerifiedAt).toBe("2026-07-19");
    expect(healthSource?.exclusions).toContain("固定休息分钟数");
  });

  it("keeps the health article non-medical and free of a fixed rest interval", () => {
    const article = educationContent.articles.find(
      ({ id }) => id === "ergonomics-and-rest-self-check",
    );
    expect(article).toBeDefined();
    expect(article?.nonPromises.join(" ")).toContain("不是医疗建议");
    expect(article?.nonPromises.join(" ")).toContain("不提供适用于所有人的固定休息分钟数");
    expect(article?.safetyNotes.join(" ")).toContain("120");

    const instructionalBody = JSON.stringify({
      sections: article?.sections,
      template: article?.template,
      practice: article?.practice,
    });
    expect(instructionalBody).not.toMatch(/每隔?\s*\d+\s*分钟|每\s*\d+\s*分钟/);
  });

  it("fails closed for unknown sources, false publication claims, or package conflicts", () => {
    const unknownReference = structuredClone(rawFoundationContent);
    unknownReference.articles[0]?.sourceRefs.push("missing-official-source");
    expect(educationContentSchema.safeParse(unknownReference).success).toBe(false);

    const fakePublication = structuredClone(rawFoundationContent) as {
      articles: Array<{
        publication: {
          status: string;
          evidenceUrl: string | null;
          publishedAt: string | null;
        };
      }>;
    };
    if (fakePublication.articles[0]) {
      fakePublication.articles[0].publication.status = "published_with_evidence";
      fakePublication.articles[0].publication.evidenceUrl = "https://fiatlux.gg/fake";
      fakePublication.articles[0].publication.publishedAt = "2026-07-19";
    }
    expect(educationContentSchema.safeParse(fakePublication).success).toBe(false);

    const conflictingReference = structuredClone(rawExpansionContent);
    const sharedReference = conflictingReference.references.find(
      ({ id }) => id === "cn-advertising-law-2021",
    );
    if (sharedReference) {
      sharedReference.title = "冲突的来源标题";
    }
    expect(() =>
      mergeEducationContentPackages([rawFoundationContent, conflictingReference]),
    ).toThrow("电竞教育来源元数据冲突：cn-advertising-law-2021");

    const duplicatedArticle = structuredClone(rawExpansionContent);
    if (duplicatedArticle.articles[0]) {
      duplicatedArticle.articles[0].id = "four-week-competitive-training-goal";
    }
    expect(() => mergeEducationContentPackages([rawFoundationContent, duplicatedArticle])).toThrow(
      "电竞教育文章由多个内容包重复声明：four-week-competitive-training-goal",
    );

    const mismatchedSchemaVersion = structuredClone(rawExpansionContent);
    mismatchedSchemaVersion.schemaVersion = "2.0.0";
    expect(() =>
      mergeEducationContentPackages([rawFoundationContent, mismatchedSchemaVersion]),
    ).toThrow("电竞教育内容包结构版本不一致");
  });
});
