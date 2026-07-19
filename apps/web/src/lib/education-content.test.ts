import { describe, expect, it } from "vitest";
import officialSources from "../../../../content/compliance/official-sources.json";
import generatedJsonSchema from "../../../../content/education/education-content.schema.json";
import rawEducationContent from "../../../../content/education/foundation-articles.json";
import {
  buildEducationContentJsonSchema,
  educationContentSchema,
  parseEducationContent,
} from "./education-content-schema";

const requiredFoundationIds = [
  "effective-replay-review",
  "ergonomics-and-rest-self-check",
  "four-week-competitive-training-goal",
  "minimum-team-voice-protocol",
];

describe("education content governance", () => {
  it("validates the four complete versioned foundation articles", () => {
    const document = parseEducationContent(rawEducationContent);

    expect(document.articles.map((article) => article.id).sort()).toEqual(requiredFoundationIds);
    expect(document.status).toBe("internal_draft");
    expect(document.audience).toContain("成年");
    for (const article of document.articles) {
      expect(article.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(article.audience).toContain("成年");
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
    const document = parseEducationContent(rawEducationContent);
    const complianceById = new Map(
      officialSources.sources.map((source) => [source.id, source] as const),
    );

    for (const reference of document.references.filter(({ kind }) => kind === "official")) {
      const official = complianceById.get(reference.id);
      expect(official, reference.id).toBeDefined();
      expect(reference.title).toBe(official?.title);
      expect(reference.authority).toBe(official?.authority);
      expect(reference.location).toBe(official?.sourceUrl);
      expect(reference.publishedAt).toBe(official?.published);
      expect(reference.reviewStatus).toBe(official?.reviewStatus);
      expect(reference.reviewStatus).toBe("pending");
    }

    const healthSource = complianceById.get("cn-health-literacy-2024");
    expect(healthSource?.documentNo).toBe("国卫办宣传函〔2024〕191号");
    expect(healthSource?.lastVerifiedAt).toBe("2026-07-19");
    expect(healthSource?.exclusions).toContain("固定休息分钟数");
  });

  it("keeps the health article non-medical and free of a fixed rest interval", () => {
    const document = parseEducationContent(rawEducationContent);
    const article = document.articles.find(({ id }) => id === "ergonomics-and-rest-self-check");
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

  it("fails closed for unknown sources or unsupported external publication claims", () => {
    const unknownReference = structuredClone(rawEducationContent);
    unknownReference.articles[0]?.sourceRefs.push("missing-official-source");
    expect(educationContentSchema.safeParse(unknownReference).success).toBe(false);

    const fakePublication = structuredClone(rawEducationContent) as {
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
  });
});
