import log from "electron-log/main.js";
import type { HireApprovedPayload, HireApprovedHookResult } from "@agentcompany/adapter-utils";
import { getConnectorDefinition } from "./connectors";
import type { AppDatabase } from "./database";

export type { HireApprovedPayload, HireApprovedHookResult };

/**
 * Notify the adapter that an agent hire was approved.
 * Non-fatal: failures are logged but never thrown.
 * Follows the Paperclip hire-hook.ts pattern.
 */
export async function notifyHireApproved(
  db: AppDatabase,
  input: {
    companyId: string;
    agentId: string;
    source: "join_request" | "approval";
    sourceId: string;
    approvedAt?: string;
  },
): Promise<void> {
  try {
    let agent;
    try {
      agent = db.getAgent(input.agentId);
    } catch {
      log.warn(`[hire-hook] Agent ${input.agentId} not found, skipping hire notification.`);
      return;
    }

    let connectorDef;
    try {
      connectorDef = getConnectorDefinition(agent.connectorId);
    } catch {
      log.warn(`[hire-hook] No connector definition for ${agent.connectorId}, skipping hire notification.`);
      return;
    }

    const adapter = connectorDef.module;
    if (!adapter.onHireApproved) {
      // Adapter doesn't implement the hook — this is normal, not an error
      return;
    }

    const payload: HireApprovedPayload = {
      companyId: input.companyId,
      agentId: input.agentId,
      agentName: agent.name,
      adapterType: connectorDef.id,
      source: input.source,
      sourceId: input.sourceId,
      approvedAt: input.approvedAt ?? new Date().toISOString(),
      message: db.listSnapshot().locale === "zh"
        ? `你已被批准为"${agent.title}"。你现在已激活，可以接收任务。`
        : `Your hire as "${agent.title}" in the company has been approved. You are now active and ready to receive tasks.`,
    };

    const result = await adapter.onHireApproved(payload, {});
    if (result.ok) {
      log.info(`[hire-hook] Successfully notified adapter for agent ${agent.name} (${input.agentId})`);
      db.addActivity({
        companyId: input.companyId,
        actor: "system",
        action: "hire_hook.success",
        entityType: "agent",
        entityId: input.agentId,
        detail: `Hire notification sent to ${connectorDef.id} adapter`,
      });
    } else {
      log.warn(`[hire-hook] Adapter returned error for agent ${agent.name}: ${result.error}`);
      db.addActivity({
        companyId: input.companyId,
        actor: "system",
        action: "hire_hook.failed",
        entityType: "agent",
        entityId: input.agentId,
        detail: `Adapter error: ${result.error ?? "unknown"}`,
      });
    }
  } catch (error) {
    // Non-fatal: log and continue
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[hire-hook] Exception notifying hire for agent ${input.agentId}: ${message}`);
    try {
      db.addActivity({
        companyId: input.companyId,
        actor: "system",
        action: "hire_hook.exception",
        entityType: "agent",
        entityId: input.agentId,
        detail: message,
      });
    } catch { /* activity logging itself failed — nothing more we can do */ }
  }
}
