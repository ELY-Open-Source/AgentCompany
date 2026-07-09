import { describe, expect, test } from "vitest";
import { isTransientProviderFailure, PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../src/shared/provider-runtime-domain";

describe("isTransientProviderFailure", () => {
  test("classifies provider-side limit and overload verdicts as transient", () => {
    expect(isTransientProviderFailure(PROVIDER_MONTHLY_LIMIT_MESSAGE)).toBe(true);
    expect(isTransientProviderFailure("The usage limit has been reached")).toBe(true);
    expect(isTransientProviderFailure("Our servers are currently overloaded. Please try again later.")).toBe(true);
    expect(isTransientProviderFailure("Rate limit exceeded, retry after 20s")).toBe(true);
    expect(isTransientProviderFailure("429 Too Many Requests")).toBe(true);
  });

  test("keeps genuine task failures counting toward the retry budget", () => {
    expect(isTransientProviderFailure(null)).toBe(false);
    expect(isTransientProviderFailure(undefined)).toBe(false);
    expect(isTransientProviderFailure("")).toBe(false);
    expect(isTransientProviderFailure("provider rejected task")).toBe(false);
    expect(isTransientProviderFailure("Agent run did not converge within 12 iterations.")).toBe(false);
    expect(isTransientProviderFailure("Provider returned an empty turn: no text and no tool calls.")).toBe(false);
  });
});
