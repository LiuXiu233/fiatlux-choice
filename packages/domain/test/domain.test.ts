import { describe, expect, it } from "vitest";

import {
  assertAdvisorEvidenceAllowed,
  assertApprovalDecision,
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
      assertBusinessRules("invoices", { status: "red_confirmed" }, { status: "issued" }),
    ).toThrow(/approval workflow/);
  });

  it("does not allow protected contract or invoice states at creation", () => {
    expect(() => assertBusinessRules("contracts", { status: "active" })).toThrow(/confirmed/);
    expect(() => assertBusinessRules("invoices", { status: "red_pending" })).toThrow(
      /approval workflow/,
    );
    expect(() => assertBusinessRules("invoices", { status: "red_confirmed" })).toThrow(
      /approval workflow/,
    );
  });
});

describe("advisor compliance evidence gate", () => {
  it("only exposes active and reviewed compliance records as evidence", () => {
    const result = filterAdvisorContext([
      {
        resourceType: "compliance-items",
        resourceId: "approved",
        record: { status: "active", reviewStatus: "reviewed", summary: "usable" },
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
      { resourceType: "tasks", resourceId: "task", record: { status: "active", title: "usable" } },
    ]);

    expect(result.accepted.map((item) => item.resourceId)).toEqual(["approved", "task"]);
    expect(JSON.stringify(result.modelContext)).not.toContain("must stay hidden");
    expect(result.withheldComplianceCount).toBe(2);
    expect(result.modelContext.at(-1)).toMatchObject({
      resourceType: "compliance-review-gaps",
      withheldCount: 2,
    });
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
});
