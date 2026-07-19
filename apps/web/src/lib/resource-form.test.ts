import { describe, expect, it } from "vitest";

import { formatChinaDateInput, formatChinaDateTimeInput } from "./china-time";
import { buildResourcePayload } from "./resource-form";
import type { FieldConfig } from "./resources";

describe("resource form payload", () => {
  const fields: FieldConfig[] = [
    { key: "title", label: "标题", kind: "text", required: true },
    { key: "description", label: "说明", kind: "textarea" },
    { key: "dueAt", label: "到期", kind: "datetime-local" },
    { key: "effectiveDate", label: "生效日", kind: "date" },
  ];

  it("omits empty optional fields when creating a minimal record", () => {
    expect(
      buildResourcePayload(
        fields,
        { title: "最小记录", description: "", dueAt: "", effectiveDate: "" },
        "create",
      ),
    ).toEqual({ title: "最小记录" });
  });

  it("clears nullable fields on update and interprets local time as China Standard Time", () => {
    expect(
      buildResourcePayload(
        fields,
        {
          title: "只改标题",
          description: "",
          dueAt: "2026-07-19T12:30",
          effectiveDate: "2026-07-20",
        },
        "update",
        {
          title: "旧标题",
          description: "旧说明",
          dueAt: "2026-07-19T11:30",
          effectiveDate: "2026-07-19",
        },
      ),
    ).toEqual({
      title: "只改标题",
      description: null,
      dueAt: "2026-07-19T04:30:00.000Z",
      effectiveDate: "2026-07-20",
    });
  });

  it("omits unchanged optional values so unrelated edits preserve database values", () => {
    expect(
      buildResourcePayload(
        fields,
        { title: "新标题", description: "", dueAt: "2026-07-19T12:30", effectiveDate: "" },
        "update",
        { title: "旧标题", description: "", dueAt: "2026-07-19T12:30", effectiveDate: "" },
      ),
    ).toEqual({ title: "新标题" });
  });
});

describe("China time form round trip", () => {
  it("renders API instants in Asia/Shanghai and preserves them through editing", () => {
    const instant = "2026-07-19T04:30:00.000Z";
    const input = formatChinaDateTimeInput(instant);
    expect(input).toBe("2026-07-19T12:30");
    expect(
      buildResourcePayload(
        [{ key: "dueAt", label: "到期", kind: "datetime-local" }],
        { dueAt: input },
        "update",
        { dueAt: "2026-07-19T11:30" },
      ),
    ).toEqual({ dueAt: instant });
  });

  it("renders date-only values as the Shanghai calendar date", () => {
    expect(formatChinaDateInput("2026-07-18T16:00:00.000Z")).toBe("2026-07-19");
  });

  it("rejects dates that JavaScript would otherwise normalize silently", () => {
    expect(() =>
      buildResourcePayload(
        [{ key: "dueAt", label: "到期", kind: "datetime-local" }],
        { dueAt: "2026-02-30T12:00" },
        "create",
      ),
    ).toThrow("无效的北京时间");
  });
});
