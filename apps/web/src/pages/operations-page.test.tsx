import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type OperationalIncident,
  OperationalIncidentCard,
  OperationalIncidentResolutionForm,
} from "./operations-page";

const openIncident: OperationalIncident = {
  incidentId: "59450c16-488f-4c71-a73d-54a86bab2e2a",
  sourceType: "workflow-run",
  sourceId: "1e2b7397-1f0f-4102-9dd4-e3e163ffab67",
  detectedAt: "2026-07-20T02:30:00+08:00",
  title: "每周经营检查",
  currentStatus: "failed",
  currentVersion: 5,
  sourceError: "Worker execution lease expired; requires manual review",
  sourceExists: true,
  possiblePartialEffects: true,
  recordedPartialEffects: true,
  recordedPartialCount: 1,
  status: "open",
  resolution: null,
};

afterEach(cleanup);

describe("operational incident handling", () => {
  it("shows the failed state, recorded partial effect and explicit investigation action", () => {
    const onResolve = vi.fn();
    render(
      <MemoryRouter>
        <OperationalIncidentCard incident={openIncident} canResolve={true} onResolve={onResolve} />
      </MemoryRouter>,
    );

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "每周经营检查" })).not.toBeNull();
    expect(within(card).getByText("待人工处置")).not.toBeNull();
    expect(within(card).getByText("1 项")).not.toBeNull();
    expect(within(card).getByText(/不要重放旧运行/)).not.toBeNull();
    expect(
      within(card)
        .getByRole("link", { name: /查看工作流记录/ })
        .getAttribute("href"),
    ).toBe("/resources/workflows");
    fireEvent.click(within(card).getByRole("button", { name: "调查并记录处置" }));
    expect(onResolve).toHaveBeenCalledWith(openIncident);
  });

  it("requires compensation details when a partial effect is already recorded", () => {
    const onSubmit = vi.fn();
    render(
      <OperationalIncidentResolutionForm
        incident={openIncident}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const resolution = screen.getByLabelText("调查结论");
    expect(within(resolution).queryByText("调查后未发现部分副作用")).toBeNull();
    expect((resolution as HTMLSelectElement).value).toBe("manual_compensation_completed");
    expect(screen.getByText(/系统已记录 1 个部分结果/)).not.toBeNull();

    fireEvent.change(screen.getByLabelText("调查与核对说明"), {
      target: { value: "已核对部分创建的任务并完成业务补偿，保留原失败运行作为审计证据。" },
    });
    fireEvent.change(screen.getByLabelText("证据引用（每行一项）"), {
      target: { value: "audit:event-1\ntask:compensation-1" },
    });
    fireEvent.change(screen.getByLabelText("补偿主记录引用"), {
      target: { value: "task:compensation-1" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "我已确认旧运行不会自动重放；如需重做，将创建一个具有明确原因的新运行。",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "记录调查结论" }));

    expect(onSubmit).toHaveBeenCalledWith({
      resolution: "manual_compensation_completed",
      reviewSummary: "已核对部分创建的任务并完成业务补偿，保留原失败运行作为审计证据。",
      evidenceReferences: ["audit:event-1", "task:compensation-1"],
      compensationReference: "task:compensation-1",
      acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
    });
  });

  it("describes a recorded partial effect without inventing a count", () => {
    render(
      <OperationalIncidentResolutionForm
        incident={{ ...openIncident, recordedPartialCount: 0 }}
        busy={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText(/部分结果（数量未知）/)).not.toBeNull();
    expect(screen.queryByText(/至少一项 个/)).toBeNull();
  });

  it("renders completed human evidence without offering another resolution", () => {
    const resolved: OperationalIncident = {
      ...openIncident,
      status: "resolved",
      resolution: {
        auditEventId: "5ccb6487-aa4a-4ca1-aebd-30b0991a37bd",
        resolution: "manual_compensation_completed",
        reviewSummary: "已核对部分任务并完成补偿。",
        evidenceReferences: ["task:compensation-1"],
        compensationReference: "task:compensation-1",
        resolvedAt: "2026-07-20T03:30:00+08:00",
        resolvedByUserId: "0c751fb9-a2b6-464a-89f0-b0e4bf98b28a",
        resolvedByDisplayName: "经营负责人",
      },
    };
    render(
      <MemoryRouter>
        <OperationalIncidentCard incident={resolved} canResolve={true} onResolve={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("已记录处置")).not.toBeNull();
    expect(screen.getByText("已完成并核对人工补偿")).not.toBeNull();
    const compensation = screen.getByText("补偿主记录").parentElement;
    expect(compensation).not.toBeNull();
    expect(within(compensation as HTMLElement).getByText("task:compensation-1")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "调查并记录处置" })).toBeNull();
  });
});
