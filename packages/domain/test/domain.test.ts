import { describe, expect, it } from "vitest";

import {
  advisorContextSizeBytes,
  assertAdvisorEvidenceAllowed,
  assertApprovalDecision,
  assertArchivable,
  assertBusinessRules,
  assertExternalActionTransition,
  canAdvisorRead,
  filterAdvisorContext,
  hasPermission,
  requiresHumanApproval,
} from "../src/index.js";

describe("permission evaluation", () => {
  it("matches exact, resource wildcard and global wildcard permissions", () => {
    expect(hasPermission(["tasks:read"], "tasks:read")).toBe(true);
    expect(hasPermission(["tasks:*"], "tasks:update")).toBe(true);
    expect(hasPermission(["*"], "contracts:delete")).toBe(true);
    expect(hasPermission(["tasks:read"], "contracts:read")).toBe(false);
  });

  it("restricts advisor data scopes", () => {
    expect(canAdvisorRead("finance", "invoices")).toBe(true);
    expect(canAdvisorRead("finance", "tasks")).toBe(false);
  });
});

describe("human approval boundaries", () => {
  it("requires approval for irreversible company actions", () => {
    expect(requiresHumanApproval("bank_payment")).toBe(true);
    expect(requiresHumanApproval("contract_terminate")).toBe(true);
    expect(requiresHumanApproval("github_sync")).toBe(false);
  });

  it("records explicit acknowledgement for one-person self approval", () => {
    expect(() =>
      assertApprovalDecision({
        currentStatus: "pending",
        requesterId: "same",
        decisionMakerId: "same",
      }),
    ).toThrow(/Self-approval/);
    expect(() =>
      assertApprovalDecision({
        currentStatus: "pending",
        requesterId: "same",
        decisionMakerId: "same",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      }),
    ).not.toThrow();
  });
});

describe("external action truthfulness", () => {
  it("fails closed when a legacy record names an unregistered real adapter", () => {
    expect(() =>
      assertExternalActionTransition({
        adapter: "real",
        from: "approved",
        to: "submitted",
      }),
    ).toThrow(/No registered real/);
  });

  it("prevents mock confirmation", () => {
    expect(() =>
      assertExternalActionTransition({
        adapter: "mock",
        from: "approved",
        to: "submitted",
      }),
    ).toThrow(/Mock/);
  });

  it("requires receipt evidence before confirmation", () => {
    expect(() =>
      assertExternalActionTransition({
        adapter: "manual",
        from: "submitted",
        to: "confirmed",
      }),
    ).toThrow(/evidence/);
  });
});

describe("business invariants", () => {
  it("does not allow compliance conclusions to become active without review", () => {
    expect(() =>
      assertBusinessRules("compliance-items", {
        status: "active",
        reviewStatus: "unreviewed",
      }),
    ).toThrow(/reviewed/);
  });

  it("does not allow generic invoice red-letter transitions", () => {
    expect(() =>
      assertBusinessRules(
        "invoices",
        { status: "red_confirmed" },
        { status: "issued", fileId: "file" },
      ),
    ).toThrow(/approval workflow/);
  });

  it("does not allow protected contract or invoice states at creation", () => {
    expect(() => assertBusinessRules("contracts", { status: "active", fileId: "file" })).toThrow(
      /confirmed/,
    );
    expect(() =>
      assertBusinessRules("invoices", { status: "red_pending", fileId: "file" }),
    ).toThrow(/approval workflow/);
    expect(() =>
      assertBusinessRules("invoices", { status: "red_confirmed", fileId: "file" }),
    ).toThrow(/approval workflow/);
  });

  it("does not allow an active contract to bypass termination approval", () => {
    expect(() =>
      assertBusinessRules(
        "contracts",
        { status: "terminated" },
        { status: "active", fileId: "file" },
      ),
    ).toThrow(/termination external action/);
  });

  it("keeps signed contracts, final invoices, and posted ledgers immutable", () => {
    expect(() =>
      assertBusinessRules(
        "contracts",
        { counterparty: "Rewritten counterparty" },
        { status: "active", counterparty: "Signed counterparty", fileId: "file" },
      ),
    ).toThrow(/immutable/);
    expect(() =>
      assertBusinessRules(
        "contracts",
        { status: "pending_signature" },
        { status: "active", fileId: "file" },
      ),
    ).toThrow(/pre-signature/);
    expect(() =>
      assertBusinessRules(
        "invoices",
        { status: "paid" },
        { status: "red_confirmed", fileId: "file" },
      ),
    ).toThrow(/terminal/);
    expect(() =>
      assertBusinessRules(
        "financial-entries",
        { amountCents: 1 },
        { status: "posted", amountCents: 2 },
      ),
    ).toThrow(/reversing adjustment/);
  });

  it("freezes controlled payment fields while leaving the explanation editable", () => {
    const previous = {
      status: "draft",
      type: "expense",
      amountCents: 2_500,
      currency: "CNY",
      occurredAt: "2026-07-19T04:00:00.000Z",
      description: "Original payment basis",
      externalActionId: "6f68d4f5-3b1c-4d38-9d11-7ca6b1f2b7f2",
    };
    for (const patch of [
      { status: "posted" },
      { type: "income" },
      { amountCents: 2_501 },
      { currency: "USD" },
      { occurredAt: "2026-07-20T04:00:00.000Z" },
    ]) {
      expect(() => assertBusinessRules("financial-entries", patch, previous)).toThrow(
        /Controlled payment ledger fields are immutable/,
      );
    }
    expect(() =>
      assertBusinessRules(
        "financial-entries",
        { description: "Corrected explanatory text" },
        previous,
      ),
    ).not.toThrow();
  });

  it("does not archive a ledger entry while a controlled external action owns it", () => {
    expect(() =>
      assertArchivable("financial-entries", {
        status: "draft",
        externalActionId: "6f68d4f5-3b1c-4d38-9d11-7ca6b1f2b7f2",
      }),
    ).toThrow(/cannot be archived/);
    expect(() =>
      assertArchivable("financial-entries", { status: "draft", externalActionId: null }),
    ).not.toThrow();
  });

  it("prevents contracts and invoices from bypassing controlled terminal states", () => {
    for (const status of ["expired", "terminated"]) {
      expect(() =>
        assertBusinessRules(
          "contracts",
          { status },
          { status: "pending_signature", fileId: "verified-file" },
        ),
      ).toThrow(/cannot skip/);
    }
    expect(() =>
      assertBusinessRules(
        "contracts",
        { status: "expired" },
        {
          status: "active",
          fileId: "verified-file",
          endsAt: "2099-12-31T16:00:00.000Z",
        },
      ),
    ).toThrow(/only after/);
    expect(() =>
      assertBusinessRules(
        "contracts",
        { status: "expired" },
        {
          status: "active",
          fileId: "verified-file",
          endsAt: "2020-01-01T00:00:00.000Z",
        },
      ),
    ).not.toThrow();
    expect(() => assertArchivable("invoices", { status: "paid" })).toThrow(/audit archive/);
    expect(() => assertArchivable("invoices", { status: "draft" })).not.toThrow();
  });

  it("requires evidence files before contracts or invoices enter operational states", () => {
    expect(() => assertBusinessRules("contracts", { status: "pending_signature" })).toThrow(
      /verified file/,
    );
    expect(() => assertBusinessRules("invoices", { status: "issued" })).toThrow(/verified file/);
  });
});

describe("advisor compliance evidence gate", () => {
  it("only exposes active and reviewed compliance records as evidence", () => {
    const result = filterAdvisorContext(
      [
        {
          resourceType: "compliance-items",
          resourceId: "approved",
          record: {
            version: 3,
            status: "active",
            reviewStatus: "reviewed",
            contentHash: "approved-content-hash",
            metadataHash: "approved-metadata-hash",
            reviewOutcome: "applicable",
            reviewerName: "Reviewed Person",
            reviewerRole: "Legal reviewer",
            reviewerOrganization: "Review Organization",
            reviewerQualification: "Qualified for this test review",
            reviewMissingInformation: "No known missing information",
            reviewEvidenceFileId: "review-file-approved",
            reviewedByUserId: "review-recorder-approved",
            reviewedAt: "2026-07-01T00:00:00.000Z",
            reviewedSourceVersion: 2,
            reviewedContentHash: "approved-content-hash",
            reviewedMetadataHash: "approved-metadata-hash",
            nextReviewAt: "2027-01-01T00:00:00.000Z",
            summary: "usable",
          },
        },
        {
          resourceType: "compliance-items",
          resourceId: "hash-mismatch",
          record: {
            version: 3,
            status: "active",
            reviewStatus: "reviewed",
            contentHash: "changed-after-review",
            metadataHash: "stable-metadata-hash",
            reviewOutcome: "applicable",
            reviewerName: "Reviewed Person",
            reviewerRole: "Legal reviewer",
            reviewerOrganization: "Review Organization",
            reviewerQualification: "Qualified for this test review",
            reviewMissingInformation: "No known missing information",
            reviewEvidenceFileId: "review-file-hash-mismatch",
            reviewedByUserId: "review-recorder-hash-mismatch",
            reviewedAt: "2026-07-01T00:00:00.000Z",
            reviewedSourceVersion: 2,
            reviewedContentHash: "locked-before-review-change",
            reviewedMetadataHash: "stable-metadata-hash",
            nextReviewAt: "2027-01-01T00:00:00.000Z",
            summary: "hash mismatch contents must stay hidden",
          },
        },
        {
          resourceType: "compliance-items",
          resourceId: "draft",
          record: { status: "draft", reviewStatus: "pending", summary: "must stay hidden" },
        },
        {
          resourceType: "compliance-items",
          resourceId: "stale",
          record: { status: "uncertain", reviewStatus: "stale", summary: "must stay hidden" },
        },
        {
          resourceType: "compliance-items",
          resourceId: "expired",
          record: {
            version: 3,
            status: "active",
            reviewStatus: "reviewed",
            contentHash: "expired-content-hash",
            metadataHash: "expired-metadata-hash",
            reviewOutcome: "applicable",
            reviewerName: "Reviewed Person",
            reviewerRole: "Legal reviewer",
            reviewerOrganization: "Review Organization",
            reviewerQualification: "Qualified for this test review",
            reviewMissingInformation: "No known missing information",
            reviewEvidenceFileId: "review-file-expired",
            reviewedByUserId: "review-recorder-expired",
            reviewedAt: "2025-01-01T00:00:00.000Z",
            reviewedSourceVersion: 2,
            reviewedContentHash: "expired-content-hash",
            reviewedMetadataHash: "expired-metadata-hash",
            nextReviewAt: "2025-01-01T00:00:00.000Z",
            summary: "expired contents must stay hidden",
          },
        },
        {
          resourceType: "compliance-items",
          resourceId: "unscheduled",
          record: {
            version: 3,
            status: "active",
            reviewStatus: "reviewed",
            contentHash: "unscheduled-content-hash",
            metadataHash: "unscheduled-metadata-hash",
            reviewOutcome: "applicable",
            reviewerName: "Reviewed Person",
            reviewerRole: "Legal reviewer",
            reviewerOrganization: "Review Organization",
            reviewerQualification: "Qualified for this test review",
            reviewMissingInformation: "No known missing information",
            reviewEvidenceFileId: "review-file-unscheduled",
            reviewedByUserId: "review-recorder-unscheduled",
            reviewedAt: "2026-07-01T00:00:00.000Z",
            reviewedSourceVersion: 2,
            reviewedContentHash: "unscheduled-content-hash",
            reviewedMetadataHash: "unscheduled-metadata-hash",
            nextReviewAt: null,
            summary: "unscheduled contents must stay hidden",
          },
        },
        {
          resourceType: "compliance-items",
          resourceId: "legacy-without-professional-review",
          record: {
            status: "active",
            reviewStatus: "reviewed",
            nextReviewAt: "2027-01-01T00:00:00.000Z",
            summary: "legacy contents must stay hidden",
          },
        },
        {
          resourceType: "tasks",
          resourceId: "task",
          record: { status: "active", title: "usable" },
        },
      ],
      new Date("2026-07-18T00:00:00.000Z"),
    );

    expect(result.accepted.map((item) => item.resourceId)).toEqual(["approved", "task"]);
    expect(JSON.stringify(result.modelContext)).not.toContain("must stay hidden");
    expect(result.withheldComplianceCount).toBe(6);
    expect(result.modelContext.at(-1)).toMatchObject({
      resourceType: "compliance-review-gaps",
      withheldCount: 6,
      reasonCounts: {
        compliance_item_not_active_and_reviewed: 2,
        compliance_item_professional_review_not_conclusive: 2,
        compliance_item_review_expired_or_unscheduled: 2,
      },
    });
  });

  it("inherits source review gates for compliance events and sourced obligations", () => {
    const reviewedSource = {
      resourceId: "reviewed-source",
      version: 3,
      status: "active",
      reviewStatus: "reviewed",
      contentHash: "reviewed-source-content-hash",
      metadataHash: "reviewed-source-metadata-hash",
      reviewOutcome: "applicable",
      reviewerName: "Reviewed Person",
      reviewerRole: "Legal reviewer",
      reviewerOrganization: "Review Organization",
      reviewerQualification: "Qualified for this test review",
      reviewMissingInformation: "No known missing information",
      reviewEvidenceFileId: "review-file-reviewed-source",
      reviewedByUserId: "review-recorder-reviewed-source",
      reviewedAt: "2026-07-01T00:00:00.000Z",
      reviewedSourceVersion: 2,
      reviewedContentHash: "reviewed-source-content-hash",
      reviewedMetadataHash: "reviewed-source-metadata-hash",
      nextReviewAt: "2027-01-01T00:00:00.000Z",
    };
    const pendingSource = {
      resourceId: "pending-source",
      version: 1,
      status: "draft",
      reviewStatus: "pending",
      contentHash: null,
      metadataHash: null,
      reviewOutcome: null,
      reviewerName: null,
      reviewerRole: null,
      reviewerOrganization: null,
      reviewerQualification: null,
      reviewMissingInformation: null,
      reviewEvidenceFileId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewedSourceVersion: null,
      reviewedContentHash: null,
      reviewedMetadataHash: null,
      nextReviewAt: null,
    };
    const notApplicableSource = {
      resourceId: "not-applicable-source",
      version: 3,
      status: "active",
      reviewStatus: "reviewed",
      contentHash: "not-applicable-content-hash",
      metadataHash: "not-applicable-metadata-hash",
      reviewOutcome: "not_applicable",
      reviewerName: "Reviewed Person",
      reviewerRole: "Legal reviewer",
      reviewerOrganization: "Review Organization",
      reviewerQualification: "Qualified for this test review",
      reviewMissingInformation: "No known missing information",
      reviewEvidenceFileId: "review-file-not-applicable-source",
      reviewedByUserId: "review-recorder-not-applicable-source",
      reviewedAt: "2026-07-01T00:00:00.000Z",
      reviewedSourceVersion: 2,
      reviewedContentHash: "not-applicable-content-hash",
      reviewedMetadataHash: "not-applicable-metadata-hash",
      nextReviewAt: "2027-01-01T00:00:00.000Z",
    };
    const result = filterAdvisorContext(
      [
        {
          resourceType: "compliance-events",
          resourceId: "reviewed-event",
          record: {
            sourceId: "reviewed-source",
            reviewStatus: "reviewed",
            title: "reviewed event",
          },
          complianceSourceReview: reviewedSource,
        },
        {
          resourceType: "compliance-events",
          resourceId: "event-with-pending-source",
          record: {
            sourceId: "pending-source",
            reviewStatus: "reviewed",
            title: "withheld event contents",
          },
          complianceSourceReview: pendingSource,
        },
        {
          resourceType: "compliance-events",
          resourceId: "pending-event",
          record: {
            sourceId: "reviewed-source",
            reviewStatus: "pending",
            title: "withheld pending event contents",
          },
          complianceSourceReview: reviewedSource,
        },
        {
          resourceType: "obligations",
          resourceId: "reviewed-obligation",
          record: { sourceId: "reviewed-source", title: "reviewed obligation" },
          complianceSourceReview: reviewedSource,
        },
        {
          resourceType: "obligations",
          resourceId: "obligation-with-pending-source",
          record: { sourceId: "pending-source", title: "withheld obligation contents" },
          complianceSourceReview: pendingSource,
        },
        {
          resourceType: "obligations",
          resourceId: "obligation-with-not-applicable-source",
          record: {
            sourceId: "not-applicable-source",
            title: "withheld non-applicable obligation contents",
          },
          complianceSourceReview: notApplicableSource,
        },
        {
          resourceType: "obligations",
          resourceId: "internal-obligation",
          record: { sourceId: null, title: "internal company obligation" },
        },
      ],
      new Date("2026-07-18T00:00:00.000Z"),
    );

    expect(result.accepted.map((item) => item.resourceId)).toEqual([
      "reviewed-event",
      "reviewed-obligation",
      "internal-obligation",
    ]);
    expect(result.withheld).toEqual([
      {
        resourceType: "compliance-events",
        resourceId: "event-with-pending-source",
        reasons: ["linked_compliance_source_not_active_and_reviewed"],
      },
      {
        resourceType: "compliance-events",
        resourceId: "pending-event",
        reasons: ["compliance_event_not_reviewed"],
      },
      {
        resourceType: "obligations",
        resourceId: "obligation-with-pending-source",
        reasons: ["linked_compliance_source_not_active_and_reviewed"],
      },
      {
        resourceType: "obligations",
        resourceId: "obligation-with-not-applicable-source",
        reasons: ["linked_compliance_source_not_applicable"],
      },
    ]);
    expect(result.withheldReasonCounts).toEqual({
      compliance_event_not_reviewed: 1,
      linked_compliance_source_not_active_and_reviewed: 2,
      linked_compliance_source_not_applicable: 1,
    });
    expect(JSON.stringify(result.modelContext)).not.toContain("withheld event contents");
    expect(JSON.stringify(result.modelContext)).not.toContain("withheld obligation contents");
    expect(JSON.stringify(result.modelContext)).not.toContain(
      "withheld non-applicable obligation contents",
    );
    expect(JSON.stringify(result.modelContext)).not.toContain("complianceSourceReview");
  });

  it("recursively minimizes secrets and common personal identifiers without mutating audit data", () => {
    const originalRecord = {
      title: "Contact supplier",
      contact: "王某 li@example.cn +86 13800138000",
      identity: "440106199001011234",
      settlementAccount: "6222 0201 2345 6789 012",
      passwordHash: "sensitive-password-hash",
      nested: {
        apiKey: "sensitive-api-key",
        safeBusinessField: "Keep this value",
        attendees: ["owner@example.com", "13900139000"],
        headers: { Authorization: "Bearer sensitive-token", accept: "application/json" },
      },
    };

    const result = filterAdvisorContext([
      {
        resourceType: "contracts",
        resourceId: "contract-1",
        record: originalRecord,
      },
    ]);
    const serializedModelContext = JSON.stringify(result.modelContext);

    expect(result.accepted[0]?.record).toBe(originalRecord);
    expect(originalRecord).toMatchObject({
      passwordHash: "sensitive-password-hash",
      nested: {
        apiKey: "sensitive-api-key",
        headers: { Authorization: "Bearer sensitive-token" },
      },
    });
    expect(result.modelContext[0]).toMatchObject({
      resourceType: "contracts",
      resourceId: "contract-1",
      record: {
        title: "Contact supplier",
        contact: "王某 [REDACTED_EMAIL] [REDACTED_PHONE]",
        identity: "[REDACTED_CN_ID]",
        settlementAccount: "[REDACTED_BANK_CARD]",
        nested: {
          safeBusinessField: "Keep this value",
          attendees: ["[REDACTED_EMAIL]", "[REDACTED_PHONE]"],
          headers: { accept: "application/json" },
        },
      },
    });
    expect(serializedModelContext).not.toContain("sensitive-password-hash");
    expect(serializedModelContext).not.toContain("sensitive-api-key");
    expect(serializedModelContext).not.toContain("sensitive-token");
    expect(advisorContextSizeBytes(result.modelContext)).toBe(
      new TextEncoder().encode(serializedModelContext).byteLength,
    );
  });

  it("rejects model citations that were not in filtered context", () => {
    expect(() =>
      assertAdvisorEvidenceAllowed(
        {
          facts: [
            {
              claim: "Unverified claim",
              evidence: [{ sourceType: "compliance-items", sourceId: "withheld" }],
            },
          ],
          inferences: [],
          recommendations: [],
          risks: [],
          missingInformation: [],
          confidence: 0.2,
          disclaimer: "Decision support only",
        },
        [{ resourceType: "compliance-review-gaps", withheldCount: 1 }],
      ),
    ).toThrow(/outside/);
  });

  it("rejects fabricated evidence excerpts even when the source id is allowed", () => {
    expect(() =>
      assertAdvisorEvidenceAllowed(
        {
          facts: [
            {
              claim: "Fabricated detail",
              evidence: [
                {
                  sourceType: "tasks",
                  sourceId: "task-1",
                  excerpt: "This sentence does not exist in the frozen record",
                },
              ],
            },
          ],
          inferences: [],
          recommendations: [],
          risks: [],
          missingInformation: [],
          confidence: 0.2,
          disclaimer: "Decision support only",
        },
        [
          {
            resourceType: "tasks",
            resourceId: "task-1",
            record: { title: "真实任务", description: "仅以冻结上下文为依据" },
          },
        ],
      ),
    ).toThrow(/excerpt was not found/);
  });
});
