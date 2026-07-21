import { describe, expect, it } from "vitest";

import { startOfChinaCalendarDay } from "../../src/handlers.js";

describe("China compliance calendar boundary", () => {
  it("keeps today's date active until the next Shanghai calendar day", () => {
    const beforeShanghaiMidnight = new Date("2026-07-19T15:59:59.999Z");
    const afterShanghaiMidnight = new Date("2026-07-19T16:00:00.000Z");
    expect(startOfChinaCalendarDay(beforeShanghaiMidnight).toISOString()).toBe(
      "2026-07-18T16:00:00.000Z",
    );
    expect(startOfChinaCalendarDay(afterShanghaiMidnight).toISOString()).toBe(
      "2026-07-19T16:00:00.000Z",
    );
  });
});
