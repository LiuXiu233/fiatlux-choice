import SwaggerParser from "@apidevtools/swagger-parser";
import type { Database } from "@fiatlux/db";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";
import { getPublicRouteInventory, listOpenApiContracts } from "../../src/openapi.js";

type JsonObject = Record<string, unknown>;

interface OpenApiMediaType {
  schema?: JsonObject;
}

interface OpenApiResponse {
  content?: Record<string, OpenApiMediaType>;
  description?: string;
}

interface OpenApiParameter {
  in?: string;
  name?: string;
  required?: boolean;
  schema?: JsonObject;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, unknown>>;
}

interface OpenApiDocument {
  openapi?: string;
  components?: {
    schemas?: Record<string, JsonObject>;
    securitySchemes?: Record<string, JsonObject>;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

const httpMethods = ["delete", "get", "patch", "post", "put"] as const;

function fastifyUrl(openApiPath: string) {
  return openApiPath.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}

function operationKey(method: string, path: string) {
  return `${method.toUpperCase()} ${fastifyUrl(path)}`;
}

function operationAt(document: OpenApiDocument, key: string) {
  const separator = key.indexOf(" ");
  const method = key.slice(0, separator).toLowerCase();
  const path = key.slice(separator + 1).replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const operation = document.paths?.[path]?.[method];
  if (!operation) throw new Error(`OpenAPI operation is missing: ${key}`);
  return operation;
}

function schemaFromResponse(response: OpenApiResponse | undefined) {
  if (!response?.content) return undefined;
  return Object.values(response.content).find((media) => media.schema)?.schema;
}

function expectConstrainedRootSchema(schema: JsonObject | undefined) {
  expect(schema).toBeDefined();
  expect(Object.keys(schema ?? {})).not.toHaveLength(0);
  if (schema?.type === "object") {
    const properties = schema.properties;
    expect(properties).toBeTypeOf("object");
    expect(Object.keys((properties as JsonObject | undefined) ?? {})).not.toHaveLength(0);
  }
}

function schemaPropertyNames(schema: JsonObject | undefined) {
  const properties = schema?.properties;
  return Object.keys((properties as JsonObject | undefined) ?? {}).sort();
}

describe("machine-verifiable OpenAPI contract", () => {
  let app: FastifyInstance;
  let document: OpenApiDocument;

  beforeAll(async () => {
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      JWT_SECRET: "openapi-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = {
      healthCheck: async () => undefined,
      send: async () => "openapi-test-job",
    } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: {} as Database,
      storage: new MemoryObjectStorage(),
      queue,
    });
    await app.ready();
    document = app.swagger() as unknown as OpenApiDocument;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("matches every actual Fastify V1 and health route to one registry operation", () => {
    const inventoryKeys = getPublicRouteInventory(app).map(({ method, url }) => `${method} ${url}`);
    const contractKeys = listOpenApiContracts().map(({ key }) => key);
    const documentKeys = Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
      httpMethods.flatMap((method) => (pathItem[method] ? [operationKey(method, path)] : [])),
    );

    expect(inventoryKeys).toHaveLength(143);
    expect(new Set(inventoryKeys).size).toBe(143);
    expect(Object.keys(document.paths ?? {})).toHaveLength(78);
    expect(contractKeys).toEqual(inventoryKeys);
    expect(documentKeys.sort()).toEqual(inventoryKeys);
  });

  it("declares unique operation IDs, auth boundaries, requests, and typed responses", () => {
    const operationIds: string[] = [];

    for (const { key, operation: contract } of listOpenApiContracts()) {
      const operation = operationAt(document, key);
      expect(operation.operationId).toBe(contract.operationId);
      operationIds.push(operation.operationId ?? "");
      expect(operation.security).toEqual(contract.anonymous ? [] : [{ cookieAuth: [] }]);

      const pathParameterNames = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === "path")
        .map((parameter) => parameter.name);
      const expectedPathParameterNames = [...key.matchAll(/:([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
      );
      expect(pathParameterNames).toEqual(expectedPathParameterNames);
      expect(
        (operation.parameters ?? [])
          .filter((parameter) => parameter.in === "path")
          .every((parameter) => parameter.required && parameter.schema),
      ).toBe(true);

      const queryParameters = (operation.parameters ?? []).filter(
        (parameter) => parameter.in === "query",
      );
      expect(queryParameters.map((parameter) => parameter.name).sort()).toEqual(
        schemaPropertyNames(contract.querystring),
      );
      const headerParameters = (operation.parameters ?? []).filter(
        (parameter) => parameter.in === "header",
      );
      expect(headerParameters.map((parameter) => parameter.name).sort()).toEqual(
        schemaPropertyNames(contract.headers),
      );

      if (contract.body) {
        expect(operation.requestBody).toBeDefined();
        expect(operation.requestBody?.required).toBe(contract.bodyRequired !== false);
        const requestSchema = Object.values(operation.requestBody?.content ?? {})[0]?.schema;
        expectConstrainedRootSchema(requestSchema);
      } else {
        expect(operation.requestBody).toBeUndefined();
      }

      for (const status of Object.keys(contract.success)) {
        const response = operation.responses?.[status];
        expect(response?.description).toBeTypeOf("string");
        expectConstrainedRootSchema(schemaFromResponse(response));
      }

      expect(Object.keys(operation.responses ?? {}).sort()).toEqual(
        [...Object.keys(contract.success), "4XX", "5XX"].sort(),
      );

      for (const status of ["4XX", "5XX"]) {
        const response = operation.responses?.[status];
        expect(response?.content?.["application/json"]?.schema).toEqual({
          $ref: "#/components/schemas/ErrorResponse",
        });
      }
    }

    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.every((operationId) => operationId.length > 0)).toBe(true);
    expect(document.components?.securitySchemes?.cookieAuth).toEqual({
      type: "apiKey",
      in: "cookie",
      name: "fiatlux_session",
    });
    expectConstrainedRootSchema(document.components?.schemas?.ErrorResponse);
  });

  it("is a valid OpenAPI 3.1 document according to a standard parser", async () => {
    expect(document.openapi).toBe("3.1.0");
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it("keeps both machine-readable docs and Swagger UI available", async () => {
    const [json, ui] = await Promise.all([
      app.inject({ method: "GET", url: "/api/docs/json" }),
      app.inject({ method: "GET", url: "/api/docs/" }),
    ]);
    expect(json.statusCode).toBe(200);
    expect((JSON.parse(json.body) as OpenApiDocument).openapi).toBe("3.1.0");
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
  });
});
