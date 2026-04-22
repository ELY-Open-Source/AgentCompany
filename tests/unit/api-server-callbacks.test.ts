import { describe, expect, it } from "vitest";
import { createApiServer, type ApiServerEventCallbacks } from "../../src/main/api-server";
import type { AppDatabase } from "../../src/main/database";
import { createTestApiServerCallbacks } from "../support/api-server-callbacks";

describe("api server callback contract", () => {
  it("fails during construction when the callback object is missing", () => {
    expect(() => {
      createApiServer({} as AppDatabase, undefined as unknown as ApiServerEventCallbacks);
    }).toThrow("Missing AgentApiServer callbacks.");
  });

  it("fails during construction when a required callback is missing", () => {
    const callbacks: Partial<ApiServerEventCallbacks> = createTestApiServerCallbacks();
    delete callbacks.onTaskCreated;

    expect(() => {
      createApiServer({} as AppDatabase, callbacks as ApiServerEventCallbacks);
    }).toThrow("Missing AgentApiServer callback: onTaskCreated");
  });

  it("constructs the server when every callback is explicit", () => {
    const callbacks = createTestApiServerCallbacks();
    const server = createApiServer({} as AppDatabase, callbacks);

    expect(server.callbacks.onTaskCreated).toBe(callbacks.onTaskCreated);
    expect(server.onDomainChanged).toBe(callbacks.onDomainChanged);
    expect(server.onWakeAgent).toBe(callbacks.onWakeAgent);
  });
});
