import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApprovalDetails } from "./approvals-page";

type ApprovalDetailsRecord = Parameters<typeof ApprovalDetails>[0]["approval"];

const baseApproval: ApprovalDetailsRecord = {
  id: "approval-1",
  title: "支付电竞教育试点场租尾款",
  status: "approved",
  resourceType: "external-action",
  resourceId: "external-action-1",
  operation: "bank_payment",
  riskLevel: "critical",
  requestedBy: "user-owner",
  createdAt: "2026-07-18T08:00:00Z",
  reason: "依据验收记录支付已批准尾款",
};

afterEach(cleanup);

describe("ApprovalDetails", () => {
  it("separates approval state from linked external execution evidence", () => {
    render(
      <ApprovalDetails
        approval={{
          ...baseApproval,
          linkedExternalAction: {
            id: "external-action-1",
            status: "confirmed",
            adapter: "manual",
            evidence: {
              externalReference: "manual-submit-training-20260718",
              receiptReference: "manual-receipt-training-20260718",
            },
            externalReference: "manual-receipt-training-20260718",
          },
        }}
      />,
    );

    expect(screen.getByText("审批状态")).not.toBeNull();
    expect(screen.getByText("已批准")).not.toBeNull();
    expect(screen.getByText("外部执行状态")).not.toBeNull();
    expect(screen.getByText("已确认")).not.toBeNull();
    expect(screen.getByText("执行适配器")).not.toBeNull();
    expect(screen.getByText("manual")).not.toBeNull();
    expect(screen.getByText("外部回执引用")).not.toBeNull();
    expect(screen.getByText("manual-receipt-training-20260718")).not.toBeNull();
  });

  it("does not invent external execution state for an internal approval", () => {
    render(
      <ApprovalDetails
        approval={{
          ...baseApproval,
          id: "approval-membership-1",
          title: "停用成员",
          resourceType: "membership",
          resourceId: "membership-1",
          operation: "membership_deactivate",
        }}
      />,
    );

    expect(screen.getByText("审批状态")).not.toBeNull();
    expect(screen.queryByText("外部执行状态")).toBeNull();
    expect(screen.queryByText("执行适配器")).toBeNull();
    expect(screen.queryByText("外部回执引用")).toBeNull();
  });
});
