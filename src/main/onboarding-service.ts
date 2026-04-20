import type { AppDatabase } from "./database";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import type { ConnectorId, ConnectorRecord } from "@shared/types";
import { validateConnectorModelSelection, connectorPolicyDepsFromDb } from "./connector-model-policy";

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
  executionMode?: string;
  goalTitle: string;
  goalDescription: string;
  connectorId?: ConnectorId;
  connectorModel?: string;
  connectorPoolSelections?: Array<{
    connectorId: ConnectorId;
    disabledModels: Array<{ id: string; label: string }>;
  }>;
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
  /** Scan workspace directories for skills and import them. Best-effort — may be undefined during early init. */
  scanAndAssignSkills?: (companyId: string, agentId: string) => Promise<void>;
  /** Optional logger for non-fatal errors from best-effort operations (skill seeding, etc.). */
  logger?: { warn: (...args: unknown[]) => void };
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
  scanAndAssignSkills,
  logger,
}: OnboardingDependencies) {
  function updateAgentWorkspaceBinding(agentId: string, workspaceId: string | null) {
    if (!workspaceId) return;
    const agent = db.entityCrud.getAgent(agentId);
    if (agent.workspaceId === workspaceId) return;
    db.agents.saveAgent({
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

  function getLocale(): string {
    return db.queryAll<{ value: string }>("select value from settings where key = 'locale' limit 1")[0]?.value ?? "en";
  }

  function createDefaultWorkspace(companyId: string, workspacePath: string) {
    const trimmedPath = workspacePath.trim();
    if (!trimmedPath) return null;
    const wsLocale = getLocale();
    return db.workspacesMod.saveWorkspace({
      companyId,
      name: wsLocale === "zh" ? "默认工作区" : "Default Workspace",
      localPath: trimmedPath,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
  }

  function createInitialExecutionLoop(companyId: string, workspaceId: string | null): OnboardingBootstrapSummary {
    const companyRows = db.queryAll<{ id: string; name: string; description: string }>(
      "select id, name, description from companies where id = ? limit 1",
      companyId,
    );
    const company = companyRows[0] ?? null;
    if (!company) {
      throw new Error("Company no longer exists during onboarding bootstrap.");
    }

    const leadAgentRows = db.queryAll<{ id: string; companyId: string; name: string; role: string; title: string; department: string | null; status: string; reportsTo: string | null; connectorId: string; workspaceId: string | null; model: string | null; metadataJson: string; capabilities: string; budgetMonthlyUsd: number; heartbeatEnabled: number; heartbeatIntervalSec: number }>(
      "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, metadata_json as metadataJson, capabilities, budget_monthly_usd as budgetMonthlyUsd, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec from agents where company_id = ? and reports_to is null limit 1",
      companyId,
    );
    const leadAgent = leadAgentRows[0] ?? null;
    if (!leadAgent) {
      throw new Error("Unable to find the lead agent for the company bootstrap.");
    }

    updateAgentWorkspaceBinding(leadAgent.id, workspaceId);

    const goalRows = db.queryAll<{ id: string; title: string; status: string }>(
      "select id, title, status from goals where company_id = ? order by created_at asc",
      companyId,
    );
    const activeGoal =
      goalRows.find((goal) => goal.status === "active")
      ?? goalRows[0]
      ?? null;

    const kickoffProjectName = activeGoal ? `Execution plan: ${activeGoal.title}` : "Initial operating plan";
    const kickoffProjectDescription = activeGoal
      ? `Turn the founding goal "${activeGoal.title}" into an execution plan, delegation map, and the first wave of real work.`
      : "Establish the first operating plan, assign work, and start the company execution loop.";

    const projectId = db.entityCrud.saveProject({
      companyId,
      goalId: activeGoal?.id ?? null,
      name: kickoffProjectName,
      description: kickoffProjectDescription,
      leadAgentId: leadAgent.id,
      targetDate: null,
      status: "in_progress",
    });

    const kickoffLocale = getLocale();
    const kickoffTaskTitle = activeGoal
      ? (kickoffLocale === "zh" ? `落地目标：${activeGoal.title}` : `Operationalize goal: ${activeGoal.title}`)
      : (kickoffLocale === "zh" ? "建立首个运营节奏" : "Establish the first operating cadence");
    const kickoffTaskDescription = activeGoal
      ? [
          `Read the founding goal "${activeGoal.title}" and convert it into a real operating plan.`,
          `Before planning, explore the workspace codebase: list the top-level directory, read key files (README, package.json, config files), and understand the project structure, languages, and frameworks in use.`,
          `Consider the full company context — the company name "${company.name}", its description ("${company.description}"), and the goal — when deciding what departments, roles, and execution strategy are needed.`,
          `Create the first execution structure inside AgentCompany: projects, tasks, delegation, approvals, and coordination messages as needed.`,
          `Use the bound workspace as the default execution boundary for the first round of work.`,
        ].join("\n\n")
      : [
          `Establish the first operating plan for the company.`,
          `Before planning, explore the workspace codebase: list the top-level directory, read key files (README, package.json, config files), and understand the project structure, languages, and frameworks in use.`,
          `Consider the full company context — the company name "${company.name}" and its description ("${company.description}") — when deciding what departments, roles, and execution strategy are needed.`,
          `Review the current company state, create the first real tasks, delegate initial work, and report progress through tasks, approvals, and messages.`,
        ].join("\n\n");

    const taskId = db.tasks.saveTask({
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
      // Kickoff explicitly reads the workspace codebase (see
      // description above — "list the top-level directory, read key
      // files"), so this is a filesystem-touching task and must take
      // an exclusive lock on the bound workspace.
      requiresFilesystem: true,
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
    const connectors = db.snap.listSnapshot({ companyId: null }).connectors;
    const selectedConnectorId = resolveOnboardingConnector(connectors, input.connectorId);

    const companyId = db.company.saveCompany({
      name: input.companyName.trim(),
      description: input.companyDescription.trim(),
      status: "active",
      autoApproveHires: input.autoApproveHires,
      reviewDeliverables: input.reviewDeliverables,
      executionMode: input.executionMode ?? "ai_ceo",
    });

    // Persist the user's per-connector disabled-model selections
    // against the freshly-created company id. Onboarding is entirely
    // pre-commit; the pool settings arrive in the input payload and
    // land in the DB only once a company exists to scope them.
    for (const pool of input.connectorPoolSelections ?? []) {
      db.settings.setDisabledModels(companyId, pool.connectorId, pool.disabledModels);
    }

    // Validate the CEO model selection against the now-persisted pool
    // scoped to this new company. Must run AFTER the pool is stored,
    // otherwise the validator sees an empty pool and accepts anything.
    const modelSelection = validateConnectorModelSelection(connectorPolicyDepsFromDb(db), companyId, selectedConnectorId, input.connectorModel ?? null);
    if (!modelSelection.ok) {
      throw new Error(modelSelection.error);
    }

    const workspaceId = createDefaultWorkspace(companyId, input.workspacePath);

    const goalTitle = input.goalTitle.trim();
    if (goalTitle) {
      db.entityCrud.saveGoal({
        companyId,
        title: goalTitle,
        description: input.goalDescription.trim() || `Achieve: ${goalTitle}`,
        status: "active",
        parentId: null,
        ownerAgentId: null,
      });
    }

    const ceoLocale = getLocale();
    const ceoId = db.agents.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: ceoLocale === "zh" ? "首席执行官" : "Chief Executive Officer",
      reportsTo: null,
      connectorId: selectedConnectorId,
      workspaceId,
      model: input.connectorModel?.trim() || null,
      capabilities: ceoLocale === "zh"
        ? "高管领导力、战略规划、团队建设、目标分解、授权管理和组织运营。负责招募领导团队、制定战略，并协调公司所有运营活动。"
        : "Executive leadership, strategic planning, team building, goal decomposition, delegation, and organizational management. Responsible for hiring the leadership team, setting strategy, and coordinating all company operations.",
      budgetMonthlyUsd: 250,
      status: "idle",
      // CEO is pinned to the user's pick at onboarding. Never let the
      // dispatcher re-route it.
      modelStrategy: "explicit",
      roleLevel: "c_suite",
    });
    db.agents.setHeartbeat(ceoId, true, 120);
    db.settings.setCurrentCompany(companyId);
    seedDefaultAutomationRules(companyId);

    if (scanAndAssignSkills) {
      void scanAndAssignSkills(companyId, ceoId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn(`[onboarding] skill scan failed for agent ${ceoId}: ${message}`);
      });
    }

    const kickoff = createInitialExecutionLoop(companyId, workspaceId);

    db.activityMod.addActivity({
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
