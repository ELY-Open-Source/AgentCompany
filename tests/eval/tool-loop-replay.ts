import {
  Agent,
  type AgentMessage,
  type AgentTool,
} from "@mariozechner/pi-agent-core";
import {
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type ToolCall,
  type UserMessage,
} from "@mariozechner/pi-ai";
import { createReplayStreamFn } from "./replay-client.js";
import type {
  AssistantTurn,
  FixtureFile,
  TokenLedger,
  ToolResultTurn,
  TraceTurn,
  UserTurn,
} from "./types.js";

const REPLAY_TOOL_PARAMETERS = Type.Record(Type.String(), Type.Any());

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function createReplayModel(): Model<Api> {
  return {
    id: "eval-replay",
    name: "Eval Replay",
    api: "eval-replay",
    provider: "eval-replay",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 128_000,
    maxTokens: 8192,
  };
}

function collectAssistantToolCalls(fixture: FixtureFile): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const turn of fixture.turns) {
    if (turn.role !== "assistant") continue;
    for (const block of turn.content) {
      if (block.type === "toolCall") calls.push(block);
    }
  }
  return calls;
}

function validateToolLoopShape(fixture: FixtureFile): void {
  const pending = new Set<string>();
  const seen = new Set<string>();

  for (const turn of fixture.turns) {
    if (turn.role === "assistant") {
      if (pending.size > 0) {
        throw new Error(
          `eval replay: fixture "${fixture.meta.fixtureId}" has assistant turn ${turn.turnIndex} before tool result(s): ${Array.from(pending).join(", ")}`,
        );
      }
      for (const block of turn.content) {
        if (block.type !== "toolCall") continue;
        if (seen.has(block.id)) {
          throw new Error(
            `eval replay: fixture "${fixture.meta.fixtureId}" repeats tool call id "${block.id}"`,
          );
        }
        seen.add(block.id);
        pending.add(block.id);
      }
      continue;
    }

    if (turn.role === "toolResult") {
      if (!pending.has(turn.toolUseId)) {
        throw new Error(
          `eval replay: fixture "${fixture.meta.fixtureId}" has tool result "${turn.toolUseId}" without a pending tool call`,
        );
      }
      pending.delete(turn.toolUseId);
      continue;
    }

    if (turn.role === "user" && pending.size > 0) {
      throw new Error(
        `eval replay: fixture "${fixture.meta.fixtureId}" has user turn ${turn.turnIndex} before tool result(s): ${Array.from(pending).join(", ")}`,
      );
    }
  }

  if (pending.size > 0) {
    throw new Error(
      `eval replay: fixture "${fixture.meta.fixtureId}" ended before tool result(s): ${Array.from(pending).join(", ")}`,
    );
  }
}

function collectRecordedToolResults(
  fixture: FixtureFile,
): Map<string, ToolResultTurn> {
  const results = new Map<string, ToolResultTurn>();
  for (const turn of fixture.turns) {
    if (turn.role !== "toolResult") continue;
    if (results.has(turn.toolUseId)) {
      throw new Error(
        `eval replay: fixture "${fixture.meta.fixtureId}" repeats tool result for "${turn.toolUseId}"`,
      );
    }
    results.set(turn.toolUseId, turn);
  }
  return results;
}

function createReplayTools(fixture: FixtureFile): AgentTool[] {
  const results = collectRecordedToolResults(fixture);
  const toolNames = Array.from(
    new Set(collectAssistantToolCalls(fixture).map((call) => call.name)),
  ).sort();

  return toolNames.map((name) => ({
    name,
    label: `eval replay ${name}`,
    description:
      "Replay a recorded eval tool result. The fixture owns the content and the call id is the lookup key.",
    parameters: REPLAY_TOOL_PARAMETERS,
    async execute(toolCallId, params) {
      const recorded = results.get(toolCallId);
      if (!recorded) {
        throw new Error(
          `eval replay: fixture "${fixture.meta.fixtureId}" has no recorded tool result for "${toolCallId}"`,
        );
      }
      return {
        content: recorded.content,
        details: {
          fixtureId: fixture.meta.fixtureId,
          toolCallId,
          toolName: name,
          arguments: params,
        },
      };
    },
    executionMode: "sequential",
  }));
}

function asUserMessage(turn: UserTurn): UserMessage {
  return {
    role: "user",
    content: turn.content,
    timestamp: Date.now(),
  };
}

function usageToLedger(message: AssistantMessage): TokenLedger {
  return {
    input: message.usage.input,
    cache_read: message.usage.cacheRead,
    cache_creation: message.usage.cacheWrite,
    output: message.usage.output,
  };
}

function agentMessageToTraceTurn(
  message: AgentMessage,
  turnIndex: number,
): TraceTurn | null {
  if (message.role === "user") {
    const content = typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : message.content;
    return {
      type: "turn",
      turnIndex,
      role: "user",
      content,
    };
  }

  if (message.role === "assistant") {
    return {
      type: "turn",
      turnIndex,
      role: "assistant",
      content: message.content,
      tokenLedger: usageToLedger(message),
    } satisfies AssistantTurn;
  }

  if (message.role === "toolResult") {
    return {
      type: "turn",
      turnIndex,
      role: "toolResult",
      toolUseId: message.toolCallId,
      content: message.content,
    };
  }

  return null;
}

function collectUserTurns(fixture: FixtureFile): UserTurn[] {
  return fixture.turns.filter((turn): turn is UserTurn => turn.role === "user");
}

export async function replayFixtureThroughAgent(
  fixture: FixtureFile,
  systemPrompt: string,
): Promise<TraceTurn[]> {
  validateToolLoopShape(fixture);

  const userTurns = collectUserTurns(fixture);
  const firstUserTurn = userTurns[0];
  if (!firstUserTurn || fixture.turns[0]?.role !== "user") {
    throw new Error(
      `eval replay: fixture "${fixture.meta.fixtureId}" must start with a user turn`,
    );
  }

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: createReplayModel(),
      tools: createReplayTools(fixture),
      messages: [],
      thinkingLevel: "off",
    },
    sessionId: `eval:${fixture.meta.fixtureId}`,
    streamFn: createReplayStreamFn(fixture),
    toolExecution: "sequential",
  });

  for (const followUp of userTurns.slice(1)) {
    agent.followUp(asUserMessage(followUp));
  }

  await agent.prompt(asUserMessage(firstUserTurn));

  if (agent.state.errorMessage) {
    throw new Error(
      `eval replay: fixture "${fixture.meta.fixtureId}" failed inside pi Agent loop: ${agent.state.errorMessage}`,
    );
  }

  return agent.state.messages
    .map((message, idx) => agentMessageToTraceTurn(message, idx))
    .filter((turn): turn is TraceTurn => turn !== null);
}
