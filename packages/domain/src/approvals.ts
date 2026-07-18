import { DomainError } from "./errors.js";

export const HUMAN_APPROVAL_ACTIONS = [
  "bank_payment",
  "tax_filing",
  "invoice_red",
  "contract_sign",
  "hr_discipline",
  "permission_change",
  "external_legal_commitment",
] as const;

export type HumanApprovalAction = (typeof HUMAN_APPROVAL_ACTIONS)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export function requiresHumanApproval(kind: string): kind is HumanApprovalAction {
  return (HUMAN_APPROVAL_ACTIONS as readonly string[]).includes(kind);
}

export function assertApprovalDecision(input: {
  currentStatus: ApprovalStatus;
  requesterId: string;
  decisionMakerId: string;
  acknowledgement?: string;
}) {
  if (input.currentStatus !== "pending") {
    throw new DomainError("CONFLICT", `Approval is already ${input.currentStatus}`, 409);
  }

  if (
    input.requesterId === input.decisionMakerId &&
    input.acknowledgement !== "SELF_APPROVAL_ACKNOWLEDGED"
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Self-approval requires SELF_APPROVAL_ACKNOWLEDGED acknowledgement",
      400,
    );
  }
}
