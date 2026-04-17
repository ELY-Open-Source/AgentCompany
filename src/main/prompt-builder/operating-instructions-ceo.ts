import type { PromptContext } from "./index";
import { buildConnectorSection } from "./skill-injection";

import teamBuildingEn from "./ceo-modes/team-building.en.md?raw";
import awaitingOrgEn from "./ceo-modes/awaiting-org.en.md?raw";
import awaitingHireEn from "./ceo-modes/awaiting-hire.en.md?raw";
import operatingEn from "./ceo-modes/operating.en.md?raw";
import proactiveFooterEn from "./ceo-modes/proactive-footer.en.md?raw";

type CeoMode = "team_building" | "awaiting_org" | "awaiting_hire" | "operating";

function resolveMode(ctx: PromptContext): CeoMode {
  const activeReports = ctx.directReports.filter(
    (a) => a.status !== "pending_approval" && a.status !== "terminated",
  );
  const hasPendingOrgApproval = ctx.pendingApprovals.some(
    (a) => a.type === "approve_ceo_strategy",
  );
  const hasPendingHires = ctx.directReports.some(
    (a) => a.status === "pending_approval",
  );

  if (activeReports.length === 0 && !hasPendingOrgApproval && !hasPendingHires) {
    return "team_building";
  }
  if (hasPendingOrgApproval) return "awaiting_org";
  if (activeReports.length === 0 && hasPendingHires) return "awaiting_hire";
  return "operating";
}

const MODE_TEMPLATES: Record<CeoMode, string> = {
  team_building: teamBuildingEn,
  awaiting_org: awaitingOrgEn,
  awaiting_hire: awaitingHireEn,
  operating: operatingEn,
};

function render(template: string, ctx: PromptContext): string {
  return template
    .replace(/\{\{companyId\}\}/g, ctx.agent.companyId)
    .replace(/\{\{agentId\}\}/g, ctx.agent.id)
    .replace(/\{\{runId\}\}/g, ctx.runId);
}

export function buildCEOInstructions(ctx: PromptContext): string[] {
  const parts: string[] = [];
  const mode = resolveMode(ctx);
  parts.push(render(MODE_TEMPLATES[mode], ctx));

  if (mode === "team_building") {
    const connectorSection = buildConnectorSection({ allConnectors: ctx.allConnectors ?? [] });
    if (connectorSection) parts.push(connectorSection);
  }

  parts.push(render(proactiveFooterEn, ctx));
  return parts;
}
