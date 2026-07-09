import { describe, expect, test } from "vitest";
import { collectDepartments } from "../../src/renderer/src/pages/files/file-helpers";
import type { AgentRecord, FileObjectRecord } from "../../src/shared/domain";

function agent(id: string, department: string): AgentRecord {
  return {
    id, orgId: "org", name: id, role: "engineer", department,
    modelProviderId: null, modelId: null, budgetCents: 0, managerAgentId: null,
    title: id, roleLevel: "ic", modelStrategy: "single", workspaceId: null,
    heartbeatEnabled: false, heartbeatIntervalSec: 0, lifecycle: "active",
    avatarEmoji: null, avatarColor: null, createdAt: "2026-01-01",
  };
}

function file(id: string, ownerType: FileObjectRecord["ownerType"], ownerId: string | null): FileObjectRecord {
  return {
    id, orgId: "org", name: id, kind: "doc", sizeBytes: 1, sha256: "x", storagePath: `/tmp/${id}`,
    ownerType, ownerId, spaceId: null, pinned: false, scanState: "approved", scanLabelsJson: "[]",
    scannedAt: null, createdAt: "2026-01-01", updatedAt: null,
  };
}

describe("collectDepartments", () => {
  test("counts files per department, not agents, and omits empty departments", () => {
    const agents = [agent("a1", "Engineering"), agent("a2", "Engineering"), agent("a3", "Design"), agent("a4", "Sales")];
    const files = [
      file("f1", "agent", "a1"),
      file("f2", "agent", "a1"),
      file("f3", "agent", "a3"),
      file("f4", "employee", "emp1"), // not owned by an agent → ignored
    ];
    // Engineering has two agents but only a1 holds files (2); Design has 1; Sales has agents but no files.
    expect(collectDepartments(files, agents)).toEqual([
      { name: "Design", count: 1 },
      { name: "Engineering", count: 2 },
    ]);
  });

  test("returns nothing when no agent owns a file", () => {
    expect(collectDepartments([], [agent("a1", "Engineering")])).toEqual([]);
  });
});
