import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubDigest(byte: number) {
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(byte).buffer);
  vi.stubGlobal("crypto", { subtle: { digest } });
  return digest;
}

describe("verified export download", () => {
  it("checks required headers and the downloaded bytes before returning a file", async () => {
    const digest = stubDigest(0xab);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("verified export", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="fiatlux-audit.ndjson"',
          "Content-Type": "application/x-ndjson",
          "X-Audit-Event-Count": "3",
          "X-Content-SHA256": "ab".repeat(32),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.download("/audit-events/export", { from: "2026-07-01" });

    expect(result).toMatchObject({
      filename: "fiatlux-audit.ndjson",
      contentSha256: "ab".repeat(32),
      itemCount: 3,
    });
    expect(await result.blob.text()).toBe("verified export");
    expect(digest).toHaveBeenCalledWith("SHA-256", expect.any(ArrayBuffer));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/audit-events/export",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ from: "2026-07-01" }),
      }),
    );
  });

  it("fails closed when the response hash does not match the downloaded bytes", async () => {
    stubDigest(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("tampered export", {
          status: 200,
          headers: {
            "Content-Disposition": 'attachment; filename="fiatlux-audit.csv"',
            "X-Audit-Event-Count": "1",
            "X-Content-SHA256": "ff".repeat(32),
          },
        }),
      ),
    );

    await expect(api.download("/audit-events/export", {})).rejects.toMatchObject({
      code: "INTEGRITY_CHECK_FAILED",
      status: 502,
      message: "导出文件 SHA-256 校验失败，文件未保存",
    });
  });

  it("rejects a nominally successful response without trustworthy export metadata", async () => {
    stubDigest(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing headers", { status: 200 })),
    );

    await expect(api.download("/audit-events/export", {})).rejects.toMatchObject({
      code: "INTEGRITY_CHECK_FAILED",
    });
  });
});
