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
  maxOutputTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class CompatibleLlmProvider implements LlmProvider {
  readonly #config: CompatibleLlmConfig;
  readonly #chatCompletionsUrl: string;

  constructor(config: CompatibleLlmConfig) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(config.baseUrl);
    } catch {
      throw new Error("Compatible LLM base URL is invalid");
    }
    if (baseUrl.protocol !== "https:") {
      throw new Error("Compatible LLM base URL must use HTTPS");
    }
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error("Compatible LLM base URL cannot contain credentials, query or fragment");
    }
    if (baseUrl.pathname.split("/").includes("..")) {
      throw new Error("Compatible LLM base URL cannot contain path traversal");
    }
    if (!config.model.trim() || config.model.length > 200 || /[\p{Cc}\p{Cf}]/u.test(config.model)) {
      throw new Error("Compatible LLM model name is invalid");
    }
    if (
      config.providerName !== undefined &&
      (!/^[a-z0-9][a-z0-9._:-]{2,119}$/.test(config.providerName) ||
        /(?:mock|simulat|disabled)/i.test(config.providerName))
    ) {
      throw new Error("Compatible LLM provider name is invalid");
    }
    const maxOutputTokens = config.maxOutputTokens ?? 2_048;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 32_768) {
      throw new Error("Compatible LLM max output tokens must be between 128 and 32768");
    }
    const timeoutMs = config.timeoutMs ?? 60_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new Error("Compatible LLM timeout must be between 1000 and 300000 milliseconds");
    }
    const normalizedBaseUrl = baseUrl.toString().replace(/\/+$/, "");
    this.#chatCompletionsUrl = `${normalizedBaseUrl}/v1/chat/completions`;
    this.#config = { ...config, model: config.model.trim(), maxOutputTokens, timeoutMs };
  }

  async completeAdvisor(input: LlmCallInput): Promise<LlmCallResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await (this.#config.fetchImpl ?? fetch)(this.#chatCompletionsUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#config.model,
          temperature: 0.1,
          max_tokens: this.#config.maxOutputTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: JSON.stringify(input.user) },
          ],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 60_000),
      });
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
    let unknownResponse: unknown;
    try {
      unknownResponse = JSON.parse(responseText);
    } catch {
      throw new Error("LLM provider returned an invalid response envelope");
    }
    if (
      typeof unknownResponse !== "object" ||
      unknownResponse === null ||
      Array.isArray(unknownResponse)
    ) {
      throw new Error("LLM provider returned an invalid response envelope");
    }
    const rawResponse = unknownResponse as ChatCompletionResponse;
    const content = rawResponse.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM provider returned no content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("LLM provider returned invalid JSON");
    }
    if (rawResponse.model !== this.#config.model) {
      throw new Error("LLM provider returned a different or missing model identity");
    }

    const tokenCount = (value: unknown, label: string): number | undefined => {
      if (value === undefined) return undefined;
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) {
        throw new Error(`LLM provider returned invalid ${label}`);
      }
      return value as number;
    };
    const inputTokens = tokenCount(rawResponse.usage?.prompt_tokens, "input token usage");
    const outputTokens = tokenCount(rawResponse.usage?.completion_tokens, "output token usage");
    return {
      output: advisorOutputSchema.parse(parsed),
      rawResponse,
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
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
  providerName?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): LlmProvider {
  if (config.driver === "compatible") {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("Compatible LLM driver requires URL and API key");
    }
    return new CompatibleLlmProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.providerName ? { providerName: config.providerName } : {}),
      ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    });
  }
  return config.driver === "mock" ? new MockLlmProvider() : new DisabledLlmProvider();
}
