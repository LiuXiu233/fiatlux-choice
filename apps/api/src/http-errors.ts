import { auditEvents, type Database } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";

function clientErrorEnvelope(statusCode: number) {
  switch (statusCode) {
    case 401:
      return { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required" };
    case 403:
      return { code: "FORBIDDEN", message: "Request is not permitted" };
    case 404:
      return { code: "NOT_FOUND", message: "Resource not found" };
    case 409:
      return { code: "CONFLICT", message: "Request conflicts with current state" };
    case 413:
      return { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" };
    case 415:
      return { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content type is not supported" };
    case 429:
      return { code: "RATE_LIMITED", message: "Too many requests" };
    default:
      return { code: "VALIDATION_FAILED", message: "Request validation failed" };
  }
}

function clientStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const statusCode = error.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

const dependencyUnavailableCodes = new Set([
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);

// These failures can occur after PostgreSQL received a write, so the caller must not infer that
// the operation was rolled back merely because no response reached the API process.
const dependencyOutcomeUnknownCodes = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

type DependencyFailureKind = "outcome_unknown" | "unavailable";

function dependencyFailureKind(error: unknown): DependencyFailureKind | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === "string") {
      if (dependencyOutcomeUnknownCodes.has(candidate.code)) return "outcome_unknown";
      if (dependencyUnavailableCodes.has(candidate.code)) return "unavailable";
    }
    current = candidate.cause;
  }
  return undefined;
}

async function appendRejectedRequestAudit(
  db: Database | undefined,
  request: FastifyRequest,
  code: string,
  status: number,
) {
  const auth = request.auth;
  if (!db || !auth?.orgId || !auth.userId) return;
  try {
    const userAgent = request.headers["user-agent"];
    await db.insert(auditEvents).values({
      orgId: auth.orgId,
      actorUserId: auth.userId,
      action: "request_rejected",
      resourceType: "request",
      resourceId: request.url.split("?", 1)[0] ?? request.url,
      requestId: request.id,
      metadata: { method: request.method, code, status },
      ipAddress: request.ip,
      ...(typeof userAgent === "string" ? { userAgent } : {}),
    });
  } catch (auditError) {
    request.log.error(
      { err: auditError, requestId: request.id, code, status },
      "failed to append rejected-request audit",
    );
  }
}

function logUnauthenticatedLoginRejection(request: FastifyRequest, code: string, status: number) {
  if (request.auth?.orgId || request.auth?.userId) return;
  const path = request.url.split("?", 1)[0] ?? request.url;
  if (request.method !== "POST" || path !== "/api/v1/auth/login") return;
  request.log.warn(
    {
      requestId: request.id,
      method: request.method,
      path,
      code,
      status,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    },
    "unauthenticated login request rejected",
  );
}

export function registerErrorHandler(app: FastifyInstance, db?: Database) {
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      await appendRejectedRequestAudit(db, request, "VALIDATION_FAILED", 400);
      logUnauthenticatedLoginRejection(request, "VALIDATION_FAILED", 400);
      return reply.status(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          details: error.flatten(),
          requestId: request.id,
        },
      });
    }

    if (error instanceof DomainError) {
      if (error.statusCode >= 400 && error.statusCode < 500) {
        await appendRejectedRequestAudit(db, request, error.code, error.statusCode);
        logUnauthenticatedLoginRejection(request, error.code, error.statusCode);
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId: request.id,
        },
      });
    }

    if (error instanceof Error && error.name === "PermissionDenied") {
      await appendRejectedRequestAudit(db, request, "FORBIDDEN", 403);
      return reply.status(403).send({
        error: { code: "FORBIDDEN", message: error.message, requestId: request.id },
      });
    }

    const clientStatus = clientStatusCode(error);
    if (clientStatus) {
      const clientError = clientErrorEnvelope(clientStatus);
      await appendRejectedRequestAudit(db, request, clientError.code, clientStatus);
      logUnauthenticatedLoginRejection(request, clientError.code, clientStatus);
      return reply.status(clientStatus).send({
        error: { ...clientError, requestId: request.id },
      });
    }

    const dependencyFailure = dependencyFailureKind(error);
    if (dependencyFailure) {
      request.log.error({ err: error, requestId: request.id }, "request dependency unavailable");
      return reply.status(503).send({
        error: {
          code:
            dependencyFailure === "outcome_unknown"
              ? "DEPENDENCY_OUTCOME_UNKNOWN"
              : "DEPENDENCY_UNAVAILABLE",
          message:
            dependencyFailure === "outcome_unknown"
              ? "A dependency connection was interrupted; verify the request outcome before retrying"
              : "A required service is temporarily unavailable",
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error, requestId: request.id }, "request failed");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        requestId: request.id,
      },
    });
  });
}
