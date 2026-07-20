import { describe, expect, it } from "vitest";

import { formatBuildIdentity, normalizeBuildInfo } from "./build-info";

describe("PWA build identity", () => {
  it("formats a release version and immutable Git SHA for device upgrade evidence", () => {
    const info = normalizeBuildInfo("v1.0.0-rc.2", "25204d34d865b16941d099658d33fbb561424f09");
    expect(info).toEqual({
      version: "v1.0.0-rc.2",
      gitSha: "25204d34d865b16941d099658d33fbb561424f09",
    });
    expect(formatBuildIdentity(info)).toBe("构建 v1.0.0-rc.2 · 25204d3");
  });

  it("fails visibly to the development identity for malformed build metadata", () => {
    const info = normalizeBuildInfo("latest", "not-a-commit");
    expect(info).toEqual({ version: "development", gitSha: "development" });
    expect(formatBuildIdentity(info)).toBe("构建 development · dev");
  });

  it("rejects partial release identities instead of displaying a misleading mixed identity", () => {
    expect(normalizeBuildInfo("v1.0.0", "development")).toEqual({
      version: "development",
      gitSha: "development",
    });
    expect(normalizeBuildInfo("local", "b".repeat(40))).toEqual({
      version: "development",
      gitSha: "development",
    });
  });

  it("keeps explicit local and immutable CI identities distinct", () => {
    expect(formatBuildIdentity(normalizeBuildInfo("local", "development"))).toBe(
      "构建 local · dev",
    );
    expect(formatBuildIdentity(normalizeBuildInfo("ci", "b".repeat(40)))).toBe("构建 ci · bbbbbbb");
  });
});
