import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, StatusBadge } from "./ui";

describe("StatusBadge", () => {
  it("renders localized workflow states", () => {
    render(<StatusBadge status="pending_approval" />);
    expect(screen.getByText("待审批").className).toContain("status-pending_approval");
  });
});

describe("EmptyState", () => {
  it("has an accessible heading", () => {
    render(<EmptyState title="暂无任务" detail="当前筛选下没有任务" />);
    expect(screen.getByRole("heading", { name: "暂无任务" })).not.toBeNull();
  });
});
