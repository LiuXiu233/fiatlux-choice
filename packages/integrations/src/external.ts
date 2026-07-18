export interface ExternalSubmission {
  state: "awaiting_manual_action" | "submitted" | "simulated";
  externalReference?: string;
  message: string;
}

export interface ExternalActionAdapter {
  readonly kind: "manual" | "mock" | "real";
  submit(input: {
    actionId: string;
    actionKind: string;
    payload: Record<string, unknown>;
  }): Promise<ExternalSubmission>;
}

export class ManualExternalActionAdapter implements ExternalActionAdapter {
  readonly kind = "manual" as const;

  async submit(_input: {
    actionId: string;
    actionKind: string;
    payload: Record<string, unknown>;
  }): Promise<ExternalSubmission> {
    return {
      state: "awaiting_manual_action",
      message:
        "Complete this action in the authoritative external system, then attach receipt evidence.",
    };
  }
}

export class MockExternalActionAdapter implements ExternalActionAdapter {
  readonly kind = "mock" as const;

  async submit(input: {
    actionId: string;
    actionKind: string;
    payload: Record<string, unknown>;
  }): Promise<ExternalSubmission> {
    return {
      state: "simulated",
      externalReference: `simulation:${input.actionId}`,
      message: "Simulation only. No external operation was performed.",
    };
  }
}
