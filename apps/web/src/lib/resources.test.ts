import { describe, expect, it } from "vitest";
import { queryString } from "./api";
import { getResourceConfig, resources, statusLabels } from "./resources";

describe("resource registry", () => {
  it("covers every required operational resource", () => {
    const required = [
      "goals",
      "projects",
      "tasks",
      "decisions",
      "obligations",
      "compliance-events",
      "compliance-items",
      "risks",
      "contracts",
      "transactions",
      "invoices",
      "cashflow-forecasts",
      "products",
      "opportunities",
      "github-intel",
      "files",
      "notifications",
      "workflows",
      "users",
      "audit-events",
    ];
    expect(Object.keys(resources)).toEqual(expect.arrayContaining(required));
    for (const key of required) {
      const config = getResourceConfig(key);
      expect(config?.endpoint).toMatch(/^\/[a-z-]+$/);
      expect(config?.columns.length).toBeGreaterThan(0);
    }
  });

  it("marks the append-only audit log as read-only", () => {
    expect(getResourceConfig("audit-events")?.readOnly).toBe(true);
    expect(getResourceConfig("audit-events")?.fields).toHaveLength(0);
  });

  it("has Chinese labels for high-risk workflow states", () => {
    expect(statusLabels.pending_approval).toBe("待审批");
    expect(statusLabels.confirmed).toBe("已确认");
    expect(statusLabels.failed).toBe("失败");
  });
});

describe("queryString", () => {
  it("omits empty values and preserves filters", () => {
    expect(
      queryString({ page: 2, pageSize: 20, search: "发票", status: "", category: "finance" }),
    ).toBe("?page=2&pageSize=20&search=%E5%8F%91%E7%A5%A8&category=finance");
  });
});
