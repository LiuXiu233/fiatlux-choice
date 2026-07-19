import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/index.js";

const unusedDatabaseUrl = "postgresql://unused:unused@127.0.0.1:1/unused";

describe("database connection posture", () => {
  it("keeps a small named pool warm instead of retiring it between human requests", async () => {
    const { client } = createDatabase(unusedDatabaseUrl, {
      applicationName: "fiatlux-api-test",
      connectTimeoutSeconds: 12,
      maxConnections: 3,
    });
    try {
      expect(client.options.max).toBe(3);
      expect(client.options.connect_timeout).toBe(12);
      expect(client.options.idle_timeout).toBe(0);
      expect(client.options.keep_alive).toBe(30);
      expect(client.options.connection.application_name).toBe("fiatlux-api-test");
      expect(client.options.prepare).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("rejects unsafe or ambiguous pool configuration before opening a socket", () => {
    expect(() => createDatabase(unusedDatabaseUrl, { maxConnections: 0 })).toThrow(
      /max connections/,
    );
    expect(() => createDatabase(unusedDatabaseUrl, { connectTimeoutSeconds: 61 })).toThrow(
      /connect timeout/,
    );
    expect(() => createDatabase(unusedDatabaseUrl, { idleTimeoutSeconds: -1 })).toThrow(
      /idle timeout/,
    );
    expect(() => createDatabase(unusedDatabaseUrl, { maxLifetimeSeconds: 59 })).toThrow(
      /max lifetime/,
    );
    expect(() => createDatabase(unusedDatabaseUrl, { applicationName: "api with spaces" })).toThrow(
      /application name/,
    );
  });
});
