import { describe, expect, it } from "vitest";
import { hireRequestSchema } from "../../src/shared/contracts/schemas-agents";
import { getHireNameValidationError } from "../../src/main/agent-permissions";

const baseHireRequest = {
  companyId: "00000000-0000-0000-0000-000000000000",
  requestedByAgentId: null,
  name: "Alice",
  role: "Engineer",
  title: "Backend Engineer",
  department: "engineering" as const,
  reportsTo: null,
  connectorId: "openai-codex" as const,
  workspaceId: null,
  model: null,
  metadataJson: "{}",
  capabilities: "Build backend services",
  budgetMonthlyUsd: 120,
};

describe("agent input schemas", () => {
  it("rejects whitespace-only hire names", () => {
    expect(() =>
      hireRequestSchema.parse({
        ...baseHireRequest,
        name: "   ",
      }),
    ).toThrow();
  });

  it("trims semantic hire fields before persistence", () => {
    const parsed = hireRequestSchema.parse({
      ...baseHireRequest,
      name: "  Alice  ",
      role: "  Engineer  ",
      title: "  Backend Engineer  ",
    });

    expect(parsed.name).toBe("Alice");
    expect(parsed.role).toBe("Engineer");
    expect(parsed.title).toBe("Backend Engineer");
  });

  it("rejects role-like names for non-executive hires", () => {
    expect(getHireNameValidationError({
      name: "Backend Engineer",
      role: "Backend Engineer",
      title: "Backend Engineer",
    })).toBe("Hire name must be a real display name, not just the role.");
  });

  it("allows executive acronyms when they are the intended display name", () => {
    expect(getHireNameValidationError({
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
    })).toBeNull();
  });
});
