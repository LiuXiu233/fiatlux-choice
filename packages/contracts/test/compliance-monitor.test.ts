import { describe, expect, it } from "vitest";

import { complianceItemCreateSchema, complianceMonitorRequestSchema } from "../src/index.js";

describe("compliance monitoring contracts", () => {
  it("accepts maintainable review and monitoring metadata with conservative defaults", () => {
    const parsed = complianceItemCreateSchema.parse({
      title: "中华人民共和国公司法",
      category: "company_governance",
      issuingAuthority: "全国人民代表大会常务委员会",
      sourceUrl: "https://flk.npc.gov.cn/detail?id=official",
      nextReviewAt: "2027-01-18",
    });

    expect(parsed).toMatchObject({
      contentHashStatus: "pending_fetch",
      monitoringCadenceDays: 30,
      nextReviewAt: "2027-01-18T00:00:00+08:00",
    });
  });

  it("constrains manual monitoring reasons and generated status values", () => {
    expect(complianceMonitorRequestSchema.parse({ reason: "  人工复核前检查  " })).toEqual({
      reason: "人工复核前检查",
    });
    expect(() => complianceMonitorRequestSchema.parse({ reason: "" })).toThrow();
    expect(() =>
      complianceItemCreateSchema.parse({
        title: "来源",
        category: "tax",
        issuingAuthority: "机关",
        sourceUrl: "https://www.gov.cn/policy",
        contentHashStatus: "verified_without_fetch",
      }),
    ).toThrow();
  });
});
