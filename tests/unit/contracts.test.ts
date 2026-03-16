import { describe, expect, it } from "vitest";
import {
  connectorInputSchema,
  runLogSchema,
  secretInputSchema,
  startRunSchema,
  workspaceInputSchema,
} from "../../src/shared/contracts";

describe("shared contracts", () => {
  it("fills connector defaults for optional fields", () => {
    const parsed = connectorInputSchema.parse({
      id: "codex_local",
      command: "codex",
    });

    expect(parsed.model).toBeUndefined();
    expect(parsed.envBindingText).toBe("");
    expect(parsed.notes).toBe("");
  });

  it("validates workspace and run payloads", () => {
    expect(() =>
      workspaceInputSchema.parse({
        companyId: "bad-id",
        name: "Primary Workspace",
        localPath: "/tmp/workspace",
      }),
    ).toThrow();

    expect(() =>
      startRunSchema.parse({
        taskId: "bad-id",
      }),
    ).toThrow();

    expect(() =>
      runLogSchema.parse({
        runId: "bad-id",
      }),
    ).toThrow();
  });

  it("accepts bounded secret payloads", () => {
    const parsed = secretInputSchema.parse({
      companyId: "00000000-0000-0000-0000-000000000000",
      name: "vault-openai",
      description: "OpenAI API token",
      value: "sk-test-value",
    });

    expect(parsed.companyId).toBe("00000000-0000-0000-0000-000000000000");
    expect(parsed.name).toBe("vault-openai");
    expect(parsed.value).toContain("sk-");
  });

  it("normalizes empty optional ids to null", () => {
    const parsed = workspaceInputSchema.parse({
      companyId: "00000000-0000-0000-0000-000000000000",
      name: "Primary Workspace",
      localPath: "/tmp/workspace",
      projectId: "",
    });

    expect(parsed.projectId).toBeNull();
  });
});
