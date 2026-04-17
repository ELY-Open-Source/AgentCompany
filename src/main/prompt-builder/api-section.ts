import type { PromptContext } from "./index";
import { buildSocialSection } from "./api-endpoints";
import headerMd from "./api-docs/header.md?raw";
import agentControlMd from "./api-docs/agent-control.md?raw";
import tasksMd from "./api-docs/tasks.md?raw";
import goalsProjectsMd from "./api-docs/goals-projects.md?raw";
import approvalsMd from "./api-docs/approvals.md?raw";
import messagesMd from "./api-docs/messages.md?raw";
import filesMd from "./api-docs/files.md?raw";
import knowledgeMd from "./api-docs/knowledge.md?raw";
import meetingsMd from "./api-docs/meetings.md?raw";
import agentsMd from "./api-docs/agents.md?raw";
import sprintsMd from "./api-docs/sprints.md?raw";

const API_DOC_SECTIONS: string[] = [
  headerMd,
  agentControlMd,
  tasksMd,
  goalsProjectsMd,
  approvalsMd,
  messagesMd,
  filesMd,
  knowledgeMd,
  meetingsMd,
  agentsMd,
  sprintsMd,
];

function render(template: string, ctx: PromptContext): string {
  const connectorIds = ctx.allConnectors && ctx.allConnectors.length > 0
    ? ctx.allConnectors.map((c) => c.id).join("|")
    : "claude_local";
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
