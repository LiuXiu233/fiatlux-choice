import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPLIANCE_MONITOR_SPREAD_DAYS,
  scheduleInitialComplianceMonitorAt,
} from "../src/seed.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

describe("initial compliance monitoring schedule", () => {
  it("spreads a fresh catalog over seven stable daily buckets", () => {
    const startedAt = new Date("2026-07-20T02:00:00.000Z");

    expect(INITIAL_COMPLIANCE_MONITOR_SPREAD_DAYS).toBe(7);
    expect(scheduleInitialComplianceMonitorAt(startedAt, 0, 30)).toEqual(startedAt);
    expect(scheduleInitialComplianceMonitorAt(startedAt, 6, 30)).toEqual(
      new Date(startedAt.getTime() + 6 * ONE_DAY_MS),
    );
    expect(scheduleInitialComplianceMonitorAt(startedAt, 7, 30)).toEqual(startedAt);
  });

  it("never schedules an initial check outside a shorter cadence", () => {
    const startedAt = new Date("2026-07-20T02:00:00.000Z");

    expect(scheduleInitialComplianceMonitorAt(startedAt, 5, 3)).toEqual(
      new Date(startedAt.getTime() + 2 * ONE_DAY_MS),
    );
    expect(scheduleInitialComplianceMonitorAt(startedAt, 99, 1)).toEqual(startedAt);
  });

  it("keeps the current 73-source catalog below the default daily capacity", () => {
    const document = JSON.parse(
      readFileSync(
        new URL("../../../content/compliance/official-sources.json", import.meta.url),
        "utf8",
      ),
    ) as { sources: unknown[] };
    const startedAt = new Date("2026-07-20T02:00:00.000Z");
    const bucketCounts = new Map<number, number>();

    expect(document.sources).toHaveLength(73);
    for (const [index] of document.sources.entries()) {
      const scheduledAt = scheduleInitialComplianceMonitorAt(startedAt, index, 7);
      const bucket = (scheduledAt.getTime() - startedAt.getTime()) / ONE_DAY_MS;
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }

    expect(bucketCounts.size).toBe(7);
    expect(Math.max(...bucketCounts.values())).toBe(11);
    expect(Math.max(...bucketCounts.values())).toBeLessThanOrEqual(12);
  });

  it("rejects invalid scheduling inputs", () => {
    const startedAt = new Date("2026-07-20T02:00:00.000Z");

    expect(() => scheduleInitialComplianceMonitorAt(new Date("invalid"), 0, 7)).toThrow(
      /valid date/,
    );
    expect(() => scheduleInitialComplianceMonitorAt(startedAt, -1, 7)).toThrow(/non-negative/);
    expect(() => scheduleInitialComplianceMonitorAt(startedAt, 0, 0)).toThrow(/positive/);
  });
});
