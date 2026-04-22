import type { AgentMessageRecord } from "@shared/types";

export interface InboundCorrelationEntry {
  fromAgentId: string;
  senderKind: AgentMessageRecord["senderKind"];
  messageId: string;
  /**
   * Stable pi-message timestamp that the projected user turn carries.
   * Reverse-indexed so `message_end` can resolve back to `messageId`.
   */
  piTimestamp: number;
}

interface InboundCorrelationRegistry {
  byMessageId: Map<string, InboundCorrelationEntry>;
  byPiTimestamp: Map<number, string>;
  lastAllocatedTimestamp: number;
}

export class InboundCorrelationRegistryStore {
  private readonly registries = new Map<string, InboundCorrelationRegistry>();

  register(runId: string, record: AgentMessageRecord, baselineTimestamp: number): number {
    const registry = this.getOrCreate(runId);
    const allocated = Math.max(baselineTimestamp, registry.lastAllocatedTimestamp + 1);
    registry.lastAllocatedTimestamp = allocated;
    const entry: InboundCorrelationEntry = {
      fromAgentId: record.fromAgentId,
      senderKind: record.senderKind,
      messageId: record.id,
      piTimestamp: allocated,
    };
    registry.byMessageId.set(record.id, entry);
    registry.byPiTimestamp.set(allocated, record.id);
    return allocated;
  }

  lookup(runId: string, timestamp: number | undefined): InboundCorrelationEntry | null {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
    const registry = this.registries.get(runId);
    if (!registry) return null;
    const messageId = registry.byPiTimestamp.get(timestamp);
    if (!messageId) return null;
    return registry.byMessageId.get(messageId) ?? null;
  }

  deleteRun(runId: string): void {
    this.registries.delete(runId);
  }

  private getOrCreate(runId: string): InboundCorrelationRegistry {
    const existing = this.registries.get(runId);
    if (existing) return existing;
    const registry: InboundCorrelationRegistry = {
      byMessageId: new Map(),
      byPiTimestamp: new Map(),
      lastAllocatedTimestamp: 0,
    };
    this.registries.set(runId, registry);
    return registry;
  }
}
