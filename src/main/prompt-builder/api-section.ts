import type { PromptContext } from "./index";
import { buildSocialSection } from "./api-endpoints";
import { approvalTypeEnum, type ApprovalType } from "@shared/types";
import { COFOUNDER_MANDATORY_APPROVAL_TYPES } from "../execution-policy";

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

const APPROVAL_TYPE_DESCRIPTIONS: Record<ApprovalType, string> = {
  hire_agent: "Propose a new team member",
  approve_ceo_strategy: "CEO submits org strategy for Board review",
  dangerous_command: "Irreversible command or destructive operation",
  secret_access: "Need API keys, credentials, or account access",
  budget_request: "Request budget for planned spend",
  promotion: "Propose role or seniority advancement",
  termination: "Propose ending an agent's role",
  vendor_approval: "Approve vendor, SaaS, or service purchase",
  document_review: "Request review of an existing document",
  production_deploy: "Approve deployment to production",
  incident_escalation: "Escalate a critical incident for human decision",
  social_post: "Approve a social media post before publishing",
  deliverable_review: "Approve a completed deliverable or spec",
  budget_override: "Override a budget gate for urgent work",
  plan_review: "Review a plan before execution",
  scope_review: "Review proposed scope before work proceeds",
  draft_review: "Review a drafted document or artifact",
  strategy_review: "Review strategy, project brief, or proposal",
  exception_review: "Review an exception to normal policy",
};

function renderApprovalTypeList(): string {
  return approvalTypeEnum.options
    .map((type) => `  - ${type}: ${APPROVAL_TYPE_DESCRIPTIONS[type]}`)
    .join("\n");
}

function renderCofounderMandatoryApprovalTypes(): string {
  return COFOUNDER_MANDATORY_APPROVAL_TYPES
    .map((type) => `  - ${type}`)
    .join("\n");
}

function render(template: string, ctx: PromptContext): string {
  const connectorIds = ctx.allConnectors && ctx.allConnectors.length > 0
    ? ctx.allConnectors.map((c) => c.id).join("|")
    : "claude-pro";
  return template
    .replace(/\{\{apiUrl\}\}/g, ctx.apiUrl)
    .replace(/\{\{companyId\}\}/g, ctx.agent.companyId)
    .replace(/\{\{agentId\}\}/g, ctx.agent.id)
    .replace(/\{\{connectorIds\}\}/g, connectorIds)
    .replace(/\{\{approvalTypes\}\}/g, approvalTypeEnum.options.join("|"))
    .replace(/\{\{approvalTypeList\}\}/g, renderApprovalTypeList())
    .replace(/\{\{cofounderMandatoryApprovalTypes\}\}/g, renderCofounderMandatoryApprovalTypes());
}

export function buildAPISection(ctx: PromptContext, audience: ApiAudience): string {
  const body = SECTIONS_BY_ROLE[audience]
    .map((s) => render(s, ctx).trimEnd())
    .join("\n\n");
  return `${body}\n${buildSocialSection(ctx)}`;
}
