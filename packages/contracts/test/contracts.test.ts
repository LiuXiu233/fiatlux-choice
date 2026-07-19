import { describe, expect, it } from "vitest";

import {
  advisorOutputSchema,
  approvalRequestSchema,
  changePasswordSchema,
  complianceMonitoringStatusSchema,
  dateOrDateTimeSchema,
  dateTimeSchema,
  decisionCreateSchema,
  externalActionCreateSchema,
  fileCreateSchema,
  listQuerySchema,
  membershipLifecycleApprovalPayloadSchema,
  membershipLifecycleRequestSchema,
  moneyCentsSchema,
  notificationCreateSchema,
  opportunityCreateSchema,
  productCreateSchema,
  roleAssignmentApprovalPayloadSchema,
  roleAssignmentRequestSchema,
  updateSchemaFor,
  workflowDefinitionCreateSchema,
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

  it("rejects impossible China-local dates and out-of-range local times", () => {
    for (const value of ["2026-02-30T12:00", "2026-07-19T25:61", "2026-02-30", "2026-13-01"]) {
      const schema = value.includes("T") ? dateTimeSchema : dateOrDateTimeSchema;
      expect(schema.safeParse(value).success, value).toBe(false);
    }
    expect(dateOrDateTimeSchema.parse("2028-02-29")).toBe("2028-02-29T00:00:00+08:00");
  });

  it("keeps money within JavaScript's exact integer range", () => {
    expect(moneyCentsSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(moneyCentsSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(moneyCentsSchema.safeParse(1e20).success).toBe(false);
  });

  it("validates compliance monitoring status without overstating dispatched work", () => {
    const status = {
      generatedAt: "2026-07-20T00:00:00+08:00",
      sourceCount: 73,
      dueAvailableCount: 61,
      inFlightCount: 12,
      pendingFetchCount: 73,
      failedCount: 0,
      changedCount: 0,
      staleReviewCount: 0,
      overdueReviewCount: 0,
      oldestDueAt: "2026-07-19T00:00:00+08:00",
      nextFutureMonitorAt: null,
      latestDispatch: {
        occurredAt: "2026-07-20T02:30:00+08:00",
        batchLimit: 12,
        dueCount: 12,
        queuedCount: 12,
        hasMoreDue: true,
      },
    };

    expect(complianceMonitoringStatusSchema.parse(status)).toMatchObject(status);
    expect(
      complianceMonitoringStatusSchema.safeParse({
        ...status,
        latestDispatch: { ...status.latestDispatch, queuedCount: 13 },
      }).success,
    ).toBe(false);
  });

  it("requires optimistic concurrency on updates", () => {
    expect(() => updateSchemaFor("tasks").parse({ title: "changed" })).toThrow();
  });

  it("allows nullable optional database fields to be cleared without weakening required fields", () => {
    expect(
      updateSchemaFor("objectives").parse({
        description: null,
        ownerId: null,
        dueAt: null,
        expectedVersion: 2,
      }),
    ).toMatchObject({ description: null, ownerId: null, dueAt: null, expectedVersion: 2 });
    expect(() =>
      updateSchemaFor("objectives").parse({ title: null, expectedVersion: 2 }),
    ).toThrow();
  });

  it("accepts typed core-business references and rejects malformed identifiers", () => {
    const objectiveId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const taskId = "33333333-3333-4333-8333-333333333333";
    const productId = "44444444-4444-4444-8444-444444444444";

    expect(
      decisionCreateSchema.parse({
        objectiveId,
        projectId,
        taskId,
        title: "Go/no-go",
        context: "Evidence review",
      }),
    ).toMatchObject({ objectiveId, projectId, taskId });
    expect(productCreateSchema.parse({ projectId, name: "Education product" })).toMatchObject({
      projectId,
    });
    expect(
      opportunityCreateSchema.parse({ productId, projectId, title: "School pilot" }),
    ).toMatchObject({ productId, projectId });

    expect(() =>
      decisionCreateSchema.parse({ title: "Invalid", context: "Invalid", taskId: "not-a-uuid" }),
    ).toThrow();
    expect(() => productCreateSchema.parse({ name: "Invalid", projectId: "not-a-uuid" })).toThrow();
    expect(() =>
      opportunityCreateSchema.parse({ title: "Invalid", productId: "not-a-uuid" }),
    ).toThrow();
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

  it("types membership lifecycle requests and their approval payloads", () => {
    const membershipId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    expect(
      membershipLifecycleRequestSchema.parse({
        action: "offboard",
        reason: "Employment ended after documented handover",
        expectedVersion: 3,
        idempotencyKey: "offboard-request-001",
      }),
    ).toMatchObject({ action: "offboard", expectedVersion: 3 });
    expect(
      membershipLifecycleApprovalPayloadSchema.parse({
        action: "reactivate",
        membershipId,
        userId,
        expectedVersion: 2,
        idempotencyKey: "deactivate-request-001",
      }),
    ).toMatchObject({ action: "reactivate", membershipId, userId });

    expect(() =>
      membershipLifecycleRequestSchema.parse({
        action: "delete",
        reason: "Bypass",
        expectedVersion: 0,
        idempotencyKey: "short",
      }),
    ).toThrow();
  });

  it("requires versioned and idempotent role assignment requests", () => {
    const input = {
      membershipId: "11111111-1111-4111-8111-111111111111",
      roleId: "22222222-2222-4222-8222-222222222222",
      mode: "assign" as const,
      reason: "Least privilege review",
      expectedVersion: 3,
      idempotencyKey: "role-request-001",
    };
    expect(roleAssignmentRequestSchema.parse(input)).toEqual(input);
    expect(roleAssignmentApprovalPayloadSchema.parse(input)).toMatchObject({
      membershipId: input.membershipId,
      roleId: input.roleId,
      expectedVersion: 3,
    });
    expect(() =>
      roleAssignmentRequestSchema.parse({ ...input, expectedVersion: 0, idempotencyKey: "short" }),
    ).toThrow();
  });

  it("rejects workflow steps that cannot execute and defaults valid notifications safely", () => {
    const recipientId = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      workflowDefinitionCreateSchema.parse({
        name: "Broken notification",
        trigger: "manual",
        steps: [{ type: "notify", config: {} }],
      }),
    ).toThrow();
    expect(
      workflowDefinitionCreateSchema.parse({
        name: "Review reminder",
        trigger: "manual",
        steps: [
          {
            type: "notify",
            config: { recipientId, title: "Review", body: "Please review" },
          },
        ],
      }).steps[0],
    ).toEqual({
      type: "notify",
      config: {
        recipientId,
        title: "Review",
        body: "Please review",
        channel: "in_app",
        status: "queued",
      },
    });
  });

  it("only allows notification creation in the queued state", () => {
    const input = {
      recipientId: "11111111-1111-4111-8111-111111111111",
      title: "Review",
      body: "Please review",
    };
    expect(notificationCreateSchema.parse(input)).toMatchObject({ status: "queued" });
    for (const status of ["sent", "failed", "read"]) {
      expect(notificationCreateSchema.safeParse({ ...input, status }).success, status).toBe(false);
    }
  });

  it("rejects empty files as evidence placeholders", () => {
    expect(
      fileCreateSchema.safeParse({
        filename: "empty.pdf",
        contentType: "application/pdf",
        sizeBytes: 0,
        checksumSha256: "0".repeat(64),
        classification: "internal",
      }).success,
    ).toBe(false);
  });

  it("allows common non-macro business files with matching declared MIME types", () => {
    const allowed = [
      ["合同.PDF", "application/pdf"],
      ["课程说明.txt", "text/plain"],
      ["现金流.csv", "text/csv"],
      ["课程大纲.md", "text/markdown"],
      ["证据.json", "application/json"],
      ["发票.jpg", "image/jpeg"],
      ["截图.png", "image/png"],
      ["服务合同.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["现金预测.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      [
        "课程方案.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
    ] as const;
    for (const [filename, contentType] of allowed) {
      expect(
        fileCreateSchema.safeParse({
          filename,
          contentType,
          sizeBytes: 1,
          checksumSha256: "0".repeat(64),
        }).success,
        `${filename} ${contentType}`,
      ).toBe(true);
    }
  });

  it("rejects active content, macros, executable/double extensions and MIME mismatches", () => {
    const rejected = [
      ["invoice.html", "text/html"],
      ["logo.svg", "image/svg+xml"],
      ["payload.js", "text/javascript"],
      ["run.exe", "application/octet-stream"],
      ["contract.docm", "application/vnd.ms-word.document.macroEnabled.12"],
      ["invoice.pdf.exe", "application/pdf"],
      ["invoice.exe.pdf", "application/pdf"],
      ["invoice.ｅｘｅ.pdf", "application/pdf"],
      ["invoice.pdf", "application/octet-stream"],
      ["invoice.pdf", "image/png"],
      ["invoice.pdf", "application/pdf; charset=binary"],
      ["../invoice.pdf", "application/pdf"],
      ["invoice..pdf", "application/pdf"],
      ["．invoice.pdf", "application/pdf"],
      ["invoice．pdf", "application/pdf"],
      ["folder／invoice.pdf", "application/pdf"],
      ["folder＼invoice.pdf", "application/pdf"],
      ["CON.pdf", "application/pdf"],
      ["CON .pdf", "application/pdf"],
      ["invoice .pdf", "application/pdf"],
      ["invoice.pdf ", "application/pdf"],
      ["invoice\u202Efdp.exe.pdf", "application/pdf"],
    ] as const;
    for (const [filename, contentType] of rejected) {
      expect(
        fileCreateSchema.safeParse({
          filename,
          contentType,
          sizeBytes: 1,
          checksumSha256: "0".repeat(64),
        }).success,
        `${filename} ${contentType}`,
      ).toBe(false);
    }
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

  it("rejects unregistered real adapters and malformed kind-specific payloads", () => {
    expect(() =>
      externalActionCreateSchema.parse({
        kind: "bank_payment",
        adapter: "real",
        payload: { amountCents: 100, beneficiary: "Supplier" },
        idempotencyKey: "payment-real-001",
        reason: "No real adapter is registered",
      }),
    ).toThrow();
    expect(() =>
      externalActionCreateSchema.parse({
        kind: "contract_sign",
        adapter: "manual",
        payload: { contractId: "not-a-uuid" },
        idempotencyKey: "contract-sign-001",
        reason: "Invalid target must fail before approval",
      }),
    ).toThrow();
    expect(() =>
      externalActionCreateSchema.parse({
        kind: "invoice_red",
        adapter: "manual",
        payload: { invoiceId: "59450c16-488f-4c71-a73d-54a86bab2e2a" },
        idempotencyKey: "invoice-red-001",
        reason: "A red-letter reason is required",
      }),
    ).toThrow(/reason/);
    expect(() =>
      externalActionCreateSchema.parse({
        kind: "contract_terminate",
        adapter: "manual",
        payload: { contractId: "59450c16-488f-4c71-a73d-54a86bab2e2a" },
        idempotencyKey: "contract-termination-001",
        reason: "A termination basis is mandatory",
      }),
    ).toThrow();
  });

  it("reserves internal approval types for their controlled workflows", () => {
    for (const resourceType of ["external-action", "membership-lifecycle", "role-assignment"]) {
      expect(() =>
        approvalRequestSchema.parse({
          resourceType,
          resourceId: "59450c16-488f-4c71-a73d-54a86bab2e2a",
          operation: "forged",
          reason: "Generic entry points must not impersonate internal workflows",
        }),
      ).toThrow(/controlled business workflow/);
    }
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
