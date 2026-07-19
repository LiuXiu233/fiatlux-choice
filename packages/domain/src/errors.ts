export type ErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "APPROVAL_REQUIRED"
  | "INVALID_TRANSITION"
  | "PAYLOAD_TOO_LARGE"
  | "INTEGRATION_UNAVAILABLE";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
