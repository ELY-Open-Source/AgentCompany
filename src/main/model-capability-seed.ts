import type { ModelCapability } from "@shared/types";

/**
 * Initial capability matrix written into the DB on first boot when the
 * table is empty. The user's five-axis ranking from the dispatch design
 * discussion is compressed to three axes:
 *
 *   reasoning = architecture/review ∧ math ∧ research
 *   coding    = coding (unchanged)
 *   writing   = language/copy (unchanged — the other two collapsed upward)
 *
 * Scores are 1..5 on each axis. Tier is the hard lower bound the dispatcher
 * clears before considering `costPerMtokOut` — a tier-3 (`hard`) task never
 * runs on a tier-1 (`trivial`) model even if the trivial model's domain
 * score happens to clear the numeric threshold.
 *
 * Cost-per-Mtok-output figures are the public list price at the provider's
 * own API as of 2026-04 (approximate; the table is user-editable after
 * seeding so prices can be corrected in-app without a code change).
 *
 * Adding a new model: append a row here AND publish a migration or an IPC
 * call that writes it through `upsertModelCapability` — the seed only runs
 * when the table is empty, so it does not back-fill on upgrade.
 */

export const MODEL_CAPABILITY_SEED: Array<Omit<ModelCapability, "updatedAt">> = [
  // ── Anthropic (Claude) ────────────────────────────────────────────────────
  // Claude Opus 4.7: strong across the board, top coding, top writing.
  {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    reasoning: 5,
    coding: 5,
    writing: 5,
    tier: "hard",
    costPerMtokOut: 75,
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    reasoning: 4,
    coding: 5,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 15,
  },
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    reasoning: 3,
    coding: 4,
    writing: 4,
    // Haiku sits at the standard tier. Its scores already clear the
    // standard domain floor (>=3), so marking the tier any lower would
    // exclude it from standard tasks in the dispatcher's tier-rank guard.
    // The cost advantage (~5x cheaper than Sonnet) is the whole point.
    tier: "standard",
    costPerMtokOut: 5,
  },

  // ── OpenAI (GPT) ──────────────────────────────────────────────────────────
  // GPT family leads reasoning/architecture/math/research; coding trails
  // Claude; writing trails Claude and Kimi.
  {
    provider: "openai",
    modelId: "gpt-5",
    reasoning: 5,
    coding: 4,
    writing: 3,
    tier: "hard",
    costPerMtokOut: 60,
  },
  {
    provider: "openai",
    modelId: "gpt-5-mini",
    reasoning: 4,
    coding: 3,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 10,
  },
  {
    provider: "openai",
    modelId: "gpt-4o-mini",
    reasoning: 3,
    coding: 3,
    writing: 3,
    // Same reasoning as Haiku: the model clears the standard domain
    // floor, so it should live at the standard tier. Llama-70B below is
    // the only genuinely trivial-tier seed row.
    tier: "standard",
    costPerMtokOut: 2,
  },

  // ── Fireworks curated (open-weight) ───────────────────────────────────────
  // Kimi K2: strong writing and coding, near-Claude. Reasoning solid.
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/kimi-k2-instruct",
    reasoning: 4,
    coding: 4,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 3,
  },
  // Kimi K2.5 Turbo via Fire Pass router — newer, faster, similar quality.
  {
    provider: "fireworks-firepass",
    modelId: "accounts/fireworks/routers/kimi-k2p5-turbo",
    reasoning: 4,
    coding: 4,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 3,
  },
  // GLM 4.5: mid-tier across reasoning and coding, decent writing.
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/glm-4p5",
    reasoning: 3,
    coding: 3,
    writing: 4,
    tier: "standard",
    costPerMtokOut: 2,
  },
  // Qwen3 Coder 480B: coding specialist.
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
    reasoning: 3,
    coding: 5,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 3,
  },
  // DeepSeek V3.1: strong reasoning, capable coder, writing ok.
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/deepseek-v3p1",
    reasoning: 4,
    coding: 4,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 2,
  },
  // Llama 3.3 70B: generalist trivial-tier fallback.
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    reasoning: 2,
    coding: 2,
    writing: 2,
    tier: "trivial",
    costPerMtokOut: 1,
  },
];
