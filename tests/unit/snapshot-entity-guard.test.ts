import { describe, expect, it, vi } from "vitest";
import {
  createSnapshotEventGuard,
  type GranularEventEntry,
  type SnapshotEventGuard,
} from "@renderer/lib/snapshot-events";

async function handleSnapshotEntityEvent(
  entry: GranularEventEntry,
  deps: {
    companyId: string | null;
    getTask: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: unknown }>;
    getRun: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: unknown }>;
    getApproval: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: unknown }>;
    getAgent: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: unknown }>;
    patchTask: (task: unknown) => void;
    removeTask: (id: string) => void;
    patchRun: (run: unknown) => void;
    removeRun: (id: string) => void;
    patchApproval: (approval: unknown) => void;
    removeApproval: (id: string) => void;
    patchAgent: (agent: unknown) => void;
    fullRefresh: () => void;
  },
  eventGuard: SnapshotEventGuard = createSnapshotEventGuard(),
) {
  function requestFullRefresh() {
    eventGuard.invalidateSnapshot();
    deps.fullRefresh();
  }

  if (!deps.companyId) {
    requestFullRefresh();
    return;
  }

  let needsFullRefresh = false;
  eventGuard.invalidateSnapshot();
  eventGuard.invalidateEntity(entry);
  const token = eventGuard.captureEntity(entry);

  if (entry.type === "run-updated" && entry.action === "completed") {
    needsFullRefresh = true;
  } else {
    try {
      switch (entry.type) {
        case "task-updated": {
          if (entry.action === "deleted") {
            deps.removeTask(entry.entityId);
          } else {
            const result = await deps.getTask({ companyId: deps.companyId, id: entry.entityId });
            if (!eventGuard.canApplyEntity(entry, token)) return;
            if (result.ok) {
              deps.patchTask(result.data);
            } else {
              deps.removeTask(entry.entityId);
            }
          }
          break;
        }
        case "run-updated": {
          if (entry.action === "deleted") {
            deps.removeRun(entry.entityId);
          } else {
            const result = await deps.getRun({ companyId: deps.companyId, id: entry.entityId });
            if (!eventGuard.canApplyEntity(entry, token)) return;
            if (result.ok) {
              deps.patchRun(result.data);
            } else {
              deps.removeRun(entry.entityId);
            }
          }
          break;
        }
        case "approval-updated": {
          if (entry.action === "deleted") {
            deps.removeApproval(entry.entityId);
          } else {
            const result = await deps.getApproval({ companyId: deps.companyId, id: entry.entityId });
            if (!eventGuard.canApplyEntity(entry, token)) return;
            if (result.ok) {
              deps.patchApproval(result.data);
            } else {
              deps.removeApproval(entry.entityId);
            }
          }
          break;
        }
        case "agent-updated": {
          const result = await deps.getAgent({ companyId: deps.companyId, id: entry.entityId });
          if (!eventGuard.canApplyEntity(entry, token)) return;
          if (result.ok) {
            deps.patchAgent(result.data);
          } else {
            needsFullRefresh = true;
          }
          break;
        }
        case "budget-changed": {
          needsFullRefresh = true;
          break;
        }
        default: {
          needsFullRefresh = true;
          break;
        }
      }
    } catch {
      needsFullRefresh = true;
    }
  }

  if (needsFullRefresh) {
    requestFullRefresh();
  }
}

function createMockDeps() {
  return {
    companyId: "company-1" as string | null,
    getTask: vi.fn().mockResolvedValue({ ok: true, data: { id: "t-1", title: "Test task" } }),
    getRun: vi.fn().mockResolvedValue({ ok: true, data: { id: "r-1", status: "running" } }),
    getApproval: vi.fn().mockResolvedValue({ ok: true, data: { id: "a-1", state: "pending" } }),
    getAgent: vi.fn().mockResolvedValue({ ok: true, data: { id: "ag-1", name: "Agent" } }),
    patchTask: vi.fn(),
    removeTask: vi.fn(),
    patchRun: vi.fn(),
    removeRun: vi.fn(),
    patchApproval: vi.fn(),
    removeApproval: vi.fn(),
    patchAgent: vi.fn(),
    fullRefresh: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("snapshot entity guard", () => {
  it("task-updated event calls getTask and patchTask", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
    );
    expect(deps.getTask).toHaveBeenCalledWith({ companyId: "company-1", id: "t-1" });
    expect(deps.patchTask).toHaveBeenCalledWith({ id: "t-1", title: "Test task" });
    expect(deps.fullRefresh).toHaveBeenCalledTimes(0);
  });

  it("deleted task calls removeTask without fetching", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "deleted" },
      deps,
    );
    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
    expect(deps.getTask).toHaveBeenCalledTimes(0);
    expect(deps.fullRefresh).toHaveBeenCalledTimes(0);
  });

  it("task delete invalidates a pending full snapshot refresh token", async () => {
    const deps = createMockDeps();
    const eventGuard = createSnapshotEventGuard();
    eventGuard.invalidateSnapshot();
    const pendingRefresh = eventGuard.captureSnapshot();

    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "deleted" },
      deps,
      eventGuard,
    );

    expect(eventGuard.canApplySnapshot(pendingRefresh)).toBe(false);
    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
  });

  it("delayed task update cannot resurrect a task deleted by a later event", async () => {
    const deps = createMockDeps();
    const eventGuard = createSnapshotEventGuard();
    const taskFetch = deferred<{ ok: boolean; data: { id: string; title: string } }>();
    deps.getTask.mockReturnValue(taskFetch.promise);

    const update = handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
      eventGuard,
    );
    expect(deps.getTask).toHaveBeenCalledWith({ companyId: "company-1", id: "t-1" });

    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "deleted" },
      deps,
      eventGuard,
    );
    taskFetch.resolve({ ok: true, data: { id: "t-1", title: "Stale task" } });
    await update;

    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
    expect(deps.patchTask).toHaveBeenCalledTimes(0);
  });

  it("newer full refresh invalidates a delayed task update", async () => {
    const deps = createMockDeps();
    const eventGuard = createSnapshotEventGuard();
    const taskFetch = deferred<{ ok: boolean; data: { id: string; title: string } }>();
    deps.getTask.mockReturnValue(taskFetch.promise);

    const update = handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
      eventGuard,
    );
    eventGuard.invalidateSnapshot();
    taskFetch.resolve({ ok: true, data: { id: "t-1", title: "Stale task" } });
    await update;

    expect(deps.patchTask).toHaveBeenCalledTimes(0);
  });

  it("later task update wins over an earlier delayed task update", async () => {
    const deps = createMockDeps();
    const eventGuard = createSnapshotEventGuard();
    const firstFetch = deferred<{ ok: boolean; data: { id: string; title: string } }>();
    const secondFetch = deferred<{ ok: boolean; data: { id: string; title: string } }>();
    deps.getTask
      .mockReturnValueOnce(firstFetch.promise)
      .mockReturnValueOnce(secondFetch.promise);

    const firstUpdate = handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
      eventGuard,
    );
    const secondUpdate = handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
      eventGuard,
    );

    secondFetch.resolve({ ok: true, data: { id: "t-1", title: "Fresh task" } });
    await secondUpdate;
    firstFetch.resolve({ ok: true, data: { id: "t-1", title: "Stale task" } });
    await firstUpdate;

    expect(deps.patchTask).toHaveBeenCalledTimes(1);
    expect(deps.patchTask).toHaveBeenCalledWith({ id: "t-1", title: "Fresh task" });
  });

  it("run-updated completed triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "run-updated", entityId: "r-1", action: "completed" },
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
    expect(deps.getRun).toHaveBeenCalledTimes(0);
  });

  it("failed getTask fetch removes the missing task", async () => {
    const deps = createMockDeps();
    deps.getTask.mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "missing" } });
    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
    );
    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
    expect(deps.patchTask).toHaveBeenCalledTimes(0);
  });

  it("approval-updated event calls getApproval and patchApproval", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "approval-updated", entityId: "a-1", action: "decided" },
      deps,
    );
    expect(deps.getApproval).toHaveBeenCalledWith({ companyId: "company-1", id: "a-1" });
    expect(deps.patchApproval).toHaveBeenCalledWith({ id: "a-1", state: "pending" });
  });

  it("agent-updated event calls getAgent and patchAgent", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "agent-updated", entityId: "ag-1", action: "paused" },
      deps,
    );
    expect(deps.getAgent).toHaveBeenCalledWith({ companyId: "company-1", id: "ag-1" });
    expect(deps.patchAgent).toHaveBeenCalledWith({ id: "ag-1", name: "Agent" });
  });

  it("budget-changed triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "budget-changed", entityId: "c-1", action: "changed" },
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
  });

  it("missing companyId triggers full refresh", async () => {
    const deps = createMockDeps();
    deps.companyId = null;
    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
    expect(deps.getTask).toHaveBeenCalledTimes(0);
  });

  it("IPC error triggers full refresh", async () => {
    const deps = createMockDeps();
    deps.getTask.mockRejectedValue(new Error("IPC failed"));
    await handleSnapshotEntityEvent(
      { type: "task-updated", entityId: "t-1", action: "updated" },
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
  });

  it("unknown entity event triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "future-entity", entityId: "x-1", action: "created" } as unknown as GranularEventEntry,
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
  });

  it("run-updated status change fetches and patches run", async () => {
    const deps = createMockDeps();
    await handleSnapshotEntityEvent(
      { type: "run-updated", entityId: "r-1", action: "status_changed" },
      deps,
    );
    expect(deps.getRun).toHaveBeenCalledWith({ companyId: "company-1", id: "r-1" });
    expect(deps.patchRun).toHaveBeenCalledWith({ id: "r-1", status: "running" });
    expect(deps.fullRefresh).toHaveBeenCalledTimes(0);
  });
});
