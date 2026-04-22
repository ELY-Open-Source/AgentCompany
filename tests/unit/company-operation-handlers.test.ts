import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/contracts";
import { registerCompanyOperationsHandlers } from "../../src/main/ipc-company-operations";
import type { CompanyOperationHandlerDependencies } from "../../src/main/ipc-company-operations/types";

describe("company operation IPC handlers", () => {
  it("registers only company-operation channels through the company-operation registry", () => {
    const registeredChannels = new Set<string>();

    registerCompanyOperationsHandlers({
      registerHandle: (channel) => {
        registeredChannels.add(channel);
      },
      db: {} as CompanyOperationHandlerDependencies["db"],
      ensureCompanyExists: () => null,
      findInvalidReference: () => null,
      publishDomainChanged: vi.fn(),
      dispatchAutomation: vi.fn(),
      threadIntegration: {} as CompanyOperationHandlerDependencies["threadIntegration"],
      checkpointEngine: {} as CompanyOperationHandlerDependencies["checkpointEngine"],
      lifecycleProcessor: {} as CompanyOperationHandlerDependencies["lifecycleProcessor"],
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect([...registeredChannels].sort()).toEqual([
      IPC_CHANNELS.deleteDocument,
      IPC_CHANNELS.deleteKnowledgeEntry,
      IPC_CHANNELS.deleteMeeting,
      IPC_CHANNELS.deleteSprint,
      IPC_CHANNELS.saveDocument,
      IPC_CHANNELS.saveKnowledgeEntry,
      IPC_CHANNELS.saveMeeting,
      IPC_CHANNELS.saveSprint,
    ].sort());
  });
});
