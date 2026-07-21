import { describe, expect, it } from "vitest";

import { getResourceConfig } from "./resources";

describe("compliance source monitoring UI configuration", () => {
  it("shows machine freshness separately from human review and exposes maintainable cadence", () => {
    const config = getResourceConfig("compliance-items");
    expect(config?.columns.map((column) => column.key)).toEqual(
      expect.arrayContaining([
        "reviewStatus",
        "nextReviewAt",
        "contentHashStatus",
        "nextMonitorAt",
      ]),
    );
    expect(
      Object.fromEntries(config?.fields.map((field) => [field.key, field]) ?? []),
    ).toMatchObject({
      nextReviewAt: { kind: "date", label: "计划专业复核截止" },
      monitoringCadenceDays: { kind: "number", defaultValue: "30" },
    });
  });
});
