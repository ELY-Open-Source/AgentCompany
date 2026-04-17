import { describe, expect, it } from "vitest";
import { redactTokens } from "../../src/main/worker/log-redactor";

/** Verifies the worker process token redactor strips known
 * credential-shaped substrings from log strings before they leave the
 * worker process. */
describe("worker log redactor", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abc.def.ghi-jkl_mnop";
    expect(redactTokens(input)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts authorization header values regardless of case", () => {
    expect(redactTokens("authorization=secret-value-1234567890")).toContain("[REDACTED]");
    expect(redactTokens("Authorization: secret-value-1234567890")).toContain("[REDACTED]");
  });

  it("redacts access_token query strings", () => {
    expect(redactTokens("https://api.example.com/?access_token=abc123xyz&foo=1")).toBe(
      "https://api.example.com/?access_token=[REDACTED]&foo=1",
    );
  });

  it("redacts refresh_token values", () => {
    expect(redactTokens("refresh_token=long.refresh.tok&grant_type=refresh_token")).toContain(
      "refresh_token=[REDACTED]",
    );
  });

  it("redacts api_key key/value pairs", () => {
    const input = "config { api_key: \"sk-test-1234567890abcdef\", model: \"gpt-4o\" }";
    const result = redactTokens(input);
    expect(result).not.toContain("sk-test-1234567890abcdef");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts sk- and sk-ant- prefixed keys anywhere in a string", () => {
    expect(redactTokens("error using sk-ant-api03_abcdefghijklmnop, retrying")).toContain("sk-[REDACTED]");
    expect(redactTokens("token=sk-test1234567890_abcd")).toContain("sk-[REDACTED]");
  });

  it("redacts GitHub personal access token shapes", () => {
    expect(redactTokens("git push https://x:ghp_aaaaaaaaaaaaaaaaaa@github.com/foo")).toContain("ghp_[REDACTED]");
  });

  it("redacts AWS access key id prefixes", () => {
    expect(redactTokens("aws cred AKIAIOSFODNN7EXAMPLE in trace")).toContain("AKIA[REDACTED]");
  });

  it("leaves credential-free strings unchanged", () => {
    const safe = "Just a regular log line about model claude-opus-4-5 with usage 123 tokens.";
    expect(redactTokens(safe)).toBe(safe);
  });

  it("redacts multiple matches in one string", () => {
    const input = "Bearer abc.def.ghi.jkl Authorization=secretsecretsecret";
    const result = redactTokens(input);
    expect(result).not.toContain("abc.def.ghi.jkl");
    expect(result).not.toContain("secretsecretsecret");
  });
});
