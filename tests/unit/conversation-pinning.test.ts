import { describe, expect, test } from "vitest";
import { buildConversations } from "../../src/renderer/src/pages/chat/chat-helpers";
import type {
  AgentRecord,
  ChatMembershipRecord,
  ChatMessageRecord,
  ChatReadStateRecord,
  ChatSpaceRecord,
  EmployeeRecord,
} from "../../src/shared/domain";

const ORG = "org_1";
const FOUNDER = "emp_founder";
const CEO = "agt_ceo";
const ENGINEER = "agt_engineer";

function space(id: string, spaceType: string, name: string, createdAt: string): ChatSpaceRecord {
  return { id, orgId: ORG, spaceType, name, topic: "t", visibility: "restricted", retentionPolicy: "standard", createdAt };
}

function member(spaceId: string, principalType: "employee" | "agent", principalId: string): ChatMembershipRecord {
  return { spaceId, principalType, principalId, role: "member", muteState: "unmuted" };
}

function message(id: string, spaceId: string, senderId: string, createdAt: string): ChatMessageRecord {
  return {
    id, orgId: ORG, spaceId, threadId: `thr_${id}`, senderType: "agent", senderId,
    bodyMd: "hello", bodyStructuredJson: "{}", deliveryState: "sent", createdAt, editedAt: null, deletedAt: null,
  };
}

function agent(id: string, name: string, roleLevel: string): AgentRecord {
  return {
    id, orgId: ORG, name, role: name, department: "Executive", modelProviderId: null, modelId: null,
    budgetCents: 0, managerAgentId: roleLevel === "c_suite" ? null : CEO, title: name, roleLevel,
    modelStrategy: "explicit", workspaceId: null, heartbeatEnabled: false, heartbeatIntervalSec: 0,
    lifecycle: "active", avatarEmoji: null, avatarColor: null, avatarImage: null, createdAt: "2026-01-01T00:00:00Z",
  };
}

const employees: EmployeeRecord[] = [{
  id: FOUNDER, orgId: ORG, displayName: "Yang", role: "founder",
  avatarEmoji: null, avatarColor: null, avatarImage: null, createdAt: "2026-01-01T00:00:00Z",
}];
const agents: AgentRecord[] = [agent(CEO, "CEO", "c_suite"), agent(ENGINEER, "Dana", "staff")];

// The founder⇄CEO conversation is the OLDEST and QUIETEST space; the busy
// channel and the CEO⇄engineer conversation both out-recency it. Pinning
// must beat recency, and only from the founder's own seat.
function fixtures() {
  const spaces = [
    space("spc_ceo_dm", "direct", "Yang · CEO", "2026-01-01T00:00:00Z"),
    space("spc_general", "company", "general", "2026-01-02T00:00:00Z"),
    space("spc_agents_dm", "direct", "CEO · Dana", "2026-01-03T00:00:00Z"),
  ];
  const memberships = [
    member("spc_ceo_dm", "employee", FOUNDER),
    member("spc_ceo_dm", "agent", CEO),
    member("spc_general", "employee", FOUNDER),
    member("spc_general", "agent", CEO),
    member("spc_general", "agent", ENGINEER),
    member("spc_agents_dm", "agent", CEO),
    member("spc_agents_dm", "agent", ENGINEER),
  ];
  const messages = [
    message("m1", "spc_ceo_dm", CEO, "2026-01-04T00:00:00Z"),
    message("m2", "spc_general", ENGINEER, "2026-01-05T00:00:00Z"),
    message("m3", "spc_agents_dm", CEO, "2026-01-06T00:00:00Z"),
  ];
  return { spaces, memberships, messages };
}

function build(overrides: Partial<Parameters<typeof buildConversations>[0]> = {}) {
  const { spaces, memberships, messages } = fixtures();
  return buildConversations({
    spaces, memberships, messages, readStates: [], employees, agents,
    currentEmployeeId: FOUNDER, ceoAgentId: CEO, ...overrides,
  });
}

describe("conversation pinning", () => {
  test("the founder's CEO conversation outranks recency and sits first", () => {
    const conversations = build();
    expect(conversations.map((item) => item.space.id)).toEqual(["spc_ceo_dm", "spc_agents_dm", "spc_general"]);
    expect(conversations[0].isCeo).toBe(true);
    expect(conversations[0].title).toBe("CEO");
  });

  test("a CEO⇄agent conversation is not the founder's pinned line", () => {
    const conversations = build();
    const agentsDm = conversations.find((item) => item.space.id === "spc_agents_dm");
    expect(agentsDm?.isCeo).toBe(false);
  });

  test("without a CEO the list is pure recency", () => {
    const conversations = build({ ceoAgentId: null });
    expect(conversations.every((item) => !item.isCeo)).toBe(true);
    expect(conversations.map((item) => item.space.id)).toEqual(["spc_agents_dm", "spc_general", "spc_ceo_dm"]);
  });

  test("the pinned row still counts unread like any conversation", () => {
    const conversations = build();
    expect(conversations[0].unread).toBe(1);
    expect(conversations[0].preview).toContain("CEO:");
  });
});

describe("unread counts", () => {
  test("count by position after the last read message, so a same-millisecond arrival is still unread", () => {
    const { spaces, memberships } = fixtures();
    const at = "2026-02-01T00:00:00.000Z";
    const messages = [message("m_read", "spc_general", CEO, at), message("m_same_ms", "spc_general", ENGINEER, at)];
    const unread = (readStates: ChatReadStateRecord[]) => buildConversations({ spaces, memberships, messages, readStates, employees, agents, currentEmployeeId: FOUNDER, ceoAgentId: CEO })
      .find((item) => item.space.id === "spc_general")!.unread;
    const state = (lastReadMessageId: string | null): ChatReadStateRecord => ({ orgId: ORG, employeeId: FOUNDER, spaceId: "spc_general", lastReadMessageId, lastReadAt: at });
    expect(unread([state("m_read")])).toBe(1);
    expect(unread([state("m_same_ms")])).toBe(0);
    // A read message older than the loaded window means every loaded message came after it.
    expect(unread([state("m_older_than_window")])).toBe(2);
  });
});
