import { type AdvisorOutput, advisorOutputSchema } from "@fiatlux/contracts";

export interface LlmCallInput {
  system: string;
  user: Record<string, unknown>;
}

export interface LlmCallResult {
  output: AdvisorOutput;
  rawResponse: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  completeAdvisor(input: LlmCallInput): Promise<LlmCallResult>;
}

export interface CompatibleLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerName?: string;
  timeoutMs?: number;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class CompatibleLlmProvider implements LlmProvider {
  readonly #config: CompatibleLlmConfig;

  constructor(config: CompatibleLlmConfig) {
    this.#config = config;
  }

  async completeAdvisor(input: LlmCallInput): Promise<LlmCallResult> {
    const startedAt = Date.now();
    const response = await fetch(`${this.#config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.#config.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: JSON.stringify(input.user) },
        ],
      }),
      signal: AbortSignal.timeout(this.#config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      throw new Error(`LLM provider returned HTTP ${response.status}`);
    }

    const rawResponse = (await response.json()) as ChatCompletionResponse;
    const content = rawResponse.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM provider returned no content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("LLM provider returned invalid JSON");
    }

    return {
      output: advisorOutputSchema.parse(parsed),
      rawResponse,
      usage: {
        ...(rawResponse.usage?.prompt_tokens !== undefined
          ? { inputTokens: rawResponse.usage.prompt_tokens }
          : {}),
        ...(rawResponse.usage?.completion_tokens !== undefined
          ? { outputTokens: rawResponse.usage.completion_tokens }
          : {}),
      },
      provider: this.#config.providerName ?? "openai-compatible",
      model: this.#config.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export class DisabledLlmProvider implements LlmProvider {
  async completeAdvisor(): Promise<LlmCallResult> {
    throw new Error(
      "LLM integration is not configured; the advisor run remains auditable but cannot execute",
    );
  }
}

export class MockLlmProvider implements LlmProvider {
  async completeAdvisor(input: LlmCallInput): Promise<LlmCallResult> {
    const output = advisorOutputSchema.parse({
      facts: [],
      inferences: [
        {
          claim: "This is a simulated advisor run; no real model analysis was performed.",
          basis: [
            "LLM_DRIVER=mock",
            `Question received: ${JSON.stringify(input.user.question ?? "")}`,
          ],
          confidence: 1,
        },
      ],
      recommendations: [
        {
          action: "Review the question and supplied company context manually.",
          rationale: "The mock driver validates workflow and audit plumbing only.",
          risk: "Treating simulated output as professional advice would be misleading.",
          priority: "high",
        },
      ],
      risks: [
        {
          description: "No real LLM reasoning was performed.",
          severity: "high",
          mitigation:
            "Configure an approved compatible provider before relying on advisor analysis.",
        },
      ],
      missingInformation: ["Real model analysis is unavailable while the mock driver is active."],
      confidence: 0,
      disclaimer:
        "SIMULATED OUTPUT. This integration result is not business, financial, legal, HR, product, market, or security advice.",
    });
    return {
      output,
      rawResponse: { simulated: true, driver: "mock", output },
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: "mock",
      model: "simulated-advisor-v1",
      latencyMs: 0,
    };
  }
}

export type LlmDriver = "mock" | "compatible" | "disabled";

export function createLlmProvider(config: {
  driver: LlmDriver;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}): LlmProvider {
  if (config.driver === "compatible") {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("Compatible LLM driver requires URL and API key");
    }
    return new CompatibleLlmProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
  }
  return config.driver === "mock" ? new MockLlmProvider() : new DisabledLlmProvider();
}
