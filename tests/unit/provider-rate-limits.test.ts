import { describe, expect, it } from "vitest";
import {
  PROVIDER_CONCURRENCY_LIMITS,
  getProviderConcurrencyLimit,
} from "../../src/main/worker/runtime/provider-rate-limits";

describe("provider rate limits", () => {
  it("caps fireworks-firepass at one concurrent call", () => {
    expect(PROVIDER_CONCURRENCY_LIMITS["fireworks-firepass"]).toBe(1);
    expect(getProviderConcurrencyLimit("fireworks-firepass")).toBe(1);
  });

  it("returns null for providers without an explicit cap", () => {
    expect(getProviderConcurrencyLimit("anthropic")).toBeNull();
    expect(getProviderConcurrencyLimit("openai")).toBeNull();
    expect(getProviderConcurrencyLimit("ollama")).toBeNull();
    expect(getProviderConcurrencyLimit("unknown-provider")).toBeNull();
  });
});
