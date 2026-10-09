import { describe, expect, test } from "vitest";
import { spaceMembers, spaceReaders } from "../../src/renderer/src/pages/chat/chat-helpers";
import type { AgentRecord, ChatMembershipRecord, ChatSpaceRecord, EmployeeRecord } from "../../src/shared/domain";

const ORG = "org_1";

function agent(id: string, name: string): AgentRecord {
  return {
    id, orgId: ORG, name, role: name, department: "Engineering", modelProviderId: null, modelId: null,
    budgetCents: 0, managerAgentId: null, title: name, roleLevel: "staff",
    modelStrategy: "explicit", workspaceId: null, heartbeatEnabled: false, heartbeatIntervalSec: 0,
    lifecycle: "active", avatarEmoji: null, avatarColor: null, avatarImage: null, createdAt: "2026-01-01T00:00:00Z",
  };
}

const employees: EmployeeRecord[] = [{ id: "emp_yang", orgId: ORG, displayName: "Yang", role: "founder", avatarEmoji: null, avatarColor: null, avatarImage: null, createdAt: "2026-01-01T00:00:00Z" }];
const agents = [agent("agt_ceo", "CEO"), agent("agt_dana", "Dana"), agent("agt_eve", "Eve")];
const member = (spaceId: string, principalType: "employee" | "agent", principalId: string): ChatMembershipRecord => ({ spaceId, principalType, principalId, role: "member", muteState: "unmuted" });
const space = (id: string, spaceType: string, visibility: string): ChatSpaceRecord => ({ id, orgId: ORG, spaceType, name: id, topic: "t", visibility, retentionPolicy: "standard", createdAt: "2026-01-01T00:00:00Z" });

describe("who is in a conversation", () => {
  test("lists every member, spoken or not, with how each agent replies", () => {
    const memberships = [member("eng", "employee", "emp_yang"), member("eng", "agent", "agt_ceo"), member("eng", "agent", "agt_dana"), member("dm", "employee", "emp_yang"), member("dm", "agent", "agt_dana")];
    expect(spaceMembers(space("eng", "department", "workspace"), memberships, employees, agents, "agt_ceo")).toEqual([
      { id: "emp_yang", name: "Yang", bot: false, duty: "Reads and writes" },
      { id: "agt_ceo", name: "CEO", bot: true, duty: "Replies when @mentioned, in threads it joined, and to messages that name no one" },
      { id: "agt_dana", name: "Dana", bot: true, duty: "Replies when @mentioned and in threads it joined" },
    ]);
    expect(spaceMembers(space("dm", "direct", "restricted"), memberships, employees, agents, null).map((item) => item.duty)).toEqual(["Reads and writes", "Replies to every message"]);
  });

  test("says who can read beyond the member list", () => {
    expect(spaceReaders(space("eng", "department", "workspace"))).toBe("Everyone in the company can read this channel.");
    expect(spaceReaders(space("ops", "project", "restricted"))).toBe("Only members can read this channel.");
    expect(spaceReaders(space("dm", "direct", "restricted"))).toBe("Only the people in this conversation can read it.");
  });
});
