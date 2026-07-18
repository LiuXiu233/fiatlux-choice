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
});
