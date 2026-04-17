import type { AppLocale } from "@shared/locale";
import type { PromptContext } from "./index";
import { buildSocialSection } from "./api-endpoints";
import { resolveLocale } from "./messages/locale";

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

import headerZh from "./api-docs/header.zh.md?raw";
import agentControlZh from "./api-docs/agent-control.zh.md?raw";
import tasksZh from "./api-docs/tasks.zh.md?raw";
import goalsProjectsZh from "./api-docs/goals-projects.zh.md?raw";
import approvalsZh from "./api-docs/approvals.zh.md?raw";
import messagesZh from "./api-docs/messages.zh.md?raw";
import filesZh from "./api-docs/files.zh.md?raw";
import knowledgeZh from "./api-docs/knowledge.zh.md?raw";
import meetingsZh from "./api-docs/meetings.zh.md?raw";
import agentsZh from "./api-docs/agents.zh.md?raw";
import sprintsZh from "./api-docs/sprints.zh.md?raw";

const API_DOC_SECTIONS: Record<AppLocale, string[]> = {
  en: [
    headerEn, agentControlEn, tasksEn, goalsProjectsEn, approvalsEn,
    messagesEn, filesEn, knowledgeEn, meetingsEn, agentsEn, sprintsEn,
  ],
  zh: [
    headerZh, agentControlZh, tasksZh, goalsProjectsZh, approvalsZh,
    messagesZh, filesZh, knowledgeZh, meetingsZh, agentsZh, sprintsZh,
  ],
};

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
  const sections = API_DOC_SECTIONS[resolveLocale(ctx.locale)];
  const body = sections.map((s) => render(s, ctx).trimEnd()).join("\n\n");
  return `${body}\n${buildSocialSection(ctx)}`;
}
