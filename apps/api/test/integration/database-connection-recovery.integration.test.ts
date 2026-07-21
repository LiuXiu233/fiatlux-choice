import { createServer, type Server, Socket } from "node:net";

import { createDatabase } from "@fiatlux/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

function configuredDatabaseUrl() {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for this integration test");
  return databaseUrl;
}

interface TcpTarget {
  host: string;
  port: number;
}

function tcpTarget(databaseUrl: string): TcpTarget {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = parsed.port === "" ? 5432 : Number(parsed.port);

  if (host === "" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TEST_DATABASE_URL must contain a valid TCP host and port");
  }

  return { host, port };
}

function databaseUrlThroughProxy(databaseUrl: string, port: number) {
  const parsed = new URL(databaseUrl);
  parsed.hostname = "127.0.0.1";
  parsed.port = String(port);
  return parsed.toString();
}

class FirstConnectionBlackholeProxy {
  readonly server: Server;
  readonly sockets = new Set<Socket>();
  acceptedConnections = 0;

  constructor(private readonly target: TcpTarget) {
    this.server = createServer((downstream) => {
      this.track(downstream);
      this.acceptedConnections += 1;

      if (this.acceptedConnections === 1) {
        // Accept the TCP handshake, but never answer PostgreSQL startup. This exercises the
        // driver's connection deadline rather than an immediate ECONNREFUSED/ECONNRESET path.
        downstream.pause();
        return;
      }

      const upstream = new Socket();
      this.track(upstream);
      upstream.connect(this.target.port, this.target.host, () => {
        downstream.pipe(upstream);
        upstream.pipe(downstream);
        downstream.resume();
      });
      upstream.once("error", () => downstream.destroy());
      upstream.once("close", () => downstream.destroy());
      downstream.once("close", () => upstream.destroy());
    });
  }

  async listen() {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
    });

    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("TCP recovery proxy did not bind to an IPv4 port");
    }
    return address.port;
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) return;

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private track(socket: Socket) {
    this.sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => this.sockets.delete(socket));
  }
}

describe.skipIf(!databaseUrl)("long-lived database connection recovery", () => {
  let application: ReturnType<typeof createDatabase>;
  let controller: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    application = createDatabase(databaseUrl, {
      applicationName: "fiatlux-api-recovery-test",
      maxConnections: 1,
    });
    controller = createDatabase(databaseUrl, {
      applicationName: "fiatlux-api-recovery-controller",
      maxConnections: 1,
    });
  });

  afterAll(async () => {
    await application?.client.end();
    await controller?.client.end();
  });

  it("keeps the warm application connection beyond the former 20-second idle retirement", async () => {
    const first = await application.client`SELECT pg_backend_pid()::int AS pid`;
    const firstPid = Number(first[0]?.pid);
    expect(firstPid).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 21_000));

    const second = await application.client`SELECT pg_backend_pid()::int AS pid`;
    expect(Number(second[0]?.pid)).toBe(firstPid);
    await expect(application.db.execute(sql`SELECT 1`)).resolves.toBeDefined();
  }, 30_000);

  it("reconnects the same Drizzle handle after PostgreSQL closes its warm backend", async () => {
    const before = await application.client`SELECT pg_backend_pid()::int AS pid`;
    const previousPid = Number(before[0]?.pid);
    const termination = await controller.client`
      SELECT pg_terminate_backend(${previousPid}) AS terminated
    `;
    expect(termination[0]?.terminated).toBe(true);

    // Let postgres.js observe the idle socket close before sending the next application query.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(application.db.execute(sql`SELECT 1`)).resolves.toBeDefined();

    const after = await application.client`SELECT pg_backend_pid()::int AS pid`;
    const replacementPid = Number(after[0]?.pid);
    expect(replacementPid).toBeGreaterThan(0);
    expect(replacementPid).not.toBe(previousPid);
  });

  it("recovers the same Drizzle handle after a PostgreSQL startup connection timeout", async () => {
    const testDatabaseUrl = configuredDatabaseUrl();
    const proxy = new FirstConnectionBlackholeProxy(tcpTarget(testDatabaseUrl));
    const proxyPort = await proxy.listen();
    const recovering = createDatabase(databaseUrlThroughProxy(testDatabaseUrl, proxyPort), {
      applicationName: "fiatlux-api-connect-timeout-recovery",
      connectTimeoutSeconds: 1,
      maxConnections: 1,
    });

    try {
      const startedAt = performance.now();
      let initialError: unknown;
      try {
        await recovering.db.execute(sql`SELECT 1`);
      } catch (error) {
        initialError = error;
      }
      const elapsedMs = performance.now() - startedAt;

      expect(initialError).toMatchObject({ cause: { code: "CONNECT_TIMEOUT" } });
      expect(elapsedMs).toBeGreaterThanOrEqual(800);
      expect(elapsedMs).toBeLessThan(4_000);
      expect(proxy.acceptedConnections).toBe(1);

      const recovered = await recovering.db.execute(sql`SELECT 1::int AS recovered`);
      expect(recovered[0]).toMatchObject({ recovered: 1 });
      expect(proxy.acceptedConnections).toBe(2);
    } finally {
      try {
        await recovering.client.end({ timeout: 2 });
      } finally {
        await proxy.close();
      }
    }
  }, 10_000);
});
