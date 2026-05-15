import { describe, expect, it } from "vitest";
import {
  apiKeyValueSchema,
  awsCredentialSchema,
  azureCredentialSchema,
  credentialPayloadSchema,
  gcpAdcCredentialSchema,
  isLocalConnectorBaseUrl,
  localCredentialSchema,
  removeCredentialInputSchema,
  saveCredentialInputSchema,
  testCredentialInputSchema,
} from "../../src/shared/contracts/schemas-credentials";
import {
  oauthCancelInputSchema,
  oauthManualCodeResponseSchema,
  oauthPromptResponseSchema,
  oauthStartInputSchema,
} from "../../src/shared/contracts/schemas-oauth";

/** Verifies the IPC payload schemas reject malformed input and accept valid
 * shapes. These are the only contract between renderer ↔ main for the new
 * credential / OAuth channels — incorrect validation would let bad data
 * reach pi-mono primitives. */

describe("credentials Zod schemas", () => {
  it("apiKeyValueSchema rejects empty value", () => {
    const result = apiKeyValueSchema.safeParse({ source: "literal", value: "" });
    expect(result.success).toBe(false);
  });

  it("apiKeyValueSchema accepts both source kinds", () => {
    expect(apiKeyValueSchema.safeParse({ source: "literal", value: "sk-x" }).success).toBe(true);
    expect(apiKeyValueSchema.safeParse({ source: "env", value: "MY_KEY" }).success).toBe(true);
  });

  it("apiKeyValueSchema rejects unknown source", () => {
    const result = apiKeyValueSchema.safeParse({ source: "shell", value: "$(echo x)" });
    expect(result.success).toBe(false);
  });

  it("awsCredentialSchema requires authMode", () => {
    expect(awsCredentialSchema.safeParse({ region: "us-east-1" }).success).toBe(false);
    expect(awsCredentialSchema.safeParse({ authMode: "profile", region: "us-east-1", awsProfile: "default" }).success).toBe(true);
  });

  it("awsCredentialSchema accepts all three auth modes", () => {
    for (const authMode of ["profile", "iam", "bearer"] as const) {
      const result = awsCredentialSchema.safeParse({ authMode, region: "us-east-1" });
      expect(result.success).toBe(true);
    }
  });

  it("azureCredentialSchema requires apiKey", () => {
    expect(azureCredentialSchema.safeParse({}).success).toBe(false);
    expect(azureCredentialSchema.safeParse({ apiKey: "azure-secret" }).success).toBe(true);
  });

  it("gcpAdcCredentialSchema requires project + location", () => {
    expect(gcpAdcCredentialSchema.safeParse({ project: "" }).success).toBe(false);
    expect(gcpAdcCredentialSchema.safeParse({ project: "p", location: "us-central1" }).success).toBe(true);
  });

  it("localCredentialSchema accepts loopback and private-network baseUrl values", () => {
    for (const baseUrl of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:11434/v1",
      "http://10.0.0.20:11434/v1",
      "https://172.16.0.10:11434/v1",
      "http://172.31.255.255:11434/v1",
      "http://192.168.1.20:11434/v1",
      "http://169.254.1.20:11434/v1",
      "http://[::1]:11434/v1",
      "http://[fc00::1]:11434/v1",
      "http://[fd12::1]:11434/v1",
      "http://[fe80::1]:11434/v1",
    ]) {
      expect(localCredentialSchema.safeParse({ baseUrl }).success).toBe(true);
      expect(isLocalConnectorBaseUrl(baseUrl)).toBe(true);
    }
  });

  it("localCredentialSchema rejects remote OpenAI-compatible endpoints", () => {
    for (const baseUrl of [
      "https://api.openai.com/v1",
      "https://example.com/v1",
      "http://172.32.0.1:11434/v1",
      "http://100.64.0.1:11434/v1",
      "ftp://localhost:11434/v1",
      "http://user:pass@127.0.0.1:11434/v1",
    ]) {
      expect(localCredentialSchema.safeParse({ baseUrl }).success).toBe(false);
      expect(isLocalConnectorBaseUrl(baseUrl)).toBe(false);
    }
  });

  it("credentialPayloadSchema discriminates on kind", () => {
    expect(
      credentialPayloadSchema.safeParse({
        kind: "api_key",
        value: { source: "literal", value: "sk-x" },
      }).success,
    ).toBe(true);
    expect(
      credentialPayloadSchema.safeParse({
        kind: "azure",
        value: { source: "literal", value: "wrong-shape" },
      }).success,
    ).toBe(false);
  });

  it("saveCredentialInputSchema requires connectorId + payload", () => {
    expect(
      saveCredentialInputSchema.safeParse({
        connectorId: "anthropic",
        payload: { kind: "api_key", value: { source: "literal", value: "sk-x" } },
      }).success,
    ).toBe(true);
    expect(saveCredentialInputSchema.safeParse({ connectorId: "" }).success).toBe(false);
    expect(saveCredentialInputSchema.safeParse({ payload: {} }).success).toBe(false);
  });

  it("removeCredentialInputSchema rejects empty connectorId", () => {
    expect(removeCredentialInputSchema.safeParse({ connectorId: "openai" }).success).toBe(true);
    expect(removeCredentialInputSchema.safeParse({ connectorId: "" }).success).toBe(false);
    expect(removeCredentialInputSchema.safeParse({}).success).toBe(false);
  });

  it("testCredentialInputSchema rejects empty connectorId", () => {
    expect(testCredentialInputSchema.safeParse({ connectorId: "openai" }).success).toBe(true);
    expect(testCredentialInputSchema.safeParse({ connectorId: "" }).success).toBe(false);
  });
});

describe("oauth Zod schemas", () => {
  it("oauthStartInputSchema rejects empty connectorId", () => {
    expect(oauthStartInputSchema.safeParse({ connectorId: "claude-pro" }).success).toBe(true);
    expect(oauthStartInputSchema.safeParse({ connectorId: "" }).success).toBe(false);
  });

  it("oauthCancelInputSchema rejects missing connectorId", () => {
    expect(oauthCancelInputSchema.safeParse({ connectorId: "claude-pro" }).success).toBe(true);
    expect(oauthCancelInputSchema.safeParse({}).success).toBe(false);
  });

  it("oauthPromptResponseSchema requires connectorId, requestId and a (possibly empty) value", () => {
    expect(
      oauthPromptResponseSchema.safeParse({
        connectorId: "github-copilot",
        requestId: "req-1",
        value: "github.com",
      }).success,
    ).toBe(true);
    expect(
      oauthPromptResponseSchema.safeParse({ connectorId: "github-copilot", requestId: "" }).success,
    ).toBe(false);
    expect(
      oauthPromptResponseSchema.safeParse({ connectorId: "github-copilot", value: "x" }).success,
    ).toBe(false);
  });

  it("oauthManualCodeResponseSchema requires non-empty code", () => {
    expect(
      oauthManualCodeResponseSchema.safeParse({
        connectorId: "anthropic",
        requestId: "req-1",
        code: "abcd",
      }).success,
    ).toBe(true);
    expect(
      oauthManualCodeResponseSchema.safeParse({
        connectorId: "anthropic",
        requestId: "req-1",
        code: "",
      }).success,
    ).toBe(false);
  });
});
