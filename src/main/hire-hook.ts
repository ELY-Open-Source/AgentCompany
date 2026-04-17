import log from "electron-log/main.js";
import { getConnectorDefinition } from "./connectors";
import type { AppDatabase } from "./database";

/**
 * Payload captured when an agent hire is approved. Kept for call-sites that
 * want to surface the approval in activity feeds or future integrations.
 */
export interface HireApprovedPayload {
  companyId: string;
  agentId: string;
  agentName: string;
  connectorId: string;
  source: "join_request" | "approval";
  sourceId: string;
  approvedAt: string;
  message: string;
}

/**
 * Record that an agent hire was approved. Pi-mono does not expose an adapter
 * hook, so this records an activity row for the company timeline.
 * Non-fatal: failures are logged but never thrown.
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

    const locale = (db.queryAll<{ value: string }>("select value from settings where key = 'locale' limit 1")[0]?.value ?? "en");
    const payload: HireApprovedPayload = {
      companyId: input.companyId,
      agentId: input.agentId,
      agentName: agent.name,
      connectorId: connectorDef.id,
      source: input.source,
      sourceId: input.sourceId,
      approvedAt: input.approvedAt ?? new Date().toISOString(),
      message: locale === "zh"
        ? `你已被批准为"${agent.title}"。你现在已激活，可以接收任务。`
        : `Your hire as "${agent.title}" in the company has been approved. You are now active and ready to receive tasks.`,
    };

    log.info(`[hire-hook] Hire approved for agent ${agent.name} (${input.agentId}) on connector ${connectorDef.id}`);
    db.addActivity({
      companyId: input.companyId,
      actor: "system",
      action: "hire_hook.success",
      entityType: "agent",
      entityId: input.agentId,
      detail: `Hire approved: ${payload.agentName} via ${connectorDef.id}`,
    });
  } catch (error) {
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
    } catch (activityError) {
      log.error(
        `[hire-hook] Activity logging also failed for agent ${input.agentId}: ${activityError instanceof Error ? activityError.message : String(activityError)}`,
      );
    }
  }
}
