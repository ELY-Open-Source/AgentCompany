import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { compactMessagesIfNeeded } from "../../src/main/agent-runtime/context-compactor";

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const first = content[0] as { text?: string } | undefined;
  return first?.text ?? "";
}

function makeLongTranscript(olderFacts: AgentMessage[]): AgentMessage[] {
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: `Ship the approval workflow.\n${"context ".repeat(12_000)}` }],
      timestamp: 1,
    } as AgentMessage,
    ...olderFacts,
  ];

  for (let i = 0; i < 42; i += 1) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `recent turn ${i}\n${"tail ".repeat(4_000)}` }],
      timestamp: 100 + i,
    } as AgentMessage);
  }
  return messages;
}

describe("context compactor tool result facts", () => {
  it("preserves task, approval, message, status, decision, and error facts from tool results", () => {
    const messages = makeLongTranscript([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will request approval for the deliverable." },
          {
            type: "toolCall",
            id: "call-approval",
            name: "file_approval",
            args: { taskId: "task_123" },
          },
        ],
        timestamp: 2,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-approval",
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: false,
            taskId: "task_123",
            approvalId: "approval_456",
            messageId: "message_789",
            status: "blocked",
            decision: "requires_human_review",
            error: "missing reviewer",
          }),
        }],
        details: {
          taskId: "task_123",
          approvalId: "approval_456",
          messageId: "message_789",
          status: "blocked",
          decision: "requires_human_review",
          error: "missing reviewer",
        },
        timestamp: 3,
      } as AgentMessage,
    ]);

    const outcome = compactMessagesIfNeeded(messages);
    expect(outcome.changed).toBe(true);
    const summary = textOf(outcome.messages?.[0] as AgentMessage);

    expect(summary).toContain("file_approval");
    expect(summary).toContain("taskId=task_123");
    expect(summary).toContain("approvalId=approval_456");
    expect(summary).toContain("messageId=message_789");
    expect(summary).toContain("status=blocked");
    expect(summary).toContain("decision=requires_human_review");
    expect(summary).toContain("error=missing reviewer");
  });
});
