import type { PromptContext } from "./index";
import { buildSocialSection } from "./api-endpoints";

import headerEn from "./api-docs/header.en.md?raw";
import agentControlEn from "./api-docs/agent-control.en.md?raw";
import tasksEn from "./api-docs/tasks.en.md?raw";
import goalsProjectsEn from "./api-docs/goals-projects.en.md?raw";
import approvalsEn from "./api-docs/approvals.en.md?raw";
import messagesEn from "./api-docs/messages.en.md?raw";
import filesEn from "./api-docs/files.en.md?raw";
import knowledgeEn from "./api-docs/knowledge.en.md?raw";
import meetingsEn from "./api-docs/meetings.en.md?raw";
import agentsEn from "./api-docs/agents.en.md?raw";
import sprintsEn from "./api-docs/sprints.en.md?raw";

/**
 * Role-scoped API documentation bundles.
 *
 * Every agent used to receive the full endpoint catalogue. Individual
 * contributors paid the token cost for hiring / budget / org-design
 * endpoints they had no authority to call; cache churn followed any
 * api-docs edit. Scope each bundle to the operations the role can
 * actually perform under its decision authority.
 */
export type ApiAudience = "executive" | "manager" | "individual_contributor";

const SECTIONS_BY_ROLE: Record<ApiAudience, string[]> = {
  executive: [
    headerEn,
    agentControlEn,
    tasksEn,
    goalsProjectsEn,
    approvalsEn,
    messagesEn,
    filesEn,
    knowledgeEn,
    meetingsEn,
    agentsEn,
    sprintsEn,
  ],
  manager: [
    headerEn,
    agentControlEn,
    tasksEn,
    goalsProjectsEn,
    approvalsEn,
    messagesEn,
    filesEn,
    knowledgeEn,
    meetingsEn,
    sprintsEn,
  ],
  individual_contributor: [
    headerEn,
    tasksEn,
    messagesEn,
    filesEn,
    knowledgeEn,
    meetingsEn,
  ],
};

function render(template: string, ctx: PromptContext): string {
  const connectorIds = ctx.allConnectors && ctx.allConnectors.length > 0
    ? ctx.allConnectors.map((c) => c.id).join("|")
    : "claude-pro";
  return template
    .replace(/\{\{apiUrl\}\}/g, ctx.apiUrl)
    .replace(/\{\{companyId\}\}/g, ctx.agent.companyId)
    .replace(/\{\{agentId\}\}/g, ctx.agent.id)
    .replace(/\{\{runId\}\}/g, ctx.runId)
    .replace(/\{\{connectorIds\}\}/g, connectorIds);
}

export function buildAPISection(ctx: PromptContext, audience: ApiAudience): string {
  const body = SECTIONS_BY_ROLE[audience]
    .map((s) => render(s, ctx).trimEnd())
    .join("\n\n");
  return `${body}\n${buildSocialSection(ctx)}`;
}
