export interface ProviderExecutionInput {
  apiKey: string;
  model: string;
  prompt: string;
  instructions: string | null;
}

export interface ProviderExecutionResult {
  text: string;
  rawResponseJson: string;
}

export interface ProviderAdapter {
  createResponse(input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
}

type JsonRecord = Record<string, unknown>;

async function postJson(endpoint: string, headers: Record<string, string>, body: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json() as JsonRecord;
  if (!response.ok) {
    const message = readProviderError(data) ?? `Provider request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data;
}

function readProviderError(data: JsonRecord): string | null {
  const error = data.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item));
  if (!isRecord(value)) return [];
  const direct = ["text", "output_text", "content"].flatMap((key) => collectText(value[key]));
  return direct.length > 0 ? direct : Object.values(value).flatMap((item) => collectText(item));
}

function requireText(parts: string[], providerKey: string): string {
  const text = parts.map((part) => part.trim()).filter(Boolean).join("\n");
  if (!text) throw new Error(`${providerKey} returned no text content.`);
  return text;
}

export const providerAdapters: Record<string, ProviderAdapter> = {
  openai: {
    async createResponse(input) {
      const data = await postJson("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${input.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      });
      const text = requireText(collectText(data.output_text ?? data.output), "OpenAI");
      return { text, rawResponseJson: JSON.stringify(data) };
    },
  },
  anthropic: {
    async createResponse(input) {
      const data = await postJson("https://api.anthropic.com/v1/messages", {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: 4096,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      const text = requireText(collectText(data.content), "Anthropic");
      return { text, rawResponseJson: JSON.stringify(data) };
    },
  },
  xai: {
    async createResponse(input) {
      return createOpenAiCompatibleResponse("https://api.x.ai/v1/chat/completions", "xAI", input);
    },
  },
  groq: {
    async createResponse(input) {
      return createOpenAiCompatibleResponse("https://api.groq.com/openai/v1/chat/completions", "Groq", input);
    },
  },
};

async function createOpenAiCompatibleResponse(
  endpoint: string,
  providerLabel: string,
  input: ProviderExecutionInput,
): Promise<ProviderExecutionResult> {
  const messages = [
    ...(input.instructions ? [{ role: "system", content: input.instructions }] : []),
    { role: "user", content: input.prompt },
  ];
  const data = await postJson(endpoint, {
    authorization: `Bearer ${input.apiKey}`,
  }, {
    model: input.model,
    messages,
  });
  const text = requireText(collectText(data.choices), providerLabel);
  return { text, rawResponseJson: JSON.stringify(data) };
}
