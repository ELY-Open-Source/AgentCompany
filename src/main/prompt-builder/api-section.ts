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

const API_DOC_SECTIONS: string[] = [
  headerEn, agentControlEn, tasksEn, goalsProjectsEn, approvalsEn,
  messagesEn, filesEn, knowledgeEn, meetingsEn, agentsEn, sprintsEn,
];

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

export function buildAPISection(ctx: PromptContext): string {
  const body = API_DOC_SECTIONS.map((s) => render(s, ctx).trimEnd()).join("\n\n");
  return `${body}\n${buildSocialSection(ctx)}`;
}
