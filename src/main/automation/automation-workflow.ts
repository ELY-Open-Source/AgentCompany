import { z } from "zod";
import type { AppDatabase } from "../database";
import type { AgentRecord } from "@shared/types";
import type { WorkflowStepState, AutomationEventContext } from "./types";
import type { ActionDeps, ActionCallbacks } from "./automation-actions";
import { executeAutomationAction } from "./automation-actions";
import { isAutomationAction } from "./automation-action-schemas";

// Raw workflow step shape accepted from the DB `stepsJson` column. All fields
// are optional/loose because legacy rows used free-form typeof checks; zod
// applies the normalized defaults once via `.parse(...)`.
const workflowStepInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  action: z.string().optional(),
  configJson: z.string().optional(),
  assigneeDepartment: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  requiresApproval: z.boolean().optional(),
  timeoutSec: z.number().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]).optional(),
}).passthrough();

const workflowStepsInputSchema = z.array(workflowStepInputSchema);

export interface WorkflowDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
}

export function normalizeWorkflowSteps(raw: unknown): WorkflowStepState[] {
  const parsed = workflowStepsInputSchema.parse(raw);
  return parsed.map((step, index) => {
    const rawAction = step.action ?? "send_message";
    if (!isAutomationAction(rawAction)) {
      throw new Error(`Workflow step ${index + 1} has unsupported action "${rawAction}".`);
    }
    return {
      id: step.id && step.id.length > 0 ? step.id : `step-${index + 1}`,
      name: step.name && step.name.length > 0 ? step.name : `Step ${index + 1}`,
      action: rawAction,
      configJson: step.configJson ?? "{}",
      assigneeDepartment: step.assigneeDepartment ?? null,
      assigneeAgentId: step.assigneeAgentId ?? null,
      requiresApproval: step.requiresApproval === true,
      timeoutSec: step.timeoutSec ?? 0,
      status: step.status ?? "pending",
    };
  });
}

export function resolveWorkflowStepActor(
  db: AppDatabase,
  step: WorkflowStepState,
  companyId: string,
): AgentRecord | null {
  if (step.assigneeAgentId) {
    const agent = db.core.entity.getAgent(step.assigneeAgentId);
    if (agent.companyId !== companyId) {
      throw new Error(`Workflow step assignee ${step.assigneeAgentId} does not belong to company ${companyId}.`);
    }
    return agent;
  }

  if (step.assigneeDepartment) {
    const idleAgents = db.core.agents.getIdleAgentsForDepartment(companyId, step.assigneeDepartment);
    if (idleAgents.length > 0) {
      return db.core.entity.getAgent(idleAgents[0]!.id);
    }
  }

  const snapshot = db.projection.snapshot.listSnapshot();
  return snapshot.agents.find((agent) => agent.companyId === companyId && !agent.reportsTo && agent.status !== "terminated") ?? null;
}

export function buildWorkflowActionContext(
  companyId: string,
  step: WorkflowStepState,
  actor: AgentRecord | null,
): { config: Record<string, unknown>; ctx: AutomationEventContext } {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(step.configJson) as Record<string, unknown>;
  } catch {
    throw new Error(`Workflow step "${step.name}" has invalid config JSON.`);
  }

  return {
    config,
    ctx: {
      companyId,
      agentId: actor?.id,
      department: actor?.department ?? step.assigneeDepartment ?? undefined,
      taskId: typeof config.taskId === "string" ? config.taskId : undefined,
      runId: typeof config.runId === "string" ? config.runId : undefined,
      projectId: typeof config.projectId === "string" ? config.projectId : undefined,
      newStatus: typeof config.status === "string" ? config.status : undefined,
    } satisfies AutomationEventContext,
  };
}

export async function runWorkflowPipeline(
  workflowId: string,
  companyId: string,
  deps: WorkflowDeps,
  actionDeps: ActionDeps,
  actionCallbacks: ActionCallbacks,
): Promise<void> {
  const { db, publishDomainChanged } = deps;

  const workflow = db.automation.rules.getWorkflowRecord(workflowId, companyId);
  if (!workflow) {
    throw new Error("Workflow not found.");
  }
  const parsedSteps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
  if (parsedSteps.some((step) => step.status === "running")) {
    throw new Error("Workflow is already running.");
  }
  if (parsedSteps.length === 0) {
    throw new Error("Workflow has no steps.");
  }

  const resumeFrom = workflow.status === "paused" ? workflow.currentStepIndex : 0;
  const steps: WorkflowStepState[] = parsedSteps.map((step, index) => {
    if (workflow.status !== "paused") {
      return { ...step, status: index < resumeFrom ? "completed" : "pending" };
    }
    return step;
  });

  db.automation.rules.updateWorkflowExecution({
    id: workflowId,
    companyId,
    status: "active",
    currentStepIndex: resumeFrom,
    stepsJson: JSON.stringify(steps),
    incrementRunCount: workflow.status !== "paused",
    lastRunAt: new Date().toISOString(),
  });
  publishDomainChanged();

  for (let index = resumeFrom; index < steps.length; index += 1) {
    const step = steps[index]!;
    step.status = "running";
    db.automation.rules.updateWorkflowExecution({
      id: workflowId,
      companyId,
      status: "active",
      currentStepIndex: index,
      stepsJson: JSON.stringify(steps),
      lastRunAt: new Date().toISOString(),
    });
    publishDomainChanged();

    const actor = resolveWorkflowStepActor(db, step, companyId);
    const { config, ctx } = buildWorkflowActionContext(companyId, step, actor);

    if (step.requiresApproval) {
      const approvalId = db.core.approvals.requestApproval({
        companyId,
        requestedByAgentId: actor?.id ?? null,
        relatedTaskId: ctx.taskId ?? null,
        type: "dangerous_command",
        payloadSummary: `Workflow approval required: ${workflow.name} / ${step.name}`,
        impactSummary: `Workflow step "${step.name}" requires board approval before ${step.action}.`,
        payloadJson: JSON.stringify({ workflowId, stepId: step.id, stepName: step.name }),
      });
      step.status = "pending";
      db.automation.rules.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: "paused",
        currentStepIndex: index,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      db.core.activity.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.paused_for_approval",
        entityType: "workflow",
        entityId: workflowId,
        detail: `Paused on step "${step.name}" with approval ${approvalId}.`,
      });
      publishDomainChanged();
      return;
    }

    try {
      executeAutomationAction(
        actionDeps,
        actionCallbacks,
        {
          action: step.action,
          actionConfigJson: JSON.stringify(config),
          targetDepartment: step.assigneeDepartment,
          trigger: "workflow_step",
        },
        ctx,
      );
      step.status = "completed";
      db.core.activity.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.step_completed",
        entityType: "workflow",
        entityId: workflowId,
        detail: step.name,
      });
      const isLastStep = index === steps.length - 1;
      const completionStatus = isLastStep ? "completed" : "active";
      db.automation.rules.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: completionStatus,
        currentStepIndex: index + 1,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      publishDomainChanged();
    } catch (error) {
      step.status = "failed";
      db.automation.rules.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: "failed",
        currentStepIndex: index,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      db.core.activity.addActivity({
        companyId,
        actor: actor?.id ?? "system",
        action: "workflow.step_failed",
        entityType: "workflow",
        entityId: workflowId,
        detail: `${step.name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      publishDomainChanged();
      throw error;
    }
  }
}
