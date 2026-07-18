import { DomainError } from "./errors.js";

export type ExternalAdapter = "manual" | "mock" | "real";
export type ExternalActionStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "simulated";

const transitions: Record<ExternalActionStatus, readonly ExternalActionStatus[]> = {
  draft: ["pending_approval", "approved", "cancelled", "simulated"],
  pending_approval: ["approved", "cancelled"],
  approved: ["submitted", "cancelled", "simulated"],
  submitted: ["confirmed", "failed"],
  confirmed: [],
  failed: ["submitted", "cancelled"],
  cancelled: [],
  simulated: [],
};

export function assertExternalActionTransition(input: {
  adapter: ExternalAdapter;
  from: ExternalActionStatus;
  to: ExternalActionStatus;
  evidence?: Record<string, unknown>;
}) {
  if (!transitions[input.from].includes(input.to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `External action cannot transition from ${input.from} to ${input.to}`,
      409,
    );
  }

  if (input.adapter === "mock" && !["simulated", "cancelled"].includes(input.to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Mock adapters may only produce simulated or cancelled outcomes",
      409,
    );
  }

  if (input.to === "confirmed" && (!input.evidence || Object.keys(input.evidence).length === 0)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Confirmed external actions require external receipt evidence",
      400,
    );
  }
}
