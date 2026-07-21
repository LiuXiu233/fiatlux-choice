import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AUDIT_EXPORT_MAX_DAYS,
  type AuditExportRow,
  auditExportDateBounds,
  auditExportRequestSchema,
  protectSpreadsheetCell,
  renderAuditExport,
} from "../../src/audit-export.js";

function auditRow(overrides: Partial<AuditExportRow> = {}): AuditExportRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    orgId: "20000000-0000-4000-8000-000000000001",
    actorUserId: "30000000-0000-4000-8000-000000000001",
    action: "create",
    resourceType: "tasks",
    resourceId: "40000000-0000-4000-8000-000000000001",
    requestId: "request-1",
    before: null,
    after: { title: "训练计划" },
    metadata: { z: 2, a: 1 },
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
    createdAt: new Date("2026-07-20T01:02:03.000Z"),
    ...overrides,
  };
}

describe("audit export request", () => {
  it("uses inclusive China calendar dates and rejects invalid or oversized windows", () => {
    const request = auditExportRequestSchema.parse({
      from: "2026-07-01",
      to: "2026-07-31",
      acknowledgement: "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED",
    });
    expect(request.format).toBe("csv");
    expect(AUDIT_EXPORT_MAX_DAYS).toBe(31);
    expect(auditExportDateBounds(request)).toEqual({
      startAt: new Date("2026-06-30T16:00:00.000Z"),
      endExclusive: new Date("2026-07-31T16:00:00.000Z"),
    });

    expect(
      auditExportRequestSchema.safeParse({
        from: "2026-02-30",
        to: "2026-03-01",
        acknowledgement: "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED",
      }).success,
    ).toBe(false);
    expect(
      auditExportRequestSchema.safeParse({
        from: "2026-07-02",
        to: "2026-07-01",
        acknowledgement: "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED",
      }).success,
    ).toBe(false);
    expect(
      auditExportRequestSchema.safeParse({
        from: "2026-07-01",
        to: "2026-08-01",
        acknowledgement: "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED",
      }).success,
    ).toBe(false);
    expect(
      auditExportRequestSchema.safeParse({ from: "2026-07-01", to: "2026-07-01" }).success,
    ).toBe(false);
  });
});

describe("audit export rendering", () => {
  it("neutralizes spreadsheet formulas, quotes fields and produces a verifiable CSV hash", () => {
    const artifact = renderAuditExport(
      [
        auditRow({
          action: ' =HYPERLINK("https://example.invalid","open")',
          resourceId: "+1+1",
          userAgent: "line one\nline two",
        }),
      ],
      "csv",
    );
    const text = artifact.body.toString("utf8");

    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain('\' =HYPERLINK(""https://example.invalid"",""open"")');
    expect(text).toContain("'+1+1");
    expect(text).toContain('"metadata_json","ip_address"');
    expect(text).toContain('{""a"":1,""z"":2}');
    expect(artifact.contentType).toBe("text/csv; charset=utf-8");
    expect(artifact.sha256).toBe(createHash("sha256").update(artifact.body).digest("hex"));
  });

  it("writes one canonical NDJSON object per event without a synthetic success record", () => {
    const artifact = renderAuditExport([auditRow()], "ndjson");
    const lines = artifact.body.toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000001",
      organizationId: "20000000-0000-4000-8000-000000000001",
      action: "create",
      metadata: { a: 1, z: 2 },
      createdAt: "2026-07-20T01:02:03.000Z",
    });
    expect(renderAuditExport([], "ndjson").body.byteLength).toBe(0);
  });

  it("protects formula prefixes after control characters and whitespace", () => {
    expect(protectSpreadsheetCell("@SUM(1,2)")).toBe("'@SUM(1,2)");
    expect(protectSpreadsheetCell("\t-2+3")).toBe("'\t-2+3");
    expect(protectSpreadsheetCell("ordinary text")).toBe("ordinary text");
  });
});
