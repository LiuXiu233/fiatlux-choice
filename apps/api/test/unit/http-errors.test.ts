import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerErrorHandler } from "../../src/http-errors.js";

describe("HTTP error handling", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("preserves malformed JSON as a sanitized 400 response", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.post("/json", async () => ({ data: true }));
    registerErrorHandler(app);

    const response = await app.inject({
      method: "POST",
      url: "/json",
      headers: { "content-type": "application/json" },
      payload: '{"broken":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED", message: "Request validation failed" },
    });
  });

  it("preserves parser body limits as a sanitized 413 response", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: 4 },
      (_request, payload, done) => done(null, payload),
    );
    app.put("/binary", async () => ({ data: true }));
    registerErrorHandler(app);

    const response = await app.inject({
      method: "PUT",
      url: "/binary",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("12345"),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" },
    });
  });

  it("maps a wrapped pre-connect database failure to a sanitized 503", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.get("/database", async () => {
      const connectionError = Object.assign(new Error("private postgres endpoint"), {
        code: "CONNECT_TIMEOUT",
      });
      throw new Error("wrapped query failed", { cause: connectionError });
    });
    registerErrorHandler(app);

    const response = await app.inject({ method: "GET", url: "/database" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required service is temporarily unavailable",
      },
    });
    expect(response.body).not.toContain("private postgres endpoint");
  });

  it("marks a mid-query connection loss as outcome-unknown instead of safe-to-retry", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.post("/database", async () => {
      throw Object.assign(new Error("private statement text"), { code: "EPIPE" });
    });
    registerErrorHandler(app);

    const response = await app.inject({ method: "POST", url: "/database" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_OUTCOME_UNKNOWN",
        message: expect.stringMatching(/verify the request outcome/i),
      },
    });
    expect(response.body).not.toContain("private statement text");
  });

  it("keeps queries attempted after application shutdown as an internal lifecycle error", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.get("/database", async () => {
      throw Object.assign(new Error("database client already ended"), {
        code: "CONNECTION_ENDED",
      });
    });
    registerErrorHandler(app);

    const response = await app.inject({ method: "GET", url: "/database" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(response.body).not.toContain("database client already ended");
  });
});
