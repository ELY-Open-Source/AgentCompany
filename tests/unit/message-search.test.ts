import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";

describe("AppDatabase.searchMessages", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;
  let agentA: string;
  let agentB: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-search-"));
    db = new AppDatabase(tempDir);
    db.init();

    companyId = db.saveCompany({
      name: "Search Test Corp",
      description: "Company for testing message search",
      status: "active",
    });

    agentA = db.saveAgent({
      companyId,
      name: "Agent Alpha",
      role: "Engineer",
      title: "Senior Engineer",
      status: "active",
      reportsTo: null,
      connectorId: "claude_local",
      workspaceId: null,
      model: null,
      capabilities: "coding",
      budgetMonthlyUsd: 100,
    });

    agentB = db.saveAgent({
      companyId,
      name: "Agent Beta",
      role: "Designer",
      title: "Lead Designer",
      status: "active",
      reportsTo: null,
      connectorId: "claude_local",
      workspaceId: null,
      model: null,
      capabilities: "design",
      budgetMonthlyUsd: 100,
    });

    // Seed messages across different channels
    db.sendAgentMessage({
      companyId,
      fromAgentId: agentA,
      toAgentId: agentB,
      channel: "direct",
      subject: "Database migration plan",
      body: "We need to migrate the PostgreSQL tables to the new schema.",
      priority: "normal",
    });

    db.sendAgentMessage({
      companyId,
      fromAgentId: agentB,
      toAgentId: agentA,
      channel: "direct",
      subject: "Design review feedback",
      body: "The button colors look great, but the migration banner needs work.",
      priority: "normal",
    });

    db.sendAgentMessage({
      companyId,
      fromAgentId: agentA,
      channel: "company",
      subject: "Sprint retrospective",
      body: "Team velocity improved by 20% this sprint.",
      priority: "normal",
    });

    db.sendAgentMessage({
      companyId,
      fromAgentId: agentA,
      channel: "department",
      channelTargetId: "engineering",
      subject: "Code review standards",
      body: "All PRs must have at least two approvals before merging.",
      priority: "urgent",
    });

    db.sendAgentMessage({
      companyId,
      fromAgentId: agentB,
      channel: "department",
      channelTargetId: "design",
      subject: "Design system update",
      body: "We updated the color tokens for dark mode compatibility.",
      priority: "low",
    });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns messages where body contains the query string", () => {
    const results = db.searchMessages(companyId, "velocity");
    expect(results.length).toBe(1);
    expect(results[0].companyId).toBe(companyId);
    expect(results[0].body.toLowerCase()).toContain("velocity");
  });

  it("returns messages where subject contains the query string", () => {
    const results = db.searchMessages(companyId, "retrospective");
    expect(results.length).toBe(1);
    expect(results[0].subject).toBe("Sprint retrospective");
  });

  it("escapes LIKE wildcards so % and _ match literally", () => {
    // Insert a message with literal % and _ characters
    db.sendAgentMessage({
      companyId,
      fromAgentId: agentA,
      channel: "company",
      subject: "Performance metrics",
      body: "CPU usage was 95% and disk_io dropped significantly.",
      priority: "normal",
    });

    // Search for the literal "95%"
    const percentResults = db.searchMessages(companyId, "95%");
    expect(percentResults.length).toBe(1);
    expect(percentResults[0].body).toContain("95%");

    // Search for the literal "disk_io"
    const underscoreResults = db.searchMessages(companyId, "disk_io");
    expect(underscoreResults.length).toBe(1);
    expect(underscoreResults[0].body).toContain("disk_io");
  });

  it("scopes to a specific channel when channel param is provided", () => {
    const results = db.searchMessages(companyId, "approvals", { channel: "department" });
    expect(results.length).toBe(1);
    expect(results[0].channel).toBe("department");
    expect(results[0].body).toContain("approvals");
  });

  it("scopes to channelTargetId when provided alongside channel", () => {
    const results = db.searchMessages(companyId, "updated", {
      channel: "department",
      channelTargetId: "design",
    });
    expect(results.length).toBe(1);
    expect(results[0].channelTargetId).toBe("design");
  });

  it("returns empty array when no matches", () => {
    const results = db.searchMessages(companyId, "xyznonexistentquery");
    expect(results).toEqual([]);
  });

  it("respects the limit parameter (default 50)", () => {
    // Insert 60 messages
    for (let i = 0; i < 60; i++) {
      db.sendAgentMessage({
        companyId,
        fromAgentId: agentA,
        channel: "company",
        subject: `Bulk message ${i}`,
        body: `This is a flood test message number ${i}`,
        priority: "normal",
      });
    }

    // Default limit should be 50
    const defaultResults = db.searchMessages(companyId, "flood test");
    expect(defaultResults.length).toBe(50);

    // Explicit limit of 10
    const limitedResults = db.searchMessages(companyId, "flood test", { limit: 10 });
    expect(limitedResults.length).toBe(10);
  });

  it("returns results ordered by created_at DESC (most recent first)", () => {
    const results = db.searchMessages(companyId, "migration");
    expect(results.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < results.length; i++) {
      const prev = new Date(results[i - 1].createdAt).getTime();
      const curr = new Date(results[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});
