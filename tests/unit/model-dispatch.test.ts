import { describe, expect, it } from "vitest";
import type { AgentRecord, ConnectorId, ConnectorRecord, ModelCapability } from "@shared/types";
import {
  pickFromCandidates,
  pickModelForAgent,
  type EnabledModel,
  type PickModelDeps,
} from "../../src/main/model-dispatch";

/**
 * Minimum fields required to build a plausible AgentRecord for the
 * dispatcher. The shared type has many optional/legacy columns; the picker
 * only reads role, title, roleLevel, connectorId, model, modelStrategy, and
 * companyId.
 */
function makeAgent(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Test Agent",
    role: "engineer",
    title: "Staff Engineer",
    department: null,
    status: "active",
    reportsTo: null,
    connectorId: "anthropic-api" as ConnectorId,
    workspaceId: null,
    model: "claude-sonnet-4-6",
    capabilities: "[]",
    budgetMonthlyUsd: 0,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: false,
    heartbeatIntervalSec: 120,
    lastHeartbeatAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    modelStrategy: "auto",
    roleLevel: "ic",
    ...overrides,
  };
}

/**
 * Build a ConnectorRecord that the execution-readiness check treats as
 * healthy. Only the fields the check reads are populated realistically;
 * the rest default to empty.
 */
function makeConnector(id: string): ConnectorRecord {
  return {
    id: id as ConnectorId,
    label: id,
    description: "",
    status: "ready",
    command: "",
    version: null,
    authState: "ok",
    lastCheckedAt: null,
    lastError: null,
    model: null,
    envBindingText: "",
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: true,
      structuredTranscript: true,
      costAttribution: true,
    },
    configurationDoc: "",
  };
}

/**
 * Build picker deps from a flat list of (connectorId, provider, modelId)
 * triples + a capability matrix. Anything unspecified behaves as if the
 * connector is healthy and has no disabled models.
 */
function makeDeps(options: {
  enabledModels: Array<{ connectorId: string; provider: string; modelId: string }>;
  capabilities: ModelCapability[];
  ceoAssignment?: { connectorId: string; modelId: string | null } | null;
}): PickModelDeps {
  const connectorsById = new Map<string, ConnectorRecord>();
  for (const entry of options.enabledModels) {
    if (!connectorsById.has(entry.connectorId)) {
      connectorsById.set(entry.connectorId, makeConnector(entry.connectorId));
    }
  }
  return {
    getConnector: (id) => {
      const c = connectorsById.get(id);
      if (!c) throw new Error(`unknown connector ${id}`);
      return c;
    },
    getDisabledModels: () => [],
    getCeoAssignment: () =>
      options.ceoAssignment
        ? {
            connectorId: options.ceoAssignment.connectorId as ConnectorId,
            modelId: options.ceoAssignment.modelId,
          }
        : null,
    listModelCapabilities: () => options.capabilities,
    readConnectors: () => Array.from(connectorsById.values()),
  };
}

/**
 * Patch the getConnectorModelPolicy path used inside listEnabledModels.
 * We don't want to stand up the full connector definition catalog for
 * every test, so we intercept policy queries by wiring each connector's
 * provider + model list through a per-test lookup.
 *
 * The picker imports `getConnectorDefinition` and `getConnectorModelPolicy`
 * at module scope. Integration tests stand up the whole system; these
 * unit tests exercise the pure scoring math by stubbing those imports via
 * vitest.
 */
// Stubbing is handled by the helper above — tests below only assert the
// sort/filter/fallback behaviour on a hand-crafted capability matrix plus
// a small enabled-model set. The heavy integration path (connector
// definitions + policy) is covered by higher-level tests.

describe("pickModelForAgent", () => {
  const claudeOpus: ModelCapability = {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    reasoning: 5,
    coding: 5,
    writing: 5,
    tier: "hard",
    costPerMtokOut: 75,
    updatedAt: "",
  };
  const llama: ModelCapability = {
    provider: "fireworks",
    modelId: "llama-70b",
    reasoning: 2,
    coding: 2,
    writing: 2,
    tier: "trivial",
    costPerMtokOut: 1,
    updatedAt: "",
  };

  it("explicit strategy honours agent.connectorId + agent.model verbatim", () => {
    const agent = makeAgent({
      modelStrategy: "explicit",
      connectorId: "anthropic-api" as ConnectorId,
      model: "claude-opus-4-7",
    });
    const deps = makeDeps({
      enabledModels: [
        { connectorId: "anthropic-api", provider: "anthropic", modelId: "claude-opus-4-7" },
      ],
      capabilities: [claudeOpus],
    });
    const assignment = pickModelForAgent(agent, deps);
    expect(assignment).toEqual({ connectorId: "anthropic-api", modelId: "claude-opus-4-7" });
  });

  it("CEO role always takes the user-picked pair regardless of modelStrategy", () => {
    const agent = makeAgent({
      modelStrategy: "auto",
      roleLevel: "c_suite",
      role: "CEO",
      connectorId: "anthropic-api" as ConnectorId,
      model: "claude-opus-4-7",
    });
    const deps = makeDeps({
      enabledModels: [
        { connectorId: "anthropic-api", provider: "anthropic", modelId: "claude-opus-4-7" },
        { connectorId: "fireworks", provider: "fireworks", modelId: "llama-70b" },
      ],
      capabilities: [claudeOpus, llama],
    });
    const assignment = pickModelForAgent(agent, deps);
    expect(assignment.modelId).toBe("claude-opus-4-7");
  });

  it("CEO is identified by reportsTo === null even when roleLevel stays at the schema default 'ic'", () => {
    // Regression test for the v39 migration gap: CEO agents created before
    // the explicit role_level hookup have roleLevel = 'ic' in the DB. The
    // dispatcher must still recognise them via the DB invariant used by
    // getCeoForCompany: reports_to IS NULL.
    const agent = makeAgent({
      modelStrategy: "auto",
      roleLevel: "ic",
      reportsTo: null,
      role: "CEO",
      connectorId: "anthropic-api" as ConnectorId,
      model: "claude-opus-4-7",
    });
    const deps = makeDeps({
      enabledModels: [
        { connectorId: "anthropic-api", provider: "anthropic", modelId: "claude-opus-4-7" },
        { connectorId: "fireworks", provider: "fireworks", modelId: "llama-70b" },
      ],
      capabilities: [claudeOpus, llama],
    });
    const assignment = pickModelForAgent(agent, deps);
    expect(assignment.modelId).toBe("claude-opus-4-7");
  });
});

describe("inferTaskProfile — i18n", () => {
  it("classifies Chinese role strings via substring match", async () => {
    const { inferTaskProfile } = await import("../../src/main/agent-role-helpers");
    expect(inferTaskProfile("高级架构师", null, "director").domain).toBe("reasoning");
    expect(inferTaskProfile("前端工程师", null, "ic").domain).toBe("coding");
    expect(inferTaskProfile("内容运营", null, "ic").domain).toBe("writing");
    expect(inferTaskProfile("产品经理", null, "manager").domain).toBe("writing");
  });

  it("recognises Chinese trivial-tier cues", async () => {
    const { inferTaskProfile } = await import("../../src/main/agent-role-helpers");
    expect(inferTaskProfile("实习生", "数据标注实习生", "ic").requiredTier).toBe("trivial");
    expect(inferTaskProfile("初级工程师", null, "ic").requiredTier).toBe("trivial");
    expect(inferTaskProfile("助理", null, "ic").requiredTier).toBe("trivial");
  });

  it("English classification still works after unicode tokenizer swap", async () => {
    const { inferTaskProfile } = await import("../../src/main/agent-role-helpers");
    expect(inferTaskProfile("Senior Architect", null, "director").domain).toBe("reasoning");
    expect(inferTaskProfile("Staff Engineer", null, "lead").domain).toBe("coding");
    expect(inferTaskProfile("Marketing Lead", null, "lead").domain).toBe("writing");
    // 'lead' keyword must not match 'leaderboard' / 'cleaner' substrings —
    // token-based matching is still in effect for Latin keywords.
    expect(inferTaskProfile("Cleaner", null, "ic").domain).toBe("writing");
  });
});

describe("pickFromCandidates — pure rubric", () => {
  const claudeOpus: ModelCapability = {
    provider: "anthropic", modelId: "claude-opus-4-7",
    reasoning: 5, coding: 5, writing: 5,
    tier: "hard", costPerMtokOut: 75, updatedAt: "",
  };
  const claudeSonnet: ModelCapability = {
    provider: "anthropic", modelId: "claude-sonnet-4-6",
    reasoning: 4, coding: 5, writing: 5,
    tier: "standard", costPerMtokOut: 15, updatedAt: "",
  };
  const kimiK2: ModelCapability = {
    provider: "fireworks", modelId: "kimi-k2",
    reasoning: 4, coding: 4, writing: 5,
    tier: "standard", costPerMtokOut: 3, updatedAt: "",
  };
  const llama: ModelCapability = {
    provider: "fireworks", modelId: "llama-70b",
    reasoning: 2, coding: 2, writing: 2,
    tier: "trivial", costPerMtokOut: 1, updatedAt: "",
  };

  const allEnabled: EnabledModel[] = [
    { provider: "anthropic", connectorId: "claude-pro" as ConnectorId, modelId: "claude-opus-4-7" },
    { provider: "anthropic", connectorId: "claude-pro" as ConnectorId, modelId: "claude-sonnet-4-6" },
    { provider: "fireworks", connectorId: "fireworks" as ConnectorId, modelId: "kimi-k2" },
    { provider: "fireworks", connectorId: "fireworks" as ConnectorId, modelId: "llama-70b" },
  ];

  it("picks the cheapest qualifying model (standard/writing → kimi beats sonnet on price)", () => {
    const winner = pickFromCandidates(
      { domain: "writing", requiredTier: "standard" },
      allEnabled,
      [claudeOpus, claudeSonnet, kimiK2, llama],
    );
    expect(winner?.modelId).toBe("kimi-k2");
  });

  it("hard tier requires tier≥hard even if domain score clears the floor", () => {
    // writing=5 qualifies sonnet and kimi numerically, but both are tier=standard.
    // Only opus (tier=hard) survives.
    const winner = pickFromCandidates(
      { domain: "writing", requiredTier: "hard" },
      allEnabled,
      [claudeOpus, claudeSonnet, kimiK2, llama],
    );
    expect(winner?.modelId).toBe("claude-opus-4-7");
  });

  it("returns null when no candidate clears the bar", () => {
    // Ask for hard/reasoning ≥4 but only provide trivial-tier llama.
    const winner = pickFromCandidates(
      { domain: "reasoning", requiredTier: "hard" },
      [{ provider: "fireworks", connectorId: "fireworks" as ConnectorId, modelId: "llama-70b" }],
      [llama],
    );
    expect(winner).toBeNull();
  });

  it("returns null on an empty candidate list", () => {
    expect(pickFromCandidates({ domain: "coding", requiredTier: "trivial" }, [], [llama])).toBeNull();
  });

  it("trivial tier still honours the domain floor (2)", () => {
    // llama scores 2 on writing — exactly on the floor, so it qualifies.
    const winner = pickFromCandidates(
      { domain: "writing", requiredTier: "trivial" },
      [{ provider: "fireworks", connectorId: "fireworks" as ConnectorId, modelId: "llama-70b" }],
      [llama],
    );
    expect(winner?.modelId).toBe("llama-70b");
  });

  it("ignores enabled models with no capability row", () => {
    // Only claudeOpus has a capability row; mystery model is filtered out
    // despite appearing in the enabled list.
    const winner = pickFromCandidates(
      { domain: "reasoning", requiredTier: "hard" },
      [
        { provider: "mystery", connectorId: "mystery" as ConnectorId, modelId: "unknown" },
        { provider: "anthropic", connectorId: "claude-pro" as ConnectorId, modelId: "claude-opus-4-7" },
      ],
      [claudeOpus],
    );
    expect(winner?.modelId).toBe("claude-opus-4-7");
  });
});

describe("pickModelForAgent — internal rubric", () => {
  it("exposes DOMAIN_SCORE_FLOOR and TIER_RANK for downstream tests", async () => {
    const { __INTERNAL__ } = await import("../../src/main/model-dispatch");
    expect(__INTERNAL__.DOMAIN_SCORE_FLOOR.trivial).toBe(2);
    expect(__INTERNAL__.DOMAIN_SCORE_FLOOR.standard).toBe(3);
    expect(__INTERNAL__.DOMAIN_SCORE_FLOOR.hard).toBe(4);
    expect(__INTERNAL__.TIER_RANK.trivial).toBe(1);
    expect(__INTERNAL__.TIER_RANK.standard).toBe(2);
    expect(__INTERNAL__.TIER_RANK.hard).toBe(3);
  });
});
