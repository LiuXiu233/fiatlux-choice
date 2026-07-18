import { describe, expect, it } from "vitest";

import {
  createLlmProvider,
  ManualExternalActionAdapter,
  ManualGitHubReader,
  MemoryObjectStorage,
  MockExternalActionAdapter,
  MockLlmProvider,
} from "../src/index.js";

describe("external integration truth boundaries", () => {
  it("manual actions never claim external success", async () => {
    const result = await new ManualExternalActionAdapter().submit({
      actionId: "a",
      actionKind: "bank_payment",
      payload: {},
    });
    expect(result.state).toBe("awaiting_manual_action");
  });

  it("mock actions are explicitly simulated", async () => {
    const result = await new MockExternalActionAdapter().submit({
      actionId: "a",
      actionKind: "bank_payment",
      payload: {},
    });
    expect(result.state).toBe("simulated");
  });
});

describe("GitHub integration truth boundary", () => {
  it("never performs repository reads in manual mode", async () => {
    await expect(new ManualGitHubReader().getRepository("owner/repository")).rejects.toThrow(
      /manual mode/,
    );
  });
});

describe("mock LLM truth boundary", () => {
  it("returns explicit simulated structured output", async () => {
    const provider = createLlmProvider({ driver: "mock", model: "ignored" });
    expect(provider).toBeInstanceOf(MockLlmProvider);
    const result = await provider.completeAdvisor({
      system: "test",
      user: { question: "Should we sign?", companyContext: [] },
    });
    expect(result).toMatchObject({ provider: "mock", model: "simulated-advisor-v1" });
    expect(result.rawResponse).toMatchObject({ simulated: true });
    expect(result.output.facts).toEqual([]);
    expect(result.output.confidence).toBe(0);
    expect(result.output.disclaimer).toContain("SIMULATED OUTPUT");
  });
});

describe("object storage", () => {
  it("uses opaque organization-scoped keys", async () => {
    const storage = new MemoryObjectStorage();
    const ticket = await storage.createUploadTicket({
      orgId: "org",
      fileId: "file",
      contentType: "application/pdf",
      checksumSha256: "a".repeat(64),
    });
    expect(ticket.storageKey).toBe("org/file");
    expect(ticket.storageKey).not.toContain(".pdf");
  });
});
