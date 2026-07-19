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
    expect(statusLabels.inactive).toBe("已停用");
    expect(statusLabels.offboarded).toBe("已离职");
  });

  it("exposes distinct member lifecycle states and pending-approval context", () => {
    const users = getResourceConfig("users");
    expect(users?.statuses.map((status) => status.value)).toEqual([
      "pending",
      "active",
      "inactive",
      "offboarded",
    ]);
    const lifecycleColumn = users?.columns.find(
      (column) => column.key === "pendingLifecycleAction",
    );
    expect(lifecycleColumn?.format?.("deactivate")).toBe("待审批：停用");
    expect(lifecycleColumn?.format?.("offboard")).toBe("待审批：离职");
    expect(lifecycleColumn?.format?.("reactivate")).toBe("待审批：重新启用");
  });

  it("offers typed selectors for the core business relations", () => {
    const relationFields = (resource: string) =>
      Object.fromEntries(
        (getResourceConfig(resource)?.fields ?? [])
          .filter((field) => field.kind === "reference")
          .map((field) => [field.key, field]),
      );

    expect(relationFields("decisions")).toMatchObject({
      objectiveId: { referenceEndpoint: "/objectives", referenceLabelKey: "title" },
      projectId: { referenceEndpoint: "/projects", referenceLabelKey: "name" },
      taskId: { referenceEndpoint: "/tasks", referenceLabelKey: "title" },
    });
    expect(relationFields("products")).toMatchObject({
      projectId: { referenceEndpoint: "/projects", referenceLabelKey: "name" },
    });
    expect(relationFields("opportunities")).toMatchObject({
      productId: { referenceEndpoint: "/products", referenceLabelKey: "name" },
      projectId: { referenceEndpoint: "/projects", referenceLabelKey: "name" },
    });
    expect(relationFields("obligations")).toMatchObject({
      sourceId: { referenceEndpoint: "/compliance-items", referenceLabelKey: "title" },
      evidenceFileId: {
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
    });
    expect(relationFields("compliance-events")).toMatchObject({
      sourceId: { referenceEndpoint: "/compliance-items", referenceLabelKey: "title" },
      evidenceFileId: {
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
    });
    expect(
      getResourceConfig("obligations")?.fields.find((field) => field.key === "recurrenceRule"),
    ).toMatchObject({
      label: "重复规则（仅元数据）",
      placeholder: expect.stringContaining("V1 不自动生成下一期"),
    });
  });
});

describe("queryString", () => {
  it("omits empty values and preserves filters", () => {
    expect(
      queryString({ page: 2, pageSize: 20, search: "发票", status: "", category: "finance" }),
    ).toBe("?page=2&pageSize=20&search=%E5%8F%91%E7%A5%A8&category=finance");
  });
});
