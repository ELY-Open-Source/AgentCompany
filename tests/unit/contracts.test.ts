import { describe, expect, it } from "vitest";
import {
  connectorInputSchema,
  documentInputSchema,
  knowledgeEntryInputSchema,
  meetingInputSchema,
  runLogSchema,
  secretInputSchema,
  startRunSchema,
  workspaceInputSchema,
} from "../../src/shared/contracts";

describe("shared contracts", () => {
  it("fills connector defaults for optional fields", () => {
    const parsed = connectorInputSchema.parse({
      id: "openai-codex",
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

  it("canonicalizes structured JSON string fields", () => {
    const companyId = "00000000-0000-0000-0000-000000000000";

    const document = documentInputSchema.parse({
      companyId,
      type: "technical_spec",
      title: "JSON contract",
      tagsJson: "[ \"security\", \"audit\" ]",
    });
    expect(document.tagsJson).toBe("[\"security\",\"audit\"]");

    const knowledge = knowledgeEntryInputSchema.parse({
      companyId,
      category: "technical",
      topic: "JSON fields",
      content: "Canonicalize JSON before persistence.",
      tagsJson: "[ \"runtime\" ]",
    });
    expect(knowledge.tagsJson).toBe("[\"runtime\"]");

    const meeting = meetingInputSchema.parse({
      companyId,
      type: "department_sync",
      title: "JSON field sync",
      scheduledAt: "2026-05-15T10:00:00.000Z",
      participantAgentIds: "[ \"11111111-1111-1111-1111-111111111111\" ]",
      agendaJson: "[ \"Plan\" ]",
      actionItemsJson: "[ { \"title\": \"Ship\", \"description\": \"Finish\" } ]",
    });
    expect(meeting.participantAgentIds).toBe("[\"11111111-1111-1111-1111-111111111111\"]");
    expect(meeting.agendaJson).toBe("[\"Plan\"]");
    expect(meeting.actionItemsJson).toBe("[{\"title\":\"Ship\",\"description\":\"Finish\"}]");
  });

  it("rejects malformed structured JSON string fields", () => {
    const companyId = "00000000-0000-0000-0000-000000000000";

    expect(() => documentInputSchema.parse({
      companyId,
      type: "technical_spec",
      title: "Broken tags",
      tagsJson: "{",
    })).toThrow();

    expect(() => meetingInputSchema.parse({
      companyId,
      type: "department_sync",
      title: "Broken participants",
      scheduledAt: "2026-05-15T10:00:00.000Z",
      participantAgentIds: "[1]",
    })).toThrow();
  });
});
