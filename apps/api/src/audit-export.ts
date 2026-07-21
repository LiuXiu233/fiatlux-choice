import { createHash } from "node:crypto";
import type { auditEvents } from "@fiatlux/db";
import { z } from "zod";

export const AUDIT_EXPORT_MAX_DAYS = 31;
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_EXPORT_MAX_BYTES = 25_000_000;

const chinaCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "必须使用 YYYY-MM-DD 日期")
  .refine((value) => isCalendarDate(value), "日期无效");

export const auditExportRequestSchema = z
  .object({
    from: chinaCalendarDateSchema,
    to: chinaCalendarDateSchema,
    format: z.enum(["csv", "ndjson"]).default("csv"),
    resourceType: z.string().trim().min(1).max(100).optional(),
    action: z.string().trim().min(1).max(100).optional(),
    acknowledgement: z.literal("INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED"),
  })
  .superRefine((value, context) => {
    const fromOrdinal = calendarOrdinal(value.from);
    const toOrdinal = calendarOrdinal(value.to);
    if (toOrdinal < fromOrdinal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "结束日期不能早于开始日期",
      });
      return;
    }
    const inclusiveDays = toOrdinal - fromOrdinal + 1;
    if (inclusiveDays > AUDIT_EXPORT_MAX_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `单次审计导出最多 ${AUDIT_EXPORT_MAX_DAYS} 个自然日`,
      });
    }
  });

export type AuditExportRequest = z.infer<typeof auditExportRequestSchema>;
export type AuditExportRow = typeof auditEvents.$inferSelect;

export interface AuditExportArtifact {
  body: Buffer;
  contentType: "application/x-ndjson; charset=utf-8" | "text/csv; charset=utf-8";
  extension: "csv" | "ndjson";
  sha256: string;
}

function calendarParts(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
}

function isCalendarDate(value: string) {
  const { year, month, day } = calendarParts(value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return (
    normalized.getUTCFullYear() === year &&
    normalized.getUTCMonth() === month - 1 &&
    normalized.getUTCDate() === day
  );
}

function calendarOrdinal(value: string) {
  const { year, month, day } = calendarParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function auditExportDateBounds(input: Pick<AuditExportRequest, "from" | "to">) {
  const from = calendarParts(input.from);
  const to = calendarParts(input.to);
  return {
    startAt: new Date(Date.UTC(from.year, from.month - 1, from.day) - 8 * 60 * 60 * 1_000),
    endExclusive: new Date(Date.UTC(to.year, to.month - 1, to.day + 1) - 8 * 60 * 60 * 1_000),
  };
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === "object" && !(candidate instanceof Date)) {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

export function protectSpreadsheetCell(value: string) {
  let firstSignificant = 0;
  while (firstSignificant < value.length) {
    const codePoint = value.charCodeAt(firstSignificant);
    if (codePoint > 0x20 && codePoint !== 0xfeff) break;
    firstSignificant += 1;
  }
  return "=+-@".includes(value[firstSignificant] ?? "") ? `'${value}` : value;
}

function csvCell(value: string) {
  return `"${protectSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

function eventValue(row: AuditExportRow, key: keyof AuditExportRow): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return canonicalJson(value);
  return String(value);
}

const csvColumns = [
  ["schema_version", () => "1"],
  ["event_id", (row: AuditExportRow) => eventValue(row, "id")],
  ["organization_id", (row: AuditExportRow) => eventValue(row, "orgId")],
  ["actor_user_id", (row: AuditExportRow) => eventValue(row, "actorUserId")],
  ["action", (row: AuditExportRow) => eventValue(row, "action")],
  ["resource_type", (row: AuditExportRow) => eventValue(row, "resourceType")],
  ["resource_id", (row: AuditExportRow) => eventValue(row, "resourceId")],
  ["request_id", (row: AuditExportRow) => eventValue(row, "requestId")],
  ["before_json", (row: AuditExportRow) => eventValue(row, "before")],
  ["after_json", (row: AuditExportRow) => eventValue(row, "after")],
  ["metadata_json", (row: AuditExportRow) => eventValue(row, "metadata")],
  ["ip_address", (row: AuditExportRow) => eventValue(row, "ipAddress")],
  ["user_agent", (row: AuditExportRow) => eventValue(row, "userAgent")],
  ["created_at", (row: AuditExportRow) => eventValue(row, "createdAt")],
] as const;

function renderCsv(rows: AuditExportRow[]) {
  const header = csvColumns.map(([name]) => csvCell(name)).join(",");
  const records = rows.map((row) => csvColumns.map(([, read]) => csvCell(read(row))).join(","));
  return `\uFEFF${[header, ...records].join("\r\n")}\r\n`;
}

function renderNdjson(rows: AuditExportRow[]) {
  if (rows.length === 0) return "";
  return `${rows
    .map((row) =>
      canonicalJson({
        schemaVersion: 1,
        eventId: row.id,
        organizationId: row.orgId,
        actorUserId: row.actorUserId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        requestId: row.requestId,
        before: row.before,
        after: row.after,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      }),
    )
    .join("\n")}\n`;
}

export function renderAuditExport(
  rows: AuditExportRow[],
  format: AuditExportRequest["format"],
): AuditExportArtifact {
  const body = Buffer.from(format === "csv" ? renderCsv(rows) : renderNdjson(rows), "utf8");
  return {
    body,
    contentType:
      format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
    extension: format,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}
