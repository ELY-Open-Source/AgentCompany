import type { AppDatabase } from "./database";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import type { ConnectorId, ConnectorRecord } from "@shared/types";

interface OnboardingBootstrapSummary {
  companyId: string;
  companyName: string;
  workspaceId: string | null;
  leadAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
}

interface BootstrapInput {
  companyName: string;
  companyDescription: string;
  workspacePath: string;
  autoApproveHires: boolean;
  reviewDeliverables?: boolean;
  goalTitle: string;
  goalDescription: string;
  connectorId?: ConnectorId;
}

interface OnboardingDependencies {
  db: AppDatabase;
  seedDefaultAutomationRules: (companyId: string) => void;
  queueTaskRun: (taskId: string, trigger: string, actor: string) => {
    ok: boolean;
    data?: string;
    error?: { code: string; message: string };
  };
  publishDomainChanged: () => void;
}

const DEFERRABLE_RUN_ERRORS = new Set([
  "WORKER_UNAVAILABLE",
  "CONNECTOR_NOT_READY",
  "TASK_ALREADY_RUNNING",
  "AGENT_ALREADY_RUNNING",
]);

function resolveOnboardingConnector(
  connectors: Array<Pick<ConnectorRecord, "id" | "label" | "status" | "capabilityMatrix">>,
  preferredConnectorId?: ConnectorId,
) {
  if (preferredConnectorId) {
    const preferredConnector = connectors.find((connector) => connector.id === preferredConnectorId);
    if (!preferredConnector) {
      throw new Error(`Selected connector ${preferredConnectorId} is not available.`);
    }
    const issue = getConnectorExecutionReadinessIssue(preferredConnector);
    if (issue) {
      throw new Error(issue);
    }
    return preferredConnector.id;
  }

  const defaultConnector = connectors.find((connector) => isConnectorExecutionReady(connector));
  if (!defaultConnector) {
    throw new Error("At least one execution-ready connector is required before onboarding can continue.");
  }
  return defaultConnector.id;
}

export function createOnboardingService({
  db,
  seedDefaultAutomationRules,
  queueTaskRun,
  publishDomainChanged,
}: OnboardingDependencies) {
  function updateAgentWorkspaceBinding(agentId: string, workspaceId: string | null) {
    if (!workspaceId) return;
    const agent = db.getAgent(agentId);
    if (agent.workspaceId === workspaceId) return;
    db.saveAgent({
      id: agent.id,
      companyId: agent.companyId,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      department: agent.department,
      status: agent.status,
      reportsTo: agent.reportsTo,
      connectorId: agent.connectorId,
      workspaceId,
      model: agent.model,
      metadataJson: agent.metadataJson,
      capabilities: agent.capabilities,
      budgetMonthlyUsd: agent.budgetMonthlyUsd,
    });
  }

  function createDefaultWorkspace(companyId: string, workspacePath: string) {
    const trimmedPath = workspacePath.trim();
    if (!trimmedPath) return null;
    return db.saveWorkspace({
      companyId,
      name: "Default Workspace",
      localPath: trimmedPath,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
  }

  function createInitialExecutionLoop(companyId: string, workspaceId: string | null): OnboardingBootstrapSummary {
    const snapshot = db.listSnapshot();
    const company = snapshot.companies.find((entry) => entry.id === companyId) ?? null;
    if (!company) {
      throw new Error("Company no longer exists during onboarding bootstrap.");
    }

    const leadAgent = snapshot.agents.find((agent) => agent.companyId === companyId && !agent.reportsTo) ?? null;
    if (!leadAgent) {
      throw new Error("Unable to find the lead agent for the company bootstrap.");
    }

    updateAgentWorkspaceBinding(leadAgent.id, workspaceId);

    const activeGoal =
      snapshot.goals.find((goal) => goal.companyId === companyId && goal.status === "active")
      ?? snapshot.goals.find((goal) => goal.companyId === companyId)
      ?? null;

    const kickoffProjectName = activeGoal ? `Execution plan: ${activeGoal.title}` : "Initial operating plan";
    const kickoffProjectDescription = activeGoal
      ? `Turn the founding goal "${activeGoal.title}" into an execution plan, delegation map, and the first wave of real work.`
      : "Establish the first operating plan, assign work, and start the company execution loop.";

    const projectId = db.saveProject({
      companyId,
      goalId: activeGoal?.id ?? null,
      name: kickoffProjectName,
      description: kickoffProjectDescription,
      leadAgentId: leadAgent.id,
      targetDate: null,
      status: "in_progress",
    });

    const kickoffTaskTitle = activeGoal ? `Operationalize goal: ${activeGoal.title}` : "Establish the first operating cadence";
    const kickoffTaskDescription = activeGoal
      ? [
          `Read the founding goal "${activeGoal.title}" and convert it into a real operating plan.`,
          "Create the first execution structure inside AgentCompany: projects, tasks, delegation, approvals, and coordination messages as needed.",
          "Use the bound workspace as the default execution boundary for the first round of work.",
        ].join("\n\n")
      : [
          "Establish the first operating plan for the company.",
          "Review the current company state, create the first real tasks, delegate initial work, and report progress through tasks, approvals, and messages.",
        ].join("\n\n");

    const taskId = db.saveTask({
      companyId,
      projectId,
      goalId: activeGoal?.id ?? null,
      parentId: null,
      title: kickoffTaskTitle,
      description: kickoffTaskDescription,
      assigneeAgentId: leadAgent.id,
      workspaceId: workspaceId ?? leadAgent.workspaceId ?? null,
      priority: "high",
      status: "todo",
    });

    const startRunResult = queueTaskRun(taskId, "assignment", "system");
    if (!startRunResult.ok && !DEFERRABLE_RUN_ERRORS.has(startRunResult.error?.code ?? "")) {
      throw new Error(startRunResult.error?.message ?? "Failed to queue the initial execution loop.");
    }

    return {
      companyId,
      companyName: company.name,
      workspaceId,
      leadAgentId: leadAgent.id,
      projectId,
      taskId,
      runId: startRunResult.ok ? startRunResult.data ?? null : null,
    };
  }

  function bootstrapOnboarding(input: BootstrapInput): OnboardingBootstrapSummary {
    const snapshot = db.listSnapshot();
    const selectedConnectorId = resolveOnboardingConnector(snapshot.connectors, input.connectorId);

    const companyId = db.saveCompany({
      name: input.companyName.trim(),
      description: input.companyDescription.trim(),
      status: "active",
      autoApproveHires: input.autoApproveHires,
      reviewDeliverables: input.reviewDeliverables,
    });
    const workspaceId = createDefaultWorkspace(companyId, input.workspacePath);

    const goalTitle = input.goalTitle.trim();
    if (goalTitle) {
      db.saveGoal({
        companyId,
        title: goalTitle,
        description: input.goalDescription.trim() || `Achieve: ${goalTitle}`,
        status: "active",
        parentId: null,
        ownerAgentId: null,
      });
    }

    const ceoId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      reportsTo: null,
      connectorId: selectedConnectorId,
      workspaceId,
      model: null,
      capabilities:
        "Executive leadership, strategic planning, team building, goal decomposition, delegation, and organizational management. Responsible for hiring the leadership team, setting strategy, and coordinating all company operations.",
      budgetMonthlyUsd: 250,
      status: "idle",
    });
    db.setHeartbeat(ceoId, true, 120);
    db.setCurrentCompany(companyId);
    seedDefaultAutomationRules(companyId);

    const kickoff = createInitialExecutionLoop(companyId, workspaceId);

    db.addActivity({
      companyId,
      actor: "board",
      action: "company.bootstrapped",
      entityType: "company",
      entityId: companyId,
      detail: `Bootstrapped from onboarding with connector ${selectedConnectorId}.`,
    });
    publishDomainChanged();
    return kickoff;
  }

  return {
    bootstrapOnboarding,
  };
}
