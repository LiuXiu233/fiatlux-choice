import type { ResourceName } from "@fiatlux/contracts";

import { DomainError } from "./errors.js";

type RecordValue = Record<string, unknown>;

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

export function assertBusinessRules(
  resource: ResourceName,
  value: RecordValue,
  previous?: RecordValue,
) {
  const startsAt = date(value.startsAt ?? previous?.startsAt);
  const endsAt = date(value.endsAt ?? value.dueAt ?? previous?.endsAt ?? previous?.dueAt);
  if (startsAt && endsAt && endsAt < startsAt) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "End or due date cannot be earlier than start date",
      400,
    );
  }

  if (resource === "objectives") {
    const status = value.status ?? previous?.status;
    const progress = value.progress ?? previous?.progress;
    if (status === "completed" && progress !== 100) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Completed objectives must have 100 percent progress",
        400,
      );
    }
  }

  if (resource === "decisions") {
    const status = value.status ?? previous?.status;
    const decision = value.decision ?? previous?.decision;
    const decidedAt = value.decidedAt ?? previous?.decidedAt;
    if (status === "approved" && (!decision || !decidedAt)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Approved decisions require a decision and decidedAt timestamp",
        400,
      );
    }
  }

  if (resource === "compliance-items") {
    const status = value.status ?? previous?.status;
    const reviewStatus = value.reviewStatus ?? previous?.reviewStatus;
    const lastVerifiedAt = value.lastVerifiedAt ?? previous?.lastVerifiedAt;
    if (status === "active" && (reviewStatus !== "reviewed" || !lastVerifiedAt)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Active compliance items require reviewed status and a verification timestamp",
        400,
      );
    }
  }

  if (resource === "contracts" && value.status === "active" && previous?.status !== "active") {
    throw new DomainError(
      "APPROVAL_REQUIRED",
      "Contract activation requires a confirmed contract-sign external action",
      409,
    );
  }

  if (resource === "invoices") {
    const protectedStatuses = ["red_pending", "red_confirmed"];
    if (
      value.status !== undefined &&
      protectedStatuses.includes(String(value.status)) &&
      (!previous || value.status !== previous.status)
    ) {
      throw new DomainError(
        "APPROVAL_REQUIRED",
        "Invoice red-letter transitions require the invoice-red approval workflow",
        409,
      );
    }
  }

  if (resource === "notifications" && value.status !== undefined) {
    if (!previous && value.status !== "queued") {
      throw new DomainError(
        "VALIDATION_FAILED",
        "New notifications must start in queued status",
        400,
      );
    }
    if (previous && value.status !== previous.status) {
      throw new DomainError(
        "INVALID_TRANSITION",
        "Notification delivery status is controlled by the delivery worker",
        409,
      );
    }
  }
}

export function assertArchivable(resource: ResourceName, current: RecordValue) {
  if (resource === "financial-entries" && current.status === "posted") {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Posted financial entries must be voided with an audit trail, not archived",
      409,
    );
  }
  if (resource === "contracts" && current.status === "active") {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Active contracts must be terminated before archival",
      409,
    );
  }
}
