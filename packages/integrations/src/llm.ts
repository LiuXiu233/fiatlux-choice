import { type AdvisorOutput, advisorOutputSchema } from "@fiatlux/contracts";

import { isRequestTimeout, readResponseTextWithinLimit } from "./http-response.js";

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
  fetchImpl?: typeof fetch;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class CompatibleLlmProvider implements LlmProvider {
  readonly #config: CompatibleLlmConfig;

  constructor(config: CompatibleLlmConfig) {
    if (new URL(config.baseUrl).protocol !== "https:") {
      throw new Error("Compatible LLM base URL must use HTTPS");
    }
    this.#config = config;
  }

  async completeAdvisor(input: LlmCallInput): Promise<LlmCallResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await (this.#config.fetchImpl ?? fetch)(
        `${this.#config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
        {
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
          redirect: "error",
          signal: AbortSignal.timeout(this.#config.timeoutMs ?? 60_000),
        },
      );
    } catch (error) {
      if (isRequestTimeout(error)) {
        throw new Error("LLM provider request timed out");
      }
      throw new Error("LLM provider request failed");
    }

    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      const retryAfter = response.headers.get("retry-after");
      const details = [
        `HTTP ${response.status}`,
        ...(requestId ? [`request ${requestId.slice(0, 200)}`] : []),
        ...(retryAfter ? [`retry-after ${retryAfter.slice(0, 100)}`] : []),
      ];
      throw new Error(`LLM provider returned ${details.join(", ")}`);
    }

    const responseText = await readResponseTextWithinLimit(
      response,
      2_000_000,
      "LLM provider response exceeded the 2 MB safety limit",
    );
    let rawResponse: ChatCompletionResponse;
    try {
      rawResponse = JSON.parse(responseText) as ChatCompletionResponse;
    } catch {
      throw new Error("LLM provider returned an invalid response envelope");
    }
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
