import { describe, expect, it, vi } from "vitest";

import {
  isPublicNetworkAddress,
  normalizeOfficialSourceContent,
  OfficialSourceReader,
} from "../src/official-source.js";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 as const }];

describe("official source reader", () => {
  it("normalizes HTML and computes stable hashes", async () => {
    const transport = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", etag: '"v1"' },
      body: new TextEncoder().encode(
        "<html><style>.x{color:red}</style><body> 中华人民共和国&nbsp; 公司法 <script>noise()</script></body></html>",
      ),
    }));
    const reader = new OfficialSourceReader({ resolve: publicDns, transport });

    const result = await reader.fetch({ url: "https://www.gov.cn/policy" });

    expect(result).toMatchObject({
      finalUrl: "https://www.gov.cn/policy",
      httpStatus: 200,
      normalizedExcerpt: "中华人民共和国 公司法",
      notModified: false,
      etag: '"v1"',
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.normalizedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        address: { address: "93.184.216.34", family: 4 },
        headers: expect.objectContaining({ "accept-encoding": "identity" }),
      }),
    );
  });

  it("pins and revalidates every allowed redirect hop", async () => {
    const resolve = vi.fn(publicDns);
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: "https://www.cac.gov.cn/rules" },
        body: new Uint8Array(),
      })
      .mockResolvedValueOnce({
        status: 304,
        headers: { etag: '"same"' },
        body: new Uint8Array(),
      });
    const reader = new OfficialSourceReader({ resolve, transport });

    const result = await reader.fetch({
      url: "http://www.gov.cn/old",
      etag: '"prior"',
    });

    expect(result).toMatchObject({
      finalUrl: "https://www.cac.gov.cn/rules",
      notModified: true,
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]?.[0].headers).not.toHaveProperty("if-none-match");
  });

  it("rejects non-allowlisted URLs, credential URLs, unsafe ports and redirects", async () => {
    const reader = new OfficialSourceReader({
      resolve: publicDns,
      transport: async () => ({
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
        body: new Uint8Array(),
      }),
    });

    await expect(reader.fetch({ url: "https://example.com" })).rejects.toThrow("allowlisted");
    await expect(reader.fetch({ url: "https://user:pass@www.gov.cn" })).rejects.toThrow(
      "credentials",
    );
    await expect(reader.fetch({ url: "https://www.gov.cn:8443" })).rejects.toThrow("port");
    await expect(reader.fetch({ url: "https://www.gov.cn" })).rejects.toThrow("allowlisted");
  });

  it("rejects any DNS response containing a private or reserved address", async () => {
    const reader = new OfficialSourceReader({
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
      transport: async () => {
        throw new Error("transport must not run");
      },
    });

    await expect(reader.fetch({ url: "https://www.gov.cn" })).rejects.toThrow("non-public");
  });

  it("classifies representative network ranges conservatively", () => {
    expect(isPublicNetworkAddress("8.8.8.8")).toBe(true);
    expect(isPublicNetworkAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.2.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    ]) {
      expect(isPublicNetworkAddress(address), address).toBe(false);
    }
  });

  it("fails closed when a server ignores identity encoding and returns compressed bytes", async () => {
    const reader = new OfficialSourceReader({
      resolve: publicDns,
      transport: async () => ({
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
        },
        body: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
      }),
    });

    await expect(reader.fetch({ url: "https://www.gov.cn/policy" })).rejects.toThrow(
      "compressed content",
    );
  });

  it("bounds DNS resolution with the same overall request deadline", async () => {
    const reader = new OfficialSourceReader({
      timeoutMs: 10,
      resolve: async () => await new Promise<never>(() => undefined),
      transport: async () => {
        throw new Error("transport must not run after DNS timeout");
      },
    });

    await expect(reader.fetch({ url: "https://www.gov.cn/policy" })).rejects.toThrow(
      "DNS resolution timed out",
    );
  });

  it("uses raw bytes for binary normalization and removes active HTML content", () => {
    const binary = new Uint8Array([0, 1, 2, 3]);
    expect(normalizeOfficialSourceContent(binary, "application/pdf")).toBeNull();
    expect(
      normalizeOfficialSourceContent(
        new TextEncoder().encode("<p>政策</p><script>secret</script>"),
        "text/html",
      ),
    ).toBe("政策");
  });

  it("limits multibyte evidence excerpts by UTF-8 bytes without splitting a character", async () => {
    const reader = new OfficialSourceReader({
      resolve: publicDns,
      transport: async () => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: new TextEncoder().encode(`<p>${"法".repeat(60_000)}</p>`),
      }),
    });

    const result = await reader.fetch({ url: "https://www.gov.cn/large-policy" });

    expect(Buffer.byteLength(result.normalizedExcerpt ?? "", "utf8")).toBeLessThanOrEqual(100_000);
    expect(result.normalizedExcerpt).not.toContain("�");
  });
});
