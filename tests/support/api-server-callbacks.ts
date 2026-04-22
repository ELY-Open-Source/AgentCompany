import type { ApiServerEventCallbacks } from "../../src/main/api-server";

export function createTestApiServerCallbacks(
  overrides: Partial<ApiServerEventCallbacks> = {},
): ApiServerEventCallbacks {
  return {
    onDomainChanged: () => {},
    onWakeAgent: () => null,
    onTaskCreated: () => {},
    onTaskStatusChanged: () => {},
    onCommentPosted: () => {},
    onApprovalCreated: () => {},
    onApprovalResolved: () => {},
    createDocument: () => {
      throw new Error("createDocument test callback was not provided.");
    },
    onAutoAssignTask: () => null,
    onHumanMessage: () => {},
    injectRuntimeMessage: () => false,
    emitEvent: () => {},
    notify: () => {},
    ...overrides,
  };
}
