/**
 * Step 1: CEO role detection fix.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../src/main/prompt-builder/index";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent, buildCtx } = shared;

describe("Step 1: CEO role detection", () => {
  it("identifies CEO when chainOfCommand is empty, even with no direct reports", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [], // no reports yet!
      chainOfCommand: [], // top-level
    });

    const prompt = buildSystemPrompt(ctx);

    // CEO should NOT get IC instructions
    expect(prompt).not.toContain("Individual Contributor");
    // CEO should get executive instructions (Phase 0: Team Building)
    expect(prompt).toContain("CEO");
    expect(prompt).toContain("Team Building");
  });

  it("identifies manager when has reports and has chain of command", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const managerId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const ceo = shared.db.getAgent(ceoId);
    const icId = createAgent({ name: "IC", role: "Engineer", reportsTo: managerId });
    const ic = shared.db.getAgent(icId);

    const ctx = buildCtx({
      agentId: managerId,
      directReports: [ic],
      chainOfCommand: [ceo], // reports to CEO
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Operating Instructions (Manager)");
    expect(prompt).not.toContain("Individual Contributor");
    expect(prompt).not.toContain("Executive / CEO");
  });

  it("identifies IC when has chain of command and no direct reports", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = shared.db.getAgent(ceoId);
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ceoId });

    const ctx = buildCtx({
      agentId: icId,
      directReports: [],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Individual Contributor");
    expect(prompt).not.toContain("Operating Instructions (Manager)");
  });
});
