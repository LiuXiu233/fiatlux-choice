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

export function registerErrorHandler(app: FastifyInstance, db?: Database) {
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
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
      return reply.status(clientStatus).send({
        error: { ...clientError, requestId: request.id },
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
