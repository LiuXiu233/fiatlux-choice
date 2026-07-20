import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AuditExportForm } from "./audit-export-form";
import { ToastProvider } from "./ui";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuditExportForm onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe("AuditExportForm", () => {
  it("requires an internal-handling acknowledgement before exporting", () => {
    renderForm();
    expect((screen.getByRole("button", { name: "生成并下载" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByLabelText(/我确认只在获授权的内部范围保存和传递该文件/));
    expect((screen.getByRole("button", { name: "生成并下载" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("submits bounded filters, downloads the blob and reports the audited hash boundary", async () => {
    const onClose = vi.fn();
    const download = vi.spyOn(api, "download").mockResolvedValue({
      blob: new Blob(["audit export"], { type: "application/x-ndjson" }),
      filename: "fiatlux-audit-2026-07-01_to_2026-07-20.ndjson",
      contentSha256: "a".repeat(64),
      itemCount: 17,
    });
    const createObjectUrl = vi.fn(() => "blob:audit-export");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderForm(onClose);

    fireEvent.change(screen.getByLabelText("开始日期（北京时间）"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期（北京时间，含当天）"), {
      target: { value: "2026-07-20" },
    });
    fireEvent.change(screen.getByLabelText("文件格式"), { target: { value: "ndjson" } });
    fireEvent.change(screen.getByLabelText("对象类型（可选）"), {
      target: { value: " contracts " },
    });
    fireEvent.change(screen.getByLabelText("动作（可选）"), {
      target: { value: " update " },
    });
    fireEvent.click(screen.getByLabelText(/我确认只在获授权的内部范围保存和传递该文件/));
    fireEvent.click(screen.getByRole("button", { name: "生成并下载" }));

    await waitFor(() =>
      expect(download).toHaveBeenCalledWith("/audit-events/export", {
        from: "2026-07-01",
        to: "2026-07-20",
        format: "ndjson",
        resourceType: "contracts",
        action: "update",
        acknowledgement: "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED",
      }),
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:audit-export");
    expect(await screen.findByText(/已生成并校验 17 条审计记录/)).not.toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
