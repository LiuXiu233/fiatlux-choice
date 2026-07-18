import { auditEvents, type Database } from "@fiatlux/db";

import type { RequestAuditContext } from "./types.js";

export interface AuditEventInput {
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export async function appendAuditEvent(
  db: Database,
  context: RequestAuditContext,
  event: AuditEventInput,
) {
  await db.insert(auditEvents).values({
    orgId: context.orgId,
    actorUserId: context.actorUserId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    requestId: context.requestId,
    before: event.before,
    after: event.after,
    metadata: event.metadata ?? {},
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}
