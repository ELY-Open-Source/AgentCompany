import { describe, expect, it } from "vitest";
import {
  resolveCeoMode,
  type ResolveCeoModeInput,
} from "../../src/main/prompt-builder/ceo-modes/resolve-mode";
import type {
  AgentRecord,
  ApprovalRecord,
  CompanyRecord,
} from "../../src/shared/types";

/**
 * resolveCeoMode is a pure function over immediate agent+company state,
 * so these tests exercise it as a pure classifier. No SQLite required —
 * standing up a database here would only test record round-tripping,
 * which belongs in other suites. The table of cases below covers all
 * four output modes and the boundary transitions between them.
 */

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const CEO_ID = "00000000-0000-0000-0000-000000000010";

function makeCeo(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: CEO_ID,
    companyId: COMPANY_ID,
    name: "Chief",
    role: "ceo",
    title: "CEO",
    department: null,
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "Run the company",
    budgetMonthlyUsd: 1000,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: true,
    heartbeatIntervalSec: 120,
    lastHeartbeatAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: COMPANY_ID,
    name: "Test Co",
    description: "",
    status: "active",
    autoApproveHires: false,
    reviewDeliverables: false,
    executionMode: "ai_ceo",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeReport(
  id: string,
  status: AgentRecord["status"],
  overrides: Partial<AgentRecord> = {},
): AgentRecord {
  return makeCeo({
    id,
    role: "ic",
    title: "Engineer",
    name: `Report ${id}`,
    reportsTo: CEO_ID,
    status,
    ...overrides,
  });
}

function makeApproval(
  type: ApprovalRecord["type"],
  state: ApprovalRecord["state"],
  overrides: Partial<ApprovalRecord> = {},
): ApprovalRecord {
  return {
    id: `approval-${type}-${state}`,
    companyId: COMPANY_ID,
    relatedTaskId: null,
    relatedAgentId: null,
    requestedByAgentId: CEO_ID,
    type,
    payloadSummary: "",
    impactSummary: "",
    payloadJson: null,
    decisionNote: "",
    state,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ResolveCeoModeInput> = {}): ResolveCeoModeInput {
  return {
    agent: makeCeo(),
    company: makeCompany(),
    reports: [],
    pendingApprovals: [],
    ...overrides,
  };
}

describe("resolveCeoMode", () => {
  // ─── team_building ──────────────────────────────────────────────────

  it("returns team_building when the CEO has no reports and no approvals", () => {
    expect(resolveCeoMode(baseInput())).toBe("team_building");
  });

  it("treats a terminated report as non-active: still team_building", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("ex", "terminated")],
        }),
      ),
    ).toBe("team_building");
  });

  // ─── awaiting_hire ──────────────────────────────────────────────────

  it("returns awaiting_hire when only pending-approval reports exist", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("hire-1", "pending_approval")],
        }),
      ),
    ).toBe("awaiting_hire");
  });

  it("awaiting_hire regardless of how many pending hires are queued", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [
            makeReport("hire-1", "pending_approval"),
            makeReport("hire-2", "pending_approval"),
            makeReport("hire-3", "pending_approval"),
          ],
        }),
      ),
    ).toBe("awaiting_hire");
  });

  // ─── awaiting_org ───────────────────────────────────────────────────

  it("returns awaiting_org when an approve_ceo_strategy is pending, even with active reports", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("eng-1", "active")],
          pendingApprovals: [makeApproval("approve_ceo_strategy", "pending")],
        }),
      ),
    ).toBe("awaiting_org");
  });

  it("awaiting_org outranks team_building when strategy is pending and the org is still empty", () => {
    expect(
      resolveCeoMode(
        baseInput({
          pendingApprovals: [makeApproval("approve_ceo_strategy", "pending")],
        }),
      ),
    ).toBe("awaiting_org");
  });

  it("ignores a resolved strategy approval (approved state does not gate)", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("eng-1", "active")],
          pendingApprovals: [makeApproval("approve_ceo_strategy", "approved")],
        }),
      ),
    ).toBe("operating");
  });

  // ─── operating ──────────────────────────────────────────────────────

  it("returns operating when at least one active report exists and no org approval is pending", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("eng-1", "active")],
        }),
      ),
    ).toBe("operating");
  });

  it("idle reports count as active for mode purposes (only pending/terminated exclude)", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [makeReport("eng-1", "idle")],
        }),
      ),
    ).toBe("operating");
  });

  it("mixes pending and active: one active report is enough for operating", () => {
    expect(
      resolveCeoMode(
        baseInput({
          reports: [
            makeReport("eng-1", "active"),
            makeReport("hire-1", "pending_approval"),
          ],
        }),
      ),
    ).toBe("operating");
  });

  // ─── guards ─────────────────────────────────────────────────────────

  it("throws when called with a non-CEO agent", () => {
    expect(() =>
      resolveCeoMode(
        baseInput({
          agent: makeCeo({ role: "ic" }),
        }),
      ),
    ).toThrow(/non-CEO/);
  });

  it("throws when agent and company ids do not match", () => {
    expect(() =>
      resolveCeoMode(
        baseInput({
          company: makeCompany({ id: "00000000-0000-0000-0000-000000000999" }),
        }),
      ),
    ).toThrow(/mismatched company/);
  });

  // ─── transitions ────────────────────────────────────────────────────

  it("transition team_building → awaiting_hire: filing a hire flips the mode", () => {
    const before = baseInput();
    const after = baseInput({
      reports: [makeReport("hire-1", "pending_approval")],
    });
    expect(resolveCeoMode(before)).toBe("team_building");
    expect(resolveCeoMode(after)).toBe("awaiting_hire");
  });

  it("transition awaiting_hire → operating: hire activation flips to operating", () => {
    const before = baseInput({
      reports: [makeReport("hire-1", "pending_approval")],
    });
    const after = baseInput({
      reports: [makeReport("hire-1", "active")],
    });
    expect(resolveCeoMode(before)).toBe("awaiting_hire");
    expect(resolveCeoMode(after)).toBe("operating");
  });

  it("transition operating → awaiting_org: filing a strategy approval gates further work", () => {
    const reports = [makeReport("eng-1", "active")];
    expect(resolveCeoMode(baseInput({ reports }))).toBe("operating");
    expect(
      resolveCeoMode(
        baseInput({
          reports,
          pendingApprovals: [makeApproval("approve_ceo_strategy", "pending")],
        }),
      ),
    ).toBe("awaiting_org");
  });
});
