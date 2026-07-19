import { describe, expect, it } from "vitest";

import { amountCentsToYuan } from "./external-actions-panel";

describe("amountCentsToYuan", () => {
  it("normalizes bigint values serialized by the resource API", () => {
    expect(amountCentsToYuan("500000")).toBe("5000");
    expect(amountCentsToYuan(12345)).toBe("123.45");
  });

  it("fails closed for missing, fractional, or unsafe minor-unit values", () => {
    expect(amountCentsToYuan(undefined)).toBe("");
    expect(amountCentsToYuan("12.5")).toBe("");
    expect(amountCentsToYuan(Number.MAX_SAFE_INTEGER + 1)).toBe("");
  });
});
