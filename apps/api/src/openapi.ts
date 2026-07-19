import type fastifySwagger from "@fastify/swagger";
import {
  advisorKeySchema,
  advisorOutputSchema,
  advisorRunCreateSchema,
  advisorRunEditSchema,
  approvalDecisionSchema,
  approvalRequestSchema,
  changePasswordSchema,
  complianceMonitoringStatusSchema,
  complianceMonitorRequestSchema,
  complianceProfessionalReviewSchema,
  complianceReviewListQuerySchema,
  externalActionCreateSchema,
  externalActionTransitionSchema,
  fileCreateSchema,
  idSchema,
  listQuerySchema,
  loginSchema,
  MAX_FILE_SIZE_BYTES,
  membershipLifecycleRequestSchema,
  notificationMarkReadSchema,
  type ResourceName,
  resourceContracts,
  updateSchemaFor,
} from "@fiatlux/contracts";
import {
  advisorCitations,
  advisorEdits,
  advisorModelCalls,
  advisorRuns,
  advisorToolCalls,
  approvals,
  auditEvents,
  backups,
  cashFlowEntries,
  complianceEvents,
  complianceItems,
  complianceSourceSnapshots,
  contracts,
  decisions,
  externalActions,
  files,
  financialEntries,
  githubInsights,
  integrationChecks,
  invoices,
  memberships,
  notifications,
  objectives,
  obligations,
  opportunities,
  products,
  projects,
  promptVersions,
  risks,
  roles,
  tasks,
  workflowDefinitions,
  workflowRuns,
} from "@fiatlux/db";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifySchema, HTTPMethods, RouteOptions } from "fastify";
import { type ZodTypeAny, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  backupCreateSchema,
  integrationDefinitions,
  integrationIdParamsSchema,
  roleAssignmentSchema,
  userCreateSchema,
  userUpdateSchema,
} from "./admin-routes.js";
import { promptVersionCreateSchema } from "./advisor-routes.js";
import { complianceSnapshotListQuerySchema } from "./compliance-monitor-routes.js";
import { auditEventListQuerySchema } from "./dashboard-routes.js";
import { fileArchiveQuerySchema, fileUpdateSchema } from "./file-routes.js";
import { resourceArchiveQuerySchema } from "./resource-routes.js";

type JsonSchema = Record<string, unknown>;
type PublicMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface PublicRouteInventoryItem {
  method: PublicMethod;
  url: string;
}

interface OperationContract {
  operationId: string;
  anonymous?: boolean;
  params?: JsonSchema;
  querystring?: JsonSchema;
  body?: JsonSchema;
  bodyRequired?: boolean;
  consumes?: string[];
  headers?: JsonSchema;
  success: Record<string, JsonSchema>;
}

const publicMethods = new Set<PublicMethod>(["DELETE", "GET", "PATCH", "POST", "PUT"]);
const publicRouteInventory = new WeakMap<FastifyInstance, Map<string, PublicRouteInventoryItem>>();

function routeKey(method: PublicMethod, url: string) {
  return `${method} ${url}`;
}

function isPublicUrl(url: string) {
  return url === "/health" || url.startsWith("/health/") || url.startsWith("/api/v1/");
}

function routeMethods(method: HTTPMethods | HTTPMethods[]) {
  return (Array.isArray(method) ? method : [method])
    .map((candidate) => candidate.toUpperCase())
    .filter((candidate): candidate is PublicMethod => publicMethods.has(candidate as PublicMethod));
}

/**
 * Records the real Fastify routes after plugin registration. Tests compare this inventory with the
 * generated document, so adding an endpoint without a contract fails closed.
 */
export function attachPublicRouteInventory(app: FastifyInstance) {
  const inventory = new Map<string, PublicRouteInventoryItem>();
  publicRouteInventory.set(app, inventory);
  app.addHook("onRoute", (route) => {
    if (!isPublicUrl(route.url)) return;
    const unsupportedMethods = (Array.isArray(route.method) ? route.method : [route.method])
      .map((method) => method.toUpperCase())
      .filter((method) => !publicMethods.has(method as PublicMethod));
    if (unsupportedMethods.length > 0) {
      throw new Error(
        `Public route uses undocumented HTTP methods: ${unsupportedMethods.join(", ")} ${route.url}`,
      );
    }
    for (const method of routeMethods(route.method)) {
      const item = { method, url: route.url };
      const key = routeKey(method, route.url);
      if (!operations.has(key)) {
        throw new Error(`Public route is missing an OpenAPI contract: ${key}`);
      }
      inventory.set(key, item);
    }
  });
}

export function getPublicRouteInventory(app: FastifyInstance) {
  return [...(publicRouteInventory.get(app)?.values() ?? [])].sort((left, right) =>
    routeKey(left.method, left.url).localeCompare(routeKey(right.method, right.url)),
  );
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties),
): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}

function arraySchema(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

const uuidSchema: JsonSchema = { type: "string", format: "uuid" };
const dateTimeJsonSchema: JsonSchema = { type: "string", format: "date-time" };
const nonNegativeIntegerSchema: JsonSchema = { type: "integer", minimum: 0 };
const jsonObjectJsonSchema: JsonSchema = { type: "object", additionalProperties: true };
const jsonValueJsonSchema: JsonSchema = {
  oneOf: [
    jsonObjectJsonSchema,
    { type: "array" },
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

function zodSchema(schema: ZodTypeAny): JsonSchema {
  const converted = zodToJsonSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
    target: "jsonSchema7",
  }) as JsonSchema;
  const { $schema: _dialect, definitions: _definitions, ...jsonSchema } = converted;
  return jsonSchema;
}

function columnSchema(column: {
  columnType: string;
  dataType: string;
  enumValues?: string[];
  notNull: boolean;
}): JsonSchema {
  let schema: JsonSchema;
  if (column.enumValues && column.enumValues.length > 0) {
    schema = { type: "string", enum: column.enumValues };
  } else if (column.columnType === "PgUUID") {
    schema = uuidSchema;
  } else {
    switch (column.dataType) {
      case "boolean":
        schema = { type: "boolean" };
        break;
      case "date":
        schema = dateTimeJsonSchema;
        break;
      case "number":
        schema = { type: "number" };
        if (column.columnType.includes("Integer") || column.columnType.includes("BigInt")) {
          schema = { type: "integer" };
        }
        break;
      case "json":
        schema = jsonValueJsonSchema;
        break;
      case "string":
        schema = { type: "string" };
        break;
      default:
        throw new Error(
          `Unsupported Drizzle column data type in OpenAPI registry: ${column.dataType}`,
        );
    }
  }
  return column.notNull ? schema : nullable(schema);
}

function tableSchema(
  table: PgTable,
  options: { omit?: string[]; override?: Record<string, JsonSchema> } = {},
): JsonSchema {
  const omitted = new Set(options.omit ?? []);
  const properties = Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([name]) => !omitted.has(name))
      .map(([name, column]) => [
        name,
        options.override?.[name] ??
          columnSchema(
            column as unknown as {
              columnType: string;
              dataType: string;
              enumValues?: string[];
              notNull: boolean;
            },
          ),
      ]),
  );
  return objectSchema(properties);
}

function dataEnvelope(data: JsonSchema, meta?: JsonSchema): JsonSchema {
  return objectSchema({ data, ...(meta ? { meta } : {}) }, meta ? ["data", "meta"] : ["data"]);
}

const paginationMetaSchema = objectSchema(
  {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: nonNegativeIntegerSchema,
    pageCount: nonNegativeIntegerSchema,
    search: { type: "string" },
    status: { type: "string" },
    category: { type: "string" },
    resourceType: { type: "string" },
    action: { type: "string" },
  },
  ["page", "pageSize", "total", "pageCount"],
);

function paginatedEnvelope(item: JsonSchema): JsonSchema {
  return dataEnvelope(arraySchema(item), paginationMetaSchema);
}

export const OPENAPI_ERROR_SCHEMA: JsonSchema = {
  description: "Uniform API error envelope",
  ...objectSchema({
    error: objectSchema(
      {
        code: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        details: jsonObjectJsonSchema,
        requestId: { type: "string", minLength: 1 },
      },
      ["code", "message", "requestId"],
    ),
  }),
};

const idParamsSchema = zodSchema(z.object({ id: idSchema }));
const advisorParamsSchema = zodSchema(z.object({ key: advisorKeySchema }));
const integrationParamsSchema = zodSchema(integrationIdParamsSchema);
const archiveQuerySchema = zodSchema(resourceArchiveQuerySchema);
const fileArchiveQueryJsonSchema = zodSchema(fileArchiveQuerySchema);
const auditListQuerySchema = zodSchema(auditEventListQuerySchema);
const listQueryJsonSchema = zodSchema(listQuerySchema);

const resourceTables: Record<ResourceName, PgTable> = {
  objectives,
  projects,
  tasks,
  decisions,
  obligations,
  "compliance-items": complianceItems,
  "compliance-events": complianceEvents,
  risks,
  contracts,
  "financial-entries": financialEntries,
  invoices,
  "cash-flow": cashFlowEntries,
  products,
  opportunities,
  "github-insights": githubInsights,
  notifications,
  "workflow-definitions": workflowDefinitions,
  "workflow-runs": workflowRuns,
};

function resourceRecordSchema(resource: ResourceName) {
  const table = resourceTables[resource];
  const record = tableSchema(table) as { properties: Record<string, JsonSchema> };
  const input = zodSchema(resourceContracts[resource]) as {
    properties?: Record<string, JsonSchema>;
  };
  const columns = getTableColumns(table);
  for (const [name, schema] of Object.entries(input.properties ?? {})) {
    const column = columns[name];
    if (!column || !record.properties[name]) continue;
    record.properties[name] = column.notNull ? schema : nullable(schema);
  }
  return objectSchema(record.properties);
}

const operations = new Map<string, OperationContract>();

function addOperation(
  method: PublicMethod,
  url: string,
  operation: Omit<OperationContract, "success"> & {
    success: Record<number | string, JsonSchema>;
  },
) {
  const key = routeKey(method, url);
  if (operations.has(key)) throw new Error(`Duplicate OpenAPI operation contract: ${key}`);
  operations.set(key, {
    ...operation,
    success: Object.fromEntries(
      Object.entries(operation.success).map(([status, schema]) => [String(status), schema]),
    ),
  });
}

addOperation("GET", "/health", {
  operationId: "getHealth",
  anonymous: true,
  success: {
    200: dataEnvelope(
      objectSchema({
        status: { type: "string", const: "ok" },
        service: { type: "string", const: "api" },
        timestamp: dateTimeJsonSchema,
      }),
    ),
  },
});
addOperation("GET", "/health/live", {
  operationId: "getLiveness",
  anonymous: true,
  success: {
    200: dataEnvelope(objectSchema({ status: { type: "string", const: "alive" } })),
  },
});
const readinessChecksSchema = objectSchema({
  database: { type: "string", enum: ["ready", "unavailable"] },
  queue: { type: "string", enum: ["ready", "unavailable"] },
  objectStorage: { type: "string", enum: ["ready", "unavailable"] },
});
addOperation("GET", "/health/ready", {
  operationId: "getReadiness",
  anonymous: true,
  success: {
    200: dataEnvelope(
      objectSchema({ status: { type: "string", const: "ready" }, checks: readinessChecksSchema }),
    ),
    503: dataEnvelope(
      objectSchema({
        status: { type: "string", const: "not_ready" },
        checks: readinessChecksSchema,
      }),
    ),
  },
});

const authUserSchema = objectSchema({
  id: uuidSchema,
  email: { type: "string", format: "email" },
  displayName: { type: "string" },
});
const authSessionSchema = objectSchema({
  user: authUserSchema,
  orgId: uuidSchema,
  permissions: arraySchema({ type: "string" }),
  roles: arraySchema({ type: "string" }),
  role: nullable({ type: "string" }),
  mustChangePassword: { type: "boolean" },
  expiresAt: dateTimeJsonSchema,
});
addOperation("POST", "/api/v1/auth/login", {
  operationId: "login",
  anonymous: true,
  body: zodSchema(loginSchema),
  success: { 200: dataEnvelope(authSessionSchema) },
});
addOperation("POST", "/api/v1/auth/logout", {
  operationId: "logout",
  success: {
    200: dataEnvelope(objectSchema({ loggedOut: { type: "boolean", const: true } })),
  },
});
addOperation("POST", "/api/v1/auth/change-password", {
  operationId: "changePassword",
  body: zodSchema(changePasswordSchema),
  success: {
    200: dataEnvelope(
      objectSchema({
        changed: { type: "boolean", const: true },
        revokedOtherSessions: nonNegativeIntegerSchema,
      }),
    ),
  },
});
addOperation("GET", "/api/v1/auth/me", {
  operationId: "getCurrentUser",
  success: {
    200: dataEnvelope(
      objectSchema({
        user: objectSchema({
          id: uuidSchema,
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          status: { type: "string" },
        }),
        orgId: uuidSchema,
        permissions: arraySchema({ type: "string" }),
        roles: arraySchema({ type: "string" }),
        role: nullable({ type: "string" }),
        mustChangePassword: { type: "boolean" },
      }),
    ),
  },
});

function resourceOperationName(prefix: string, resource: ResourceName) {
  return `${prefix}${resource
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}`;
}

for (const resource of Object.keys(resourceContracts) as ResourceName[]) {
  const url = `/api/v1/${resource}`;
  const record = resourceRecordSchema(resource);
  addOperation("GET", url, {
    operationId: resourceOperationName("list", resource),
    querystring: listQueryJsonSchema,
    success: { 200: paginatedEnvelope(record) },
  });
  addOperation("POST", url, {
    operationId: resourceOperationName("create", resource),
    body: zodSchema(resourceContracts[resource]),
    success: { 201: dataEnvelope(record) },
  });
  addOperation("GET", `${url}/:id`, {
    operationId: resourceOperationName("get", resource),
    params: idParamsSchema,
    success: { 200: dataEnvelope(record) },
  });
  addOperation("PATCH", `${url}/:id`, {
    operationId: resourceOperationName("update", resource),
    params: idParamsSchema,
    body: zodSchema(updateSchemaFor(resource)),
    success: { 200: dataEnvelope(record) },
  });
  addOperation("DELETE", `${url}/:id`, {
    operationId: resourceOperationName("archive", resource),
    params: idParamsSchema,
    querystring: archiveQuerySchema,
    success: { 200: dataEnvelope(record) },
  });
}

addOperation("POST", "/api/v1/notifications/:id/read", {
  operationId: "markNotificationRead",
  params: idParamsSchema,
  body: zodSchema(notificationMarkReadSchema),
  success: { 200: dataEnvelope(tableSchema(notifications)) },
});

const dashboardSchema = objectSchema({
  summary: objectSchema({
    activeObjectives: nullable(nonNegativeIntegerSchema),
    openTasks: nullable(nonNegativeIntegerSchema),
    overdueObligations: nullable(nonNegativeIntegerSchema),
    openRisks: nullable(nonNegativeIntegerSchema),
    pendingApprovals: nullable(nonNegativeIntegerSchema),
    activeContracts: nullable(nonNegativeIntegerSchema),
  }),
  cashFlow: nullable(
    objectSchema({
      inCents: { type: "integer" },
      outCents: { type: "integer" },
      netCents: { type: "integer" },
      currency: { type: "string", const: "CNY" },
    }),
  ),
  urgentTasks: arraySchema(tableSchema(tasks)),
  upcomingObligations: arraySchema(tableSchema(obligations)),
  generatedAt: dateTimeJsonSchema,
});
addOperation("GET", "/api/v1/dashboard", {
  operationId: "getDashboard",
  success: { 200: dataEnvelope(dashboardSchema) },
});
addOperation("GET", "/api/v1/audit-events", {
  operationId: "listAuditEvents",
  querystring: auditListQuerySchema,
  success: { 200: paginatedEnvelope(tableSchema(auditEvents)) },
});
addOperation("GET", "/api/v1/audit-events/:id", {
  operationId: "getAuditEvent",
  params: idParamsSchema,
  success: { 200: dataEnvelope(tableSchema(auditEvents)) },
});

const approvalRecordSchema = tableSchema(approvals);
addOperation("GET", "/api/v1/approvals", {
  operationId: "listApprovals",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(approvalRecordSchema) },
});
addOperation("POST", "/api/v1/approvals", {
  operationId: "createApproval",
  body: zodSchema(approvalRequestSchema),
  success: { 201: dataEnvelope(approvalRecordSchema) },
});
addOperation("GET", "/api/v1/approvals/:id", {
  operationId: "getApproval",
  params: idParamsSchema,
  success: { 200: dataEnvelope(approvalRecordSchema) },
});
for (const decision of ["approve", "reject"] as const) {
  addOperation("POST", `/api/v1/approvals/:id/${decision}`, {
    operationId: `${decision}Approval`,
    params: idParamsSchema,
    body: zodSchema(approvalDecisionSchema),
    success: { 200: dataEnvelope(approvalRecordSchema) },
  });
}

const externalActionRecordSchema = tableSchema(externalActions);
addOperation("GET", "/api/v1/external-actions", {
  operationId: "listExternalActions",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(externalActionRecordSchema) },
});
addOperation("POST", "/api/v1/external-actions", {
  operationId: "createExternalAction",
  body: zodSchema(externalActionCreateSchema),
  success: {
    200: dataEnvelope(externalActionRecordSchema),
    201: dataEnvelope(externalActionRecordSchema),
  },
});
addOperation("GET", "/api/v1/external-actions/:id", {
  operationId: "getExternalAction",
  params: idParamsSchema,
  success: { 200: dataEnvelope(externalActionRecordSchema) },
});
addOperation("POST", "/api/v1/external-actions/:id/transition", {
  operationId: "transitionExternalAction",
  params: idParamsSchema,
  body: zodSchema(externalActionTransitionSchema),
  success: { 200: dataEnvelope(externalActionRecordSchema) },
});

const fileRecordSchema = tableSchema(files);
const fileUpdateJsonSchema = zodSchema(fileUpdateSchema);
addOperation("GET", "/api/v1/files", {
  operationId: "listFiles",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(fileRecordSchema) },
});
addOperation("POST", "/api/v1/files", {
  operationId: "createFile",
  body: zodSchema(fileCreateSchema),
  success: {
    201: dataEnvelope(
      objectSchema({
        file: fileRecordSchema,
        upload: objectSchema({
          storageKey: { type: "string" },
          uploadUrl: { type: "string" },
          method: { type: "string", const: "PUT" },
          requiredHeaders: objectSchema({
            "content-type": { type: "string", const: "application/octet-stream" },
          }),
        }),
      }),
    ),
  },
});
addOperation("PUT", "/api/v1/files/:id/content", {
  operationId: "uploadFileContent",
  params: idParamsSchema,
  consumes: ["application/octet-stream"],
  headers: objectSchema({
    "content-length": {
      type: "integer",
      minimum: 1,
      maximum: MAX_FILE_SIZE_BYTES,
    },
  }),
  body: { type: "string", format: "binary", minLength: 1 },
  success: { 201: dataEnvelope(fileRecordSchema) },
});
addOperation("GET", "/api/v1/files/:id", {
  operationId: "getFile",
  params: idParamsSchema,
  success: { 200: dataEnvelope(fileRecordSchema) },
});
addOperation("PATCH", "/api/v1/files/:id", {
  operationId: "updateFile",
  params: idParamsSchema,
  body: fileUpdateJsonSchema,
  success: { 200: dataEnvelope(fileRecordSchema) },
});
addOperation("POST", "/api/v1/files/:id/complete", {
  operationId: "completeFileUpload",
  params: idParamsSchema,
  success: { 200: dataEnvelope(fileRecordSchema) },
});
addOperation("GET", "/api/v1/files/:id/download", {
  operationId: "downloadFile",
  params: idParamsSchema,
  success: {
    200: {
      description: "File content",
      content: {
        "application/octet-stream": { schema: { type: "string", format: "binary" } },
      },
    },
  },
});
addOperation("DELETE", "/api/v1/files/:id", {
  operationId: "archiveFile",
  params: idParamsSchema,
  querystring: fileArchiveQueryJsonSchema,
  success: { 200: dataEnvelope(fileRecordSchema) },
});

const promptVersionRecordSchema = tableSchema(promptVersions);
const promptVersionCreateJsonSchema = zodSchema(promptVersionCreateSchema);
const advisorDefinitionSchema = objectSchema({
  key: zodSchema(advisorKeySchema),
  name: { type: "string" },
  purpose: { type: "string" },
  dataScopes: arraySchema({ type: "string" }),
  requiredPermission: { type: "string" },
  promptVersion: nullable(
    objectSchema({
      advisorKey: zodSchema(advisorKeySchema),
      versionNumber: { type: "integer", minimum: 1 },
      updatedAt: dateTimeJsonSchema,
      dataScopes: arraySchema({ type: "string" }),
    }),
  ),
});
addOperation("GET", "/api/v1/advisors", {
  operationId: "listAdvisors",
  success: { 200: dataEnvelope(arraySchema(advisorDefinitionSchema)) },
});
addOperation("GET", "/api/v1/advisors/:key/prompt-versions", {
  operationId: "listAdvisorPromptVersions",
  params: advisorParamsSchema,
  success: { 200: dataEnvelope(arraySchema(promptVersionRecordSchema)) },
});
addOperation("POST", "/api/v1/advisors/:key/prompt-versions", {
  operationId: "createAdvisorPromptVersion",
  params: advisorParamsSchema,
  body: promptVersionCreateJsonSchema,
  success: { 201: dataEnvelope(promptVersionRecordSchema) },
});
const advisorRunRecordSchema = tableSchema(advisorRuns, {
  override: {
    contextRefs: arraySchema(
      objectSchema({ resourceType: { type: "string" }, resourceId: uuidSchema }),
    ),
    contextSnapshot: arraySchema(jsonObjectJsonSchema),
    output: nullable(zodSchema(advisorOutputSchema)),
  },
});
addOperation("GET", "/api/v1/advisor-runs", {
  operationId: "listAdvisorRuns",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(advisorRunRecordSchema) },
});
addOperation("POST", "/api/v1/advisor-runs", {
  operationId: "createAdvisorRun",
  body: zodSchema(advisorRunCreateSchema),
  success: { 201: dataEnvelope(advisorRunRecordSchema) },
});
const advisorRunAuditSchema = (() => {
  const run = advisorRunRecordSchema as {
    properties: Record<string, JsonSchema>;
    required: string[];
  };
  return objectSchema({
    ...run.properties,
    modelCalls: arraySchema(tableSchema(advisorModelCalls)),
    toolCalls: arraySchema(tableSchema(advisorToolCalls)),
    citations: arraySchema(tableSchema(advisorCitations)),
    edits: arraySchema(tableSchema(advisorEdits)),
  });
})();
addOperation("GET", "/api/v1/advisor-runs/:id", {
  operationId: "getAdvisorRun",
  params: idParamsSchema,
  success: { 200: dataEnvelope(advisorRunAuditSchema) },
});
addOperation("PATCH", "/api/v1/advisor-runs/:id", {
  operationId: "editAdvisorRun",
  params: idParamsSchema,
  body: zodSchema(advisorRunEditSchema),
  success: { 200: dataEnvelope(advisorRunRecordSchema) },
});

const organizationMemberSchema = objectSchema({
  id: uuidSchema,
  membershipId: uuidSchema,
  email: { type: "string", format: "email" },
  displayName: { type: "string" },
  userStatus: { type: "string" },
  membershipStatus: { type: "string" },
  pendingLifecycleAction: nullable({
    type: "string",
    enum: ["deactivate", "offboard", "reactivate"],
  }),
  pendingLifecycleApprovalId: nullable(uuidSchema),
  version: { type: "integer", minimum: 1 },
  createdAt: dateTimeJsonSchema,
});
const userCreateJsonSchema = zodSchema(userCreateSchema);
const userUpdateJsonSchema = zodSchema(userUpdateSchema);
addOperation("GET", "/api/v1/users", {
  operationId: "listUsers",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(organizationMemberSchema) },
});
addOperation("POST", "/api/v1/users", {
  operationId: "createUser",
  body: userCreateJsonSchema,
  success: {
    201: dataEnvelope(
      objectSchema({
        user: authUserSchema,
        membership: tableSchema(memberships),
        approval: approvalRecordSchema,
      }),
    ),
  },
});
addOperation("PATCH", "/api/v1/users/:id", {
  operationId: "updateUser",
  params: idParamsSchema,
  body: userUpdateJsonSchema,
  success: {
    200: dataEnvelope(
      objectSchema({
        id: uuidSchema,
        email: { type: "string", format: "email" },
        displayName: { type: "string" },
        status: { type: "string" },
        lastLoginAt: nullable(dateTimeJsonSchema),
        createdAt: dateTimeJsonSchema,
        updatedAt: dateTimeJsonSchema,
        version: { type: "integer", minimum: 1 },
      }),
    ),
  },
});
const membershipLifecycleResponseSchema = dataEnvelope(
  approvalRecordSchema,
  objectSchema({ replay: { type: "boolean" } }),
);
addOperation("POST", "/api/v1/users/:id/lifecycle", {
  operationId: "requestMembershipLifecycle",
  params: idParamsSchema,
  body: zodSchema(membershipLifecycleRequestSchema),
  success: {
    200: membershipLifecycleResponseSchema,
    201: membershipLifecycleResponseSchema,
  },
});
addOperation("POST", "/api/v1/compliance-items/:id/monitor", {
  operationId: "monitorComplianceItemSource",
  params: idParamsSchema,
  body: zodSchema(complianceMonitorRequestSchema),
  bodyRequired: false,
  success: {
    202: dataEnvelope(
      objectSchema({
        sourceId: uuidSchema,
        jobId: { type: "string", minLength: 1 },
        status: { type: "string", const: "queued" },
      }),
    ),
  },
});
addOperation("GET", "/api/v1/compliance-items/monitoring-status", {
  operationId: "getComplianceMonitoringStatus",
  success: { 200: dataEnvelope(zodSchema(complianceMonitoringStatusSchema)) },
});
addOperation("GET", "/api/v1/compliance-items/:id/snapshots", {
  operationId: "listComplianceItemSnapshots",
  params: idParamsSchema,
  querystring: zodSchema(complianceSnapshotListQuerySchema),
  success: { 200: paginatedEnvelope(tableSchema(complianceSourceSnapshots)) },
});
const complianceReviewHistoryRecordSchema = objectSchema({
  id: uuidSchema,
  sourceId: uuidSchema,
  recordedByUserId: nullable(uuidSchema),
  recordedByDisplayName: nullable({ type: "string" }),
  recordedAt: dateTimeJsonSchema,
  reviewOutcome: {
    type: "string",
    enum: ["applicable", "not_applicable", "changes_required", "insufficient_information"],
  },
  resultingStatus: {
    type: "string",
    enum: ["active", "superseded", "repealed", "uncertain"],
  },
  reviewerName: { type: "string" },
  reviewerRole: { type: "string" },
  reviewerOrganization: { type: "string" },
  reviewerQualification: { type: "string" },
  evidenceFileId: uuidSchema,
  applicability: { type: "string" },
  summary: { type: "string" },
  missingInformation: { type: "string" },
  reason: { type: "string" },
  reviewedAt: dateTimeJsonSchema,
  nextReviewAt: dateTimeJsonSchema,
  reviewedSourceVersion: { type: "integer", minimum: 1 },
  reviewedContentHash: nullable({ type: "string" }),
  reviewedMetadataHash: nullable({ type: "string" }),
});
addOperation("GET", "/api/v1/compliance-items/:id/reviews", {
  operationId: "listComplianceItemProfessionalReviews",
  params: idParamsSchema,
  querystring: zodSchema(complianceReviewListQuerySchema),
  success: { 200: paginatedEnvelope(complianceReviewHistoryRecordSchema) },
});
addOperation("POST", "/api/v1/compliance-items/:id/reviews", {
  operationId: "createComplianceItemProfessionalReview",
  params: idParamsSchema,
  body: zodSchema(complianceProfessionalReviewSchema),
  success: {
    201: dataEnvelope(
      tableSchema(complianceItems),
      objectSchema({ reviewId: uuidSchema }, ["reviewId"]),
    ),
  },
});
const roleRecordSchema = (() => {
  const role = tableSchema(roles) as { properties: Record<string, JsonSchema> };
  return objectSchema({
    ...role.properties,
    permissions: arraySchema({ type: "string" }),
  });
})();
addOperation("GET", "/api/v1/roles", {
  operationId: "listRoles",
  success: { 200: dataEnvelope(arraySchema(roleRecordSchema)) },
});
addOperation("POST", "/api/v1/role-assignments", {
  operationId: "createRoleAssignment",
  body: zodSchema(roleAssignmentSchema),
  success: { 201: dataEnvelope(approvalRecordSchema) },
});
addOperation("POST", "/api/v1/github-insights/:id/refresh", {
  operationId: "refreshGithubInsight",
  params: idParamsSchema,
  success: {
    202: dataEnvelope(
      objectSchema({
        insightId: uuidSchema,
        repository: { type: "string" },
        status: { type: "string", const: "queued" },
      }),
    ),
  },
});
const integrationDefinitionSchema = objectSchema({
  id: { type: "string", enum: integrationDefinitions.map((definition) => definition.id) },
  name: { type: "string" },
  category: { type: "string" },
  mode: { type: "string", enum: ["real", "manual", "read_only", "mock", "disabled"] },
  capabilities: arraySchema({ type: "string" }),
  status: { type: "string" },
  lastCheckedAt: nullable(dateTimeJsonSchema),
});
addOperation("GET", "/api/v1/settings/integrations", {
  operationId: "listIntegrations",
  success: { 200: dataEnvelope(arraySchema(integrationDefinitionSchema)) },
});
addOperation("POST", "/api/v1/settings/integrations/:id/test", {
  operationId: "testIntegration",
  params: integrationParamsSchema,
  success: { 200: dataEnvelope(tableSchema(integrationChecks)) },
});
const backupRecordSchema = tableSchema(backups);
addOperation("GET", "/api/v1/backups", {
  operationId: "listBackups",
  querystring: listQueryJsonSchema,
  success: { 200: paginatedEnvelope(backupRecordSchema) },
});
addOperation("POST", "/api/v1/backups", {
  operationId: "createBackup",
  bodyRequired: false,
  body: zodSchema(backupCreateSchema),
  success: { 202: dataEnvelope(backupRecordSchema) },
});

export function listOpenApiContracts() {
  return [...operations.entries()]
    .map(([key, operation]) => ({ key, operation }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function methodForRoute(route: RouteOptions) {
  const methods = routeMethods(route.method);
  return methods.length === 1 ? methods[0] : undefined;
}

/** @fastify/swagger transform: enrich documentation without changing runtime validators/serializers. */
export function openApiTransform(input: {
  schema: FastifySchema;
  url: string;
  route: RouteOptions;
}) {
  if (!isPublicUrl(input.url)) return { schema: input.schema, url: input.url };
  const method = methodForRoute(input.route);
  if (!method) return { schema: input.schema, url: input.url };
  const operation = operations.get(routeKey(method, input.url));
  if (!operation) {
    throw new Error(`Public route is missing an OpenAPI contract: ${routeKey(method, input.url)}`);
  }
  return {
    url: input.url,
    schema: {
      ...input.schema,
      operationId: operation.operationId,
      security: operation.anonymous ? [] : [{ cookieAuth: [] }],
      ...(operation.params ? { params: operation.params } : {}),
      ...(operation.querystring ? { querystring: operation.querystring } : {}),
      ...(operation.body ? { body: operation.body } : {}),
      ...(operation.consumes ? { consumes: operation.consumes } : {}),
      ...(operation.headers ? { headers: operation.headers } : {}),
      response: {
        ...operation.success,
        "4XX": OPENAPI_ERROR_SCHEMA,
        "5XX": OPENAPI_ERROR_SCHEMA,
      },
    } as FastifySchema,
  };
}

interface GeneratedOpenApiOperation {
  requestBody?: { required?: boolean };
  responses?: Record<string, unknown>;
}

interface GeneratedOpenApiDocument {
  paths?: Record<string, Record<string, GeneratedOpenApiOperation>>;
}

function openApiPath(url: string) {
  return url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Final OpenAPI-only normalization for semantics Fastify's route schema cannot express. */
export const openApiTransformObject: fastifySwagger.SwaggerTransformObject = (input) => {
  if (!("openapiObject" in input)) return input.swaggerObject;
  const document = input.openapiObject as unknown as GeneratedOpenApiDocument;
  if (!document.paths) return input.openapiObject;

  for (const [key, contract] of operations) {
    const separator = key.indexOf(" ");
    const method = key.slice(0, separator).toLowerCase();
    const url = key.slice(separator + 1);
    const operation = document.paths[openApiPath(url)]?.[method];
    if (!operation?.responses) continue;
    const errorResponse = {
      description: "Uniform API error envelope",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
      },
    };
    operation.responses["4XX"] = errorResponse;
    operation.responses["5XX"] = errorResponse;
    if (contract.body && contract.bodyRequired === false && operation.requestBody) {
      operation.requestBody.required = false;
    }
  }
  return input.openapiObject;
};
