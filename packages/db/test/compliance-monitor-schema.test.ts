import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { complianceItems, complianceSourceSnapshots } from "../src/schema.js";

describe("compliance monitoring database invariants", () => {
  it("persists source freshness, review schedule and failure state", () => {
    expect(getTableColumns(complianceItems)).toEqual(
      expect.objectContaining({
        contentHashStatus: expect.anything(),
        nextReviewAt: expect.anything(),
        nextMonitorAt: expect.anything(),
        lastCheckedAt: expect.anything(),
        lastFetchedAt: expect.anything(),
        rawSnapshotHash: expect.anything(),
        monitoringFailureCount: expect.anything(),
        lastMonitoringError: expect.anything(),
        monitoringLeaseToken: expect.anything(),
        monitoringLeaseUntil: expect.anything(),
        monitoringJobId: expect.anything(),
      }),
    );
    const config = getTableConfig(complianceItems);
    expect(
      config.indexes.some((index) =>
        index.config.columns.some(
          (column) => "name" in column && column.name === "next_monitor_at",
        ),
      ),
    ).toBe(true);
  });

  it("keeps append-only snapshot evidence organization scoped and source linked", () => {
    const columns = getTableColumns(complianceSourceSnapshots);
    expect(columns.orgId.notNull).toBe(true);
    expect(columns.sourceId.notNull).toBe(true);
    expect(columns.rawHash).toBeDefined();
    expect(columns.normalizedHash).toBeDefined();
    expect(columns.previousContentHash).toBeDefined();
    expect(columns.normalizedExcerpt).toBeDefined();
    const config = getTableConfig(complianceSourceSnapshots);
    expect(
      config.foreignKeys.some(
        (foreignKey) => foreignKey.reference().foreignTable === complianceItems,
      ),
    ).toBe(true);
  });
});
