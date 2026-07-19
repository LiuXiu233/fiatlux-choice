import type { ResourceName } from "@fiatlux/contracts";

import { DomainError } from "./errors.js";

type RecordValue = Record<string, unknown>;

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function changed(value: RecordValue, previous: RecordValue, key: string) {
  if (!(key in value)) return false;
  const next = value[key];
  const current = previous[key];
  if (key.endsWith("At")) {
    const nextDate = date(next);
    const currentDate = date(current);
    if (nextDate || currentDate) return nextDate?.valueOf() !== currentDate?.valueOf();
  }
  return next !== current;
}

function anyChanged(value: RecordValue, previous: RecordValue, keys: readonly string[]) {
  return keys.some((key) => changed(value, previous, key));
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

  if (resource === "contracts") {
    const status = value.status ?? previous?.status;
    const fileId = value.fileId !== undefined ? value.fileId : previous?.fileId;
    if (value.status === "active" && previous?.status !== "active") {
      throw new DomainError(
        "APPROVAL_REQUIRED",
        "Contract activation requires a confirmed contract-sign external action",
        409,
      );
    }
    if (value.status === "terminated" && previous?.status === "active") {
      throw new DomainError(
        "APPROVAL_REQUIRED",
        "Active contract termination requires a confirmed contract-termination external action",
        409,
      );
    }
    if (["pending_signature", "active"].includes(String(status)) && !fileId) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Pending-signature and active contracts require a verified file",
        400,
      );
    }
    if (previous) {
      const immutableFields = [
        "name",
        "counterparty",
        "contractNumber",
        "startsAt",
        "endsAt",
        "valueCents",
        "currency",
        "fileId",
      ] as const;
      if (
        ["active", "expired", "terminated"].includes(String(previous.status)) &&
        anyChanged(value, previous, immutableFields)
      ) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "Signed contract terms are immutable; create an amendment or a new contract version",
          409,
        );
      }
      if (
        previous.status === "active" &&
        value.status !== undefined &&
        !["active", "expired", "terminated"].includes(String(value.status))
      ) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "An active contract cannot return to a pre-signature state",
          409,
        );
      }
      if (
        ["expired", "terminated"].includes(String(previous.status)) &&
        value.status !== undefined &&
        value.status !== previous.status
      ) {
        throw new DomainError("INVALID_TRANSITION", "Closed contract states are terminal", 409);
      }
      const allowedTransitions: Record<string, readonly string[]> = {
        draft: ["draft", "review", "pending_signature"],
        review: ["draft", "review", "pending_signature"],
        pending_signature: ["draft", "review", "pending_signature", "active"],
        active: ["active", "expired", "terminated"],
        expired: ["expired"],
        terminated: ["terminated"],
      };
      if (
        value.status !== undefined &&
        !(allowedTransitions[String(previous.status)] ?? []).includes(String(value.status))
      ) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "Contract status cannot skip signature, expiry, or termination controls",
          409,
        );
      }
      if (previous.status === "active" && value.status === "expired") {
        const expiry = date(value.endsAt ?? previous.endsAt);
        if (!expiry || expiry > new Date()) {
          throw new DomainError(
            "INVALID_TRANSITION",
            "An active contract can expire only after its recorded end time",
            409,
          );
        }
      }
    }
  }

  if (resource === "invoices") {
    const status = value.status ?? previous?.status;
    const fileId = value.fileId !== undefined ? value.fileId : previous?.fileId;
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
    if (
      ["issued", "received", "paid", "red_pending", "red_confirmed"].includes(String(status)) &&
      !fileId
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Issued and received invoice records require a verified file",
        400,
      );
    }
    if (previous) {
      const immutableFields = [
        "invoiceNumber",
        "direction",
        "counterparty",
        "amountCents",
        "taxAmountCents",
        "currency",
        "issuedAt",
        "dueAt",
        "fileId",
      ] as const;
      if (previous.status !== "draft" && anyChanged(value, previous, immutableFields)) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "Issued invoice facts are immutable; record a red-letter or replacement invoice",
          409,
        );
      }
      const allowedTransitions: Record<string, readonly string[]> = {
        draft: ["draft", "issued", "received", "void"],
        issued: ["issued", "paid", "void"],
        received: ["received", "paid", "void"],
        paid: ["paid"],
        void: ["void"],
        red_pending: ["red_pending"],
        red_confirmed: ["red_confirmed"],
      };
      if (
        value.status !== undefined &&
        !(allowedTransitions[String(previous.status)] ?? []).includes(String(value.status))
      ) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "Invoice status cannot move backward or leave a terminal state",
          409,
        );
      }
    }
  }

  if (
    resource === "financial-entries" &&
    previous &&
    previous.externalActionId &&
    anyChanged(value, previous, [
      // Once a draft ledger entry is captured by a controlled payment
      // request, the payment snapshot must remain stable until the action
      // is confirmed, rejected, or cancelled.  A description is deliberately
      // left editable so an operator can correct explanatory text and then
      // exercise the stale-snapshot failure path explicitly.
      "occurredAt",
      "type",
      "amountCents",
      "currency",
      "status",
      "externalActionId",
    ])
  ) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Controlled payment ledger fields are immutable until the external action is resolved",
      409,
    );
  }

  if (
    resource === "financial-entries" &&
    previous &&
    ["posted", "void"].includes(String(previous.status)) &&
    anyChanged(value, previous, [
      "occurredAt",
      "type",
      "category",
      "description",
      "amountCents",
      "currency",
      "status",
      "externalActionId",
    ])
  ) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Posted or void ledger entries are immutable; create a reversing adjustment",
      409,
    );
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
  if (resource === "financial-entries" && current.externalActionId) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "A ledger entry linked to an external action cannot be archived until that action is cancelled",
      409,
    );
  }
  if (resource === "financial-entries" && ["posted", "void"].includes(String(current.status))) {
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
  if (resource === "invoices" && current.status !== "draft") {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Issued, received, paid, void, and red-letter invoice records must remain in the audit archive",
      409,
    );
  }
}
