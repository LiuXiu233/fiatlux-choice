import { describe, expect, it } from "vitest";

import {
  complianceItemCreateSchema,
  complianceMonitorRequestSchema,
  complianceProfessionalReviewSchema,
} from "../src/index.js";

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

  it("requires identifiable evidence-backed professional review inputs", () => {
    const parsed = complianceProfessionalReviewSchema.parse({
      expectedVersion: 2,
      reviewOutcome: "applicable",
      resultingStatus: "active",
      reviewerName: "张复核",
      reviewerRole: "公司治理法律顾问",
      reviewerOrganization: "示例法律服务机构",
      reviewerQualification: "基于公司治理与商事合规执业经验进行适用性复核",
      evidenceFileId: "00000000-0000-4000-8000-000000000001",
      applicability: "适用于耀光现行公司治理、股东会和执行董事记录维护。",
      summary: "已核对官方现行文本、施行日期及公司当前治理事实。",
      missingInformation: "暂无已知缺失信息；章程变化后需要重新复核。",
      nextReviewAt: "2027-01-20",
      reason: "登记可追溯专业意见，供后续义务和顾问上下文使用。",
    });
    expect(parsed).toMatchObject({
      reviewOutcome: "applicable",
      resultingStatus: "active",
      nextReviewAt: "2027-01-20T00:00:00+08:00",
    });
  });

  it("keeps unresolved professional reviews uncertain", () => {
    const base = {
      expectedVersion: 1,
      reviewerName: "外部复核人",
      reviewerRole: "数据合规顾问",
      reviewerOrganization: "示例数据合规机构",
      reviewerQualification: "具备个人信息保护与数据合规项目复核经验",
      evidenceFileId: "00000000-0000-4000-8000-000000000001",
      applicability: "仍缺少实际个人信息字段和保存期限清单。",
      summary: "当前信息不足，不能形成确定适用结论。",
      missingInformation: "仍缺少实际个人信息字段、处理目的和保存期限清单。",
      nextReviewAt: "2026-10-20",
      reason: "保留缺失信息并明确下一次复核安排。",
    };
    expect(() =>
      complianceProfessionalReviewSchema.parse({
        ...base,
        reviewOutcome: "insufficient_information",
        resultingStatus: "active",
      }),
    ).toThrow(/uncertain/);
    expect(() =>
      complianceProfessionalReviewSchema.parse({
        ...base,
        reviewOutcome: "applicable",
        resultingStatus: "uncertain",
      }),
    ).toThrow(/lifecycle/);
  });
});
