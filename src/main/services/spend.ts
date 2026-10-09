import type { DatabaseSync } from "node:sqlite";

/** Tokens one model call consumed, as the provider reported them. */
export interface TokenUsage {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

/** Prices in cents per million tokens; null when the operator has not set them. */
export interface TokenPrices {
  inputCentsPerMtok: number | null;
  cachedInputCentsPerMtok: number | null;
  outputCentsPerMtok: number | null;
}

/** Reads token usage from a provider's raw response: one JSON body, or the list of a stream's event payloads. */
export function readTokenUsage(rawResponseJson: string): TokenUsage | null {
  const parsed = JSON.parse(rawResponseJson) as unknown;
  const reports = (Array.isArray(parsed) ? parsed.map(parseEvent) : [parsed])
    .map(usageIn)
    .filter((usage): usage is TokenUsage => usage !== null);
  if (reports.length === 0) return null;
  // A stream may report input early and output late (Anthropic): the last report wins, input taken from the last one that has it.
  const last = reports[reports.length - 1];
  if (last.inputTokens > 0) return last;
  const withInput = [...reports].reverse().find((usage) => usage.inputTokens > 0);
  return withInput ? { ...last, inputTokens: withInput.inputTokens, cachedInputTokens: withInput.cachedInputTokens } : last;
}

/** True when calls to this provider cost money on record. */
export function isPriced(prices: TokenPrices): boolean {
  return prices.inputCentsPerMtok !== null && prices.outputCentsPerMtok !== null;
}

/** What a call cost in cents, or null when its provider has no prices. */
export function requestCostCents(usage: TokenUsage, prices: TokenPrices): number | null {
  if (prices.inputCentsPerMtok === null || prices.outputCentsPerMtok === null) return null;
  const cachedPrice = prices.cachedInputCentsPerMtok ?? prices.inputCentsPerMtok;
  const fresh = usage.inputTokens - usage.cachedInputTokens;
  return (fresh * prices.inputCentsPerMtok + usage.cachedInputTokens * cachedPrice + usage.outputTokens * prices.outputCentsPerMtok) / 1_000_000;
}

export function providerPrices(db: DatabaseSync, providerId: string): TokenPrices {
  const row = db.prepare("select input_cents_per_mtok, cached_input_cents_per_mtok, output_cents_per_mtok from providers where id = ?").get(providerId) as
    { input_cents_per_mtok: number | null; cached_input_cents_per_mtok: number | null; output_cents_per_mtok: number | null } | undefined;
  if (!row) throw new Error(`Provider ${providerId} was not found.`);
  return { inputCentsPerMtok: row.input_cents_per_mtok, cachedInputCentsPerMtok: row.cached_input_cents_per_mtok, outputCentsPerMtok: row.output_cents_per_mtok };
}

/** Characters a call sends: the instructions count as much as the prompt. */
export function promptChars(prompt: string, instructions: string | null): number {
  return prompt.length + (instructions?.length ?? 0);
}

export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Why this agent may not make a paid call this month, or null when it may; free (unpriced) calls are never blocked. */
export function budgetBlock(db: DatabaseSync, agentId: string, paid: boolean, now: Date): string | null {
  if (!paid) return null;
  const agent = db.prepare("select org_id, name, department, budget_cents from agents where id = ?").get(agentId) as
    { org_id: string; name: string; department: string; budget_cents: number } | undefined;
  if (!agent) throw new Error(`Agent ${agentId} was not found.`);
  const since = monthStartIso(now);
  const agentSpend = (db.prepare("select coalesce(sum(cost_cents), 0) as cents from provider_requests where agent_id = ? and created_at >= ?")
    .get(agentId, since) as { cents: number }).cents;
  if (agentSpend >= agent.budget_cents) {
    const next = agent.budget_cents === 0 ? "Raise the budget to let it run." : "Raise the budget or wait for next month.";
    return `${agent.name} has spent its monthly budget (${dollars(agentSpend)} of ${dollars(agent.budget_cents)}). ${next}`;
  }
  const department = db.prepare("select monthly_budget_limit_cents from org_departments where org_id = ? and name = ?")
    .get(agent.org_id, agent.department) as { monthly_budget_limit_cents: number } | undefined;
  if (!department) return null;
  // Charges stay with the department that made them, even after the agent moves.
  const departmentSpend = (db.prepare(`
    select coalesce(sum(cost_cents), 0) as cents from provider_requests where org_id = ? and department = ? and created_at >= ?
  `).get(agent.org_id, agent.department, since) as { cents: number }).cents;
  if (departmentSpend >= department.monthly_budget_limit_cents) {
    return `The ${agent.department} department has spent its monthly budget (${dollars(departmentSpend)} of ${dollars(department.monthly_budget_limit_cents)}).`;
  }
  return null;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseEvent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Stream sentinels such as [DONE] carry no usage.
    return null;
  }
}

function usageIn(body: unknown): TokenUsage | null {
  if (!isRecord(body)) return null;
  const nested = isRecord(body.response) ? body.response : null;
  const firstChoice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : null;
  const message = isRecord(body.message) ? body.message : null;
  const openAiStyle = record(body.usage) ?? record(nested?.usage) ?? record(message?.usage)
    ?? record(isRecord(body.x_groq) ? body.x_groq.usage : null) ?? record(firstChoice?.usage);
  if (openAiStyle) return fromOpenAiOrAnthropic(openAiStyle);
  const gemini = record(body.usageMetadata) ?? record(nested?.usageMetadata);
  if (gemini) return fromGemini(gemini);
  return null;
}

function fromOpenAiOrAnthropic(usage: Record<string, unknown>): TokenUsage | null {
  // Bedrock Converse
  if (typeof usage.inputTokens === "number") {
    return {
      inputTokens: usage.inputTokens + count(usage.cacheReadInputTokens) + count(usage.cacheWriteInputTokens),
      outputTokens: count(usage.outputTokens),
      cachedInputTokens: count(usage.cacheReadInputTokens),
      reasoningTokens: 0,
    };
  }
  // Chat Completions
  if (typeof usage.prompt_tokens === "number") {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: count(usage.completion_tokens),
      cachedInputTokens: count(record(usage.prompt_tokens_details)?.cached_tokens),
      reasoningTokens: count(record(usage.completion_tokens_details)?.reasoning_tokens),
    };
  }
  if (typeof usage.input_tokens !== "number" && typeof usage.output_tokens !== "number") return null;
  // Anthropic reports cache reads and writes beside input_tokens; Responses reports them inside it.
  const anthropicCache = count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
  return {
    inputTokens: count(usage.input_tokens) + anthropicCache,
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count(usage.cache_read_input_tokens) + count(record(usage.input_tokens_details)?.cached_tokens),
    reasoningTokens: count(record(usage.output_tokens_details)?.reasoning_tokens),
  };
}

function fromGemini(usage: Record<string, unknown>): TokenUsage | null {
  if (typeof usage.promptTokenCount !== "number") return null;
  const thoughts = count(usage.thoughtsTokenCount);
  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: count(usage.candidatesTokenCount) + thoughts,
    cachedInputTokens: count(usage.cachedContentTokenCount),
    reasoningTokens: thoughts,
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
