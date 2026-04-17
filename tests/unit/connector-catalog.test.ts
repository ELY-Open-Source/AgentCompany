import { describe, expect, it } from "vitest";
import { CONNECTORS } from "../../src/main/connector-definitions";
import { findConnectorDefinition, listFeaturedOnboardingConnectors } from "../../src/main/connector-definitions-lookup";

/** Verifies the static pi-mono connector catalog is shape-correct and that
 * required fields hold the values downstream code (worker, resolver,
 * Settings panel) depends on. */

describe("CONNECTORS catalog", () => {
  it("contains exactly 26 connectors (5 OAuth + 18 API key + 3 Cloud)", () => {
    expect(CONNECTORS.length).toBe(26);
    const oauth = CONNECTORS.filter((c) => c.auth?.type === "oauth");
    const apiKey = CONNECTORS.filter((c) => c.auth?.type === "api_key");
    const cloud = CONNECTORS.filter((c) => c.auth ? ["aws", "azure", "gcp_adc"].includes(c.auth.type) : false);
    expect(oauth.length).toBe(5);
    expect(apiKey.length).toBe(18);
    expect(cloud.length).toBe(3);
  });

  it("uses unique connector ids", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a non-empty label and description", () => {
    for (const connector of CONNECTORS) {
      expect(connector.label.length).toBeGreaterThan(0);
      expect(connector.description.length).toBeGreaterThan(0);
      expect((connector.defaultModel ?? "").length).toBeGreaterThan(0);
    }
  });

  it("every entry references a documented pi `KnownProvider` id (or a local model-resolver provider)", () => {
    // pi-ai's KnownProvider matrix (catalog covered by getModel/getModels).
    const knownPiProviders = new Set([
      "amazon-bedrock", "anthropic", "google", "google-gemini-cli", "google-antigravity", "google-vertex",
      "openai", "azure-openai-responses", "openai-codex", "github-copilot",
      "xai", "groq", "cerebras", "openrouter", "vercel-ai-gateway", "zai", "mistral",
      "minimax", "minimax-cn", "huggingface", "opencode", "opencode-go", "kimi-coding",
    ]);
    // Providers wired through src/main/model-resolver.ts instead of pi's catalog.
    const localProviders = new Set(["fireworks", "fireworks-firepass"]);
    for (const connector of CONNECTORS) {
      const provider = connector.provider ?? "";
      const recognised = knownPiProviders.has(provider) || localProviders.has(provider);
      expect(recognised).toBe(true);
    }
  });

  it("OAuth connectors carry one of the five pi OAuth provider ids", () => {
    const validOauthIds = new Set(["anthropic", "openai-codex", "github-copilot", "gemini-cli", "antigravity"]);
    const oauthConnectors = CONNECTORS.filter((c) => c.auth?.type === "oauth");
    for (const connector of oauthConnectors) {
      if (connector.auth?.type !== "oauth") throw new Error("unreachable");
      expect(validOauthIds.has(connector.auth.oauthId ?? "")).toBe(true);
    }
  });

  it("API-key connectors carry an envVar name", () => {
    const apiKeyConnectors = CONNECTORS.filter((c) => c.auth?.type === "api_key");
    for (const connector of apiKeyConnectors) {
      if (connector.auth?.type !== "api_key") throw new Error("unreachable");
      expect((connector.auth.envKey ?? "").length).toBeGreaterThan(0);
    }
  });

  it("findConnectorDefinition resolves known ids and returns undefined for unknown ones", () => {
    expect(findConnectorDefinition("anthropic")?.label).toBe("Anthropic API");
    expect(findConnectorDefinition("amazon-bedrock")?.auth?.type).toBe("aws");
    expect(findConnectorDefinition("google-vertex")?.auth?.type).toBe("gcp_adc");
    expect(findConnectorDefinition("definitely-not-a-connector")).toBeUndefined();
  });

  it("featured onboarding rail returns the curated 3-provider subset", () => {
    const featured = listFeaturedOnboardingConnectors();
    expect(featured.length).toBeGreaterThanOrEqual(2);
    expect(featured.length).toBeLessThanOrEqual(5);
    expect(featured.find((c) => (c.id as string) === "claude-pro")).toBeDefined();
  });
});
