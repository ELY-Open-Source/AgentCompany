import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopResult } from "../../src/shared/contracts";
import { IPC_CHANNELS } from "../../src/shared/contracts";
import type { CredentialResolver } from "../../src/main/credentials/credential-resolver";
import type { CredentialStore } from "../../src/main/credentials/credential-store";

const streamMocks = vi.hoisted(() => ({
  safeStreamSimpleWithEnv: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    removeHandler: vi.fn(),
  },
}));

vi.mock("../../src/main/worker/runtime/pi-safe-stream", () => ({
  safeStreamSimpleWithEnv: streamMocks.safeStreamSimpleWithEnv,
}));

import { registerCredentialIpcHandlers } from "../../src/main/ipc-credentials-handlers";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>;

function createDeps(overrides: { resolver?: Partial<CredentialResolver>; store?: Partial<CredentialStore> } = {}) {
  const handlers = new Map<string, IpcHandler>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const resolver = {
    resolve: vi.fn(async () => ({
      apiKey: "sk-proj-testcredentialsecret0123456789",
    })),
    ...(overrides.resolver ?? {}),
  } as unknown as CredentialResolver;

  registerCredentialIpcHandlers({
    store: {
      list: vi.fn(() => []),
      save: vi.fn(),
      remove: vi.fn(),
      ...(overrides.store ?? {}),
    } as unknown as CredentialStore,
    resolver,
    emitEvent: vi.fn(),
    refreshConnectorHealth: vi.fn(async () => {}),
    registerHandle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    fail: (code, message) => ({ ok: false, error: { code, message } }),
    logger,
  });

  const handler = handlers.get(IPC_CHANNELS.credentialsTest);
  if (!handler) {
    throw new Error("credentialsTest handler was not registered.");
  }
  return { handler, handlers, logger };
}

async function runCredentialTest(handler: IpcHandler) {
  return handler(null as unknown as IpcMainInvokeEvent, { connectorId: "fireworks" }) as Promise<DesktopResult<{
    ok: boolean;
    message: string;
  }>>;
}

function requireHandler(handlers: Map<string, IpcHandler>, channel: string) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`${channel} handler was not registered.`);
  }
  return handler;
}

function joinLogCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.flat().map(String).join(" ");
}

describe("credential IPC handler logging", () => {
  beforeEach(() => {
    streamMocks.safeStreamSimpleWithEnv.mockReset();
  });

  it("redacts resolver failures for the UI and logs only safe credential test metadata", async () => {
    const secret = "sk-proj-resolversecret012345678901234";
    const error = Object.assign(
      new Error(`failed for ${secret} at https://api.fireworks.ai/inference/v1`),
      { code: "CREDENTIAL_INVALID", $metadata: { requestId: "req_resolver_123" } },
    );
    const { handler, logger } = createDeps({
      resolver: {
        resolve: vi.fn(async () => {
          throw error;
        }),
      },
    });

    const result = await runCredentialTest(handler);
    const log = joinLogCalls(logger.error);

    expect(result).toEqual({
      ok: true,
      data: {
        ok: false,
        message: "failed for sk-proj-[REDACTED] at https://api.fireworks.ai/inference/v1",
      },
    });
    expect(log).toBe("[credentials] test failed: connector=fireworks provider=fireworks code=CREDENTIAL_INVALID requestId=req_resolver_123");
    expect(log).not.toContain(secret);
    expect(log).not.toContain("api.fireworks.ai");
  });

  it("keeps stream error messages out of credential test logs", async () => {
    const secret = "Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload";
    streamMocks.safeStreamSimpleWithEnv.mockReturnValueOnce({
      result: vi.fn(async () => ({
        stopReason: "error",
        errorMessage: `provider rejected ${secret} for https://api.fireworks.ai/inference/v1`,
      })),
    });
    const { handler, logger } = createDeps();

    const result = await runCredentialTest(handler);
    const log = joinLogCalls(logger.warn);

    expect(result).toEqual({
      ok: true,
      data: {
        ok: false,
        message: "provider rejected Bearer [REDACTED] for https://api.fireworks.ai/inference/v1",
      },
    });
    expect(log).toBe("[credentials] test failed: connector=fireworks provider=fireworks code=stream_error");
    expect(log).not.toContain(secret);
    expect(log).not.toContain("api.fireworks.ai");
  });

  it("logs safe code and request id when credential test streaming throws", async () => {
    const secret = "AKIA1234567890ABCDEF";
    const error = Object.assign(
      new Error(`upstream threw ${secret} at https://bedrock-runtime.us-east-1.amazonaws.com`),
      {
        code: "AccessDeniedException",
        response: { headers: new Map([["x-request-id", "req_stream_456"]]) },
      },
    );
    streamMocks.safeStreamSimpleWithEnv.mockReturnValueOnce({
      result: vi.fn(async () => {
        throw error;
      }),
    });
    const { handler, logger } = createDeps();

    const result = await runCredentialTest(handler);
    const log = joinLogCalls(logger.error);

    expect(result).toEqual({
      ok: true,
      data: {
        ok: false,
        message: "upstream threw AKIA[REDACTED] at https://bedrock-runtime.us-east-1.amazonaws.com",
      },
    });
    expect(log).toBe("[credentials] test failed: connector=fireworks provider=fireworks code=AccessDeniedException requestId=req_stream_456");
    expect(log).not.toContain(secret);
    expect(log).not.toContain("bedrock-runtime.us-east-1.amazonaws.com");
  });

  it("keeps raw save failure messages out of credential logs", async () => {
    const secret = "sk-proj-savesecret012345678901234";
    const error = Object.assign(
      new Error(`save failed for ${secret} at https://api.fireworks.ai/account/acme`),
      { requestId: "req_save_789" },
    );
    const { handlers, logger } = createDeps({
      store: {
        save: vi.fn(() => {
          throw error;
        }),
      },
    });
    const saveHandler = requireHandler(handlers, IPC_CHANNELS.credentialsSave);

    const result = await saveHandler(null as unknown as IpcMainInvokeEvent, {
      connectorId: "fireworks",
      payload: {
        kind: "api_key",
        value: { source: "literal", value: secret },
      },
    });
    const log = joinLogCalls(logger.error);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "SAVE_FAILED",
        message: "Could not save credential. Check application logs for details.",
      },
    });
    expect(log).toBe("[credentials] save failed: connector=fireworks provider=fireworks code=credentials.save.failed requestId=req_save_789");
    expect(log).not.toContain(secret);
    expect(log).not.toContain("api.fireworks.ai");
  });

  it("sanitizes connector ids on remove failure logs", async () => {
    const connectorId = "unknown\nhttps://api.fireworks.ai/account/sk-proj-remove012345678901234";
    const { handlers, logger } = createDeps({
      store: {
        remove: vi.fn(() => {
          throw new Error("remove failed for https://api.fireworks.ai/account/sk-proj-remove012345678901234");
        }),
      },
    });
    const removeHandler = requireHandler(handlers, IPC_CHANNELS.credentialsRemove);

    const result = await removeHandler(null as unknown as IpcMainInvokeEvent, { connectorId });
    const log = joinLogCalls(logger.error);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "REMOVE_FAILED",
        message: "Could not remove credential. Check application logs for details.",
      },
    });
    expect(log).toBe("[credentials] remove failed: connector=invalid provider=unknown code=credentials.remove.failed");
    expect(log).not.toContain("api.fireworks.ai");
    expect(log).not.toContain("sk-proj-remove012345678901234");
  });

  it("sanitizes connector ids on unknown connector test logs", async () => {
    const connectorId = "missing\nhttps://api.fireworks.ai/account/sk-proj-unknown012345678901234";
    const { handler, logger } = createDeps();

    const result = await handler(null as unknown as IpcMainInvokeEvent, { connectorId });
    const log = joinLogCalls(logger.error);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNKNOWN_CONNECTOR",
        message: "Unknown connector.",
      },
    });
    expect(log).toBe("[credentials] test failed: connector=invalid provider=unknown code=credentials.test.unknown_connector");
    expect(log).not.toContain("api.fireworks.ai");
    expect(log).not.toContain("sk-proj-unknown012345678901234");
  });
});
