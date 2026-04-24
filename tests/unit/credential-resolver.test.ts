import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { CredentialStore } from "../../src/main/credentials/credential-store";
import { CredentialResolver, CredentialError } from "../../src/main/credentials/credential-resolver";
import { AppError } from "../../src/main/errors";

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

describe("CredentialResolver", () => {
  let tempDir: string;
  let db: AppDatabase;
  let store: CredentialStore;
  let resolver: CredentialResolver;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-credential-resolver-"));
    db = new AppDatabase(tempDir);
    db.init();
    store = new CredentialStore({ db });
    resolver = new CredentialResolver(store);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns the literal apiKey for an api_key connector", async () => {
    store.save("anthropic", {
      kind: "api_key",
      value: { source: "literal", value: "sk-ant-test-1234567890abcd" },
    });
    const resolved = await resolver.resolve("anthropic");
    expect(resolved.apiKey).toBe("sk-ant-test-1234567890abcd");
    expect(resolved.extraEnv).toBeUndefined();
  });

  it("resolves an api_key connector backed by an env variable", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env-1234";
    store.save("openai", {
      kind: "api_key",
      value: { source: "env", value: "OPENAI_API_KEY" },
    });
    try {
      const resolved = await resolver.resolve("openai");
      expect(resolved.apiKey).toBe("sk-from-env-1234");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("throws CREDENTIAL_MISSING when the env-backed key is unset", async () => {
    delete process.env.XAI_API_KEY;
    store.save("xai", { kind: "api_key", value: { source: "env", value: "XAI_API_KEY" } });
    let thrown: unknown;
    try {
      await resolver.resolve("xai");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CredentialError);
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      kind: "upstream",
      code: "CREDENTIAL_MISSING",
      connectorId: "xai",
      context: { connectorId: "xai" },
    });
  });

  it("assembles AWS extraEnv for IAM auth mode", async () => {
    store.save("amazon-bedrock", {
      kind: "aws",
      value: {
        authMode: "iam",
        region: "us-west-2",
        accessKeyId: "AKIA-TEST-FAKE-1234",
        secretAccessKey: "secret-fake-secret",
        sessionToken: "session-fake-token",
      },
    });
    const resolved = await resolver.resolve("amazon-bedrock");
    expect(resolved.apiKey).toBe("");
    expect(resolved.extraEnv).toEqual({
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIA-TEST-FAKE-1234",
      AWS_SECRET_ACCESS_KEY: "secret-fake-secret",
      AWS_SESSION_TOKEN: "session-fake-token",
    });
  });

  it("assembles AWS extraEnv for profile auth mode plus advanced flags", async () => {
    store.save("amazon-bedrock", {
      kind: "aws",
      value: {
        authMode: "profile",
        region: "eu-west-1",
        awsProfile: "production",
        forceCache: true,
        endpointUrl: "https://bedrock-runtime.example.com",
        skipAuth: true,
        forceHttp1: true,
      },
    });
    const resolved = await resolver.resolve("amazon-bedrock");
    expect(resolved.extraEnv).toEqual({
      AWS_REGION: "eu-west-1",
      AWS_PROFILE: "production",
      AWS_BEDROCK_FORCE_CACHE: "1",
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://bedrock-runtime.example.com",
      AWS_BEDROCK_SKIP_AUTH: "1",
      AWS_BEDROCK_FORCE_HTTP1: "1",
    });
  });

  it("assembles Azure extraEnv with deploymentMap", async () => {
    store.save("azure-openai", {
      kind: "azure",
      value: {
        apiKey: "azure-secret-key",
        baseUrl: "https://my-resource.openai.azure.com/",
        resourceName: "my-resource",
        apiVersion: "2024-08-01-preview",
        deploymentMap: { "gpt-4o": "gpt4-deploy", "gpt-4o-mini": "gpt4mini-deploy" },
      },
    });
    const resolved = await resolver.resolve("azure-openai");
    expect(resolved.apiKey).toBe("azure-secret-key");
    expect(resolved.extraEnv).toMatchObject({
      AZURE_OPENAI_API_KEY: "azure-secret-key",
      AZURE_OPENAI_BASE_URL: "https://my-resource.openai.azure.com/",
      AZURE_OPENAI_RESOURCE_NAME: "my-resource",
      AZURE_OPENAI_API_VERSION: "2024-08-01-preview",
    });
    expect(resolved.extraEnv?.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).toContain("gpt-4o=gpt4-deploy");
  });

  it("assembles Vertex extraEnv from project + location + credentials path", async () => {
    store.save("google-vertex", {
      kind: "gcp_adc",
      value: {
        project: "my-gcp-project",
        location: "us-central1",
        credentialsPath: "/etc/gcp/service-account.json",
      },
    });
    const resolved = await resolver.resolve("google-vertex");
    expect(resolved.apiKey).toBe("");
    expect(resolved.extraEnv).toEqual({
      GOOGLE_CLOUD_PROJECT: "my-gcp-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_APPLICATION_CREDENTIALS: "/etc/gcp/service-account.json",
    });
  });
});
