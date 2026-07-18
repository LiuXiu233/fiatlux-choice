import { describe, expect, it } from "vitest";

import {
  advisorOutputSchema,
  changePasswordSchema,
  dateOrDateTimeSchema,
  dateTimeSchema,
  externalActionCreateSchema,
  listQuerySchema,
  updateSchemaFor,
} from "../src/index.js";

describe("HTTP contracts", () => {
  it("normalizes pagination", () => {
    expect(listQuerySchema.parse({ page: "2", pageSize: "25" })).toMatchObject({
      page: 2,
      pageSize: 25,
    });
  });

  it("normalizes browser-local Chinese dates before PostgreSQL storage", () => {
    expect(dateTimeSchema.parse("2026-07-18T14:30")).toBe("2026-07-18T14:30:00+08:00");
    expect(dateOrDateTimeSchema.parse("2026-07-18")).toBe("2026-07-18T00:00:00+08:00");
  });

  it("requires optimistic concurrency on updates", () => {
    expect(() => updateSchemaFor("tasks").parse({ title: "changed" })).toThrow();
  });

  it("requires a distinct password with at least 14 characters", () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: "current-password", newPassword: "too-short" }),
    ).toThrow();
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: "same-password-long-enough",
        newPassword: "same-password-long-enough",
      }),
    ).toThrow(/differ/);
  });

  it("rejects unsupported external action kinds", () => {
    expect(() =>
      externalActionCreateSchema.parse({
        kind: "pretend_payment",
        adapter: "real",
        payload: {},
        idempotencyKey: "abcdefgh",
        reason: "test",
      }),
    ).toThrow();
  });

  it("requires evidence for stated facts", () => {
    expect(() =>
      advisorOutputSchema.parse({
        facts: [{ claim: "Revenue grew", evidence: [] }],
        inferences: [],
        recommendations: [],
        risks: [],
        missingInformation: [],
        confidence: 0.5,
        disclaimer: "Decision support only",
      }),
    ).toThrow();
  });
});
