import { randomUUID } from "node:crypto";
import { buildTaskPrompt } from "./prompt-builder";
import type { AppDatabase } from "./database";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import type { DesktopResult } from "@shared/contracts";
import type { ConnectorRecord } from "@shared/types";
import type { NotificationOptions } from "./notification-service";
import type { createBudgetEnforcementService } from "./budget-enforcement-service";
import { sweepStaleReviews } from "./task-quality-gates";
import { resolveApprovalDecision } from "./approval-policy";
import { dispatchAgentMessage } from "./message-dispatch";

type WorkspaceLockMode = "exclusive" | "shared" | "none";

interface WorkspaceResolution {
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  lockMode: WorkspaceLockMode;
  source: "task" | "agent" | "project" | "company_fallback" | "none";
}

interface AutomationDispatch {
  companyId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;
  projectId?: string;
  department?: string;
  previousStatus?: string;
  newStatus?: string;
  costUsd?: number;
}

interface EnqueueRunPayload {
  runId: string;
  companyId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  agentId: string;
  agentName: string;
  connectorId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: WorkspaceLockMode;
  command: string;
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  sessionParams: Record<string, unknown> | null;
  systemPrompt: string | null;
  trigger: string | null;
  managedSkills: Array<{ runtimeName: string; sourcePath: string }>;
}

interface OrchestrationDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  emitEvent: (event: any) => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  getApiPort: () => number;
  dispatchAutomation: (trigger: string, ctx: AutomationDispatch) => void;
  hasWorkerReady: () => boolean;
  enqueueWorkerRun: (payload: EnqueueRunPayload) => void;
  isQuitting: () => boolean;
  listRuntimeSkillEntries: (companyId: string, agentId: string, connectorId: string) => Array<{ runtimeName: string; sourcePath: string }>;
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  getSessionHandoff?: (taskId: string) => string | null;
}

export function createOrchestrationService({
  db,
  logger,
  publishDomainChanged,
  emitEvent,
  notify,
  createRunToken,
  getApiPort,
  dispatchAutomation,
  hasWorkerReady,
  enqueueWorkerRun,
  isQuitting,
  listRuntimeSkillEntries,
  budgetService,
  getSessionHandoff,
}: OrchestrationDependencies) {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const scheduleLastFiredMap = new Map<string, number>();

  function ok<T>(data: T): DesktopResult<T> {
    return { ok: true, data };
  }

  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  function hasActiveRun(filter: { taskId?: string; agentId?: string; companyId: string }) {
    return db.hasActiveRun(filter);
  }

  function resolveWorkspace(
    task: { workspaceId: string | null; projectId?: string | null },
    agent: { workspaceId: string | null },
    companyId: string,
  ): WorkspaceResolution {
    const taskWorkspace = db.getWorkspace(task.workspaceId);
    if (taskWorkspace) {
      return { workspace: taskWorkspace, lockMode: "exclusive", source: "task" };
    }

    const agentWorkspace = db.getWorkspace(agent.workspaceId);
    if (agentWorkspace) {
      return { workspace: agentWorkspace, lockMode: "exclusive", source: "agent" };
    }

    const projectWorkspace = db.getProjectPrimaryWorkspace(task.projectId ?? null, companyId);
    if (projectWorkspace) {
      return { workspace: projectWorkspace, lockMode: "exclusive", source: "project" };
    }

    const fallbackWorkspace = db.getAnyCompanyWorkspace(companyId);
    if (fallbackWorkspace) {
      return { workspace: fallbackWorkspace, lockMode: "shared", source: "company_fallback" };
    }

    return { workspace: null, lockMode: "none", source: "none" };
  }

  // DEPRECATED: Superseded by BudgetEnforcementService.evaluateBudgetGate (Phase 5)
  function autoPauseBudgetExceededAgent(agent: { id: string; companyId: string; name: string; spentMonthlyUsd: number; budgetMonthlyUsd: number }) {
    if (!(agent.budgetMonthlyUsd > 0) || agent.spentMonthlyUsd < agent.budgetMonthlyUsd) {
      return false;
    }
    db.updateAgentStatus(agent.id, "paused");
    db.addActivity({
      companyId: agent.companyId,
      actor: "system",
      action: "agent.auto_paused",
      entityType: "agent",
      entityId: agent.id,
      detail: `Budget exhausted at ${agent.spentMonthlyUsd.toFixed(2)} / ${agent.budgetMonthlyUsd.toFixed(2)} USD.`,
    });
    notify({
      title: "Agent Paused",
      body: `${agent.name} paused -- budget limit reached`,
      urgency: "informational",
      navigation: { section: "agents", entityId: agent.id },
      batchKey: "agent_paused",
    });
    emitEvent({ type: "agent-updated", agentId: agent.id, action: "paused" });
    return true;
  }

  function ensureAgentHeartbeatEnabled(agentId: string) {
    const agent = db.getAgent(agentId);
    if (!agent.heartbeatEnabled) {
      db.setHeartbeat(agentId, true, agent.heartbeatIntervalSec || 120);
    }
  }

  function getRunEligibilityFailure(
    agent: { status: string; budgetMonthlyUsd: number; spentMonthlyUsd: number; name: string; connectorId: string; id: string; companyId: string },
    connector: Pick<ConnectorRecord, "id" | "label" | "status" | "capabilityMatrix">,
    projectId: string | null = null,
  ) {
    if (["terminated", "paused", "pending_approval"].includes(agent.status)) {
      return "AGENT_NOT_RUNNABLE";
    }
    // Policy-based budget check replaces flat field check (D-03, D-04, D-05)
    const gate = budgetService.evaluateBudgetGate(agent.companyId, agent.id, projectId);
    if (!gate.allowed) {
      logger.info(`[run] Agent ${agent.name} budget policy blocked: ${gate.blockedBy.map(b => `${b.scopeType}(${b.policyId})`).join(", ")}`);
      return "BUDGET_POLICY_BLOCKED";
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connector);
    if (connectorIssue) {
      const issue = connectorIssue ?? `Connector ${connector.id} is not execution-ready.`;
      logger.info(`[run] Agent ${agent.name} connector ${connector.id} blocked: ${issue}`);
      return "CONNECTOR_NOT_READY";
    }
    return null;
  }

  function dispatchRunToWorker(params: {
    runId: string;
    companyId: string;
    agent: ReturnType<AppDatabase["getAgent"]>;
    task: ReturnType<AppDatabase["getTask"]>;
    connector: ReturnType<AppDatabase["getConnector"]>;
    workspace: ReturnType<AppDatabase["getWorkspace"]>;
    workspaceMode: WorkspaceLockMode;
    companyName: string;
    companyDescription: string;
    snapshot: ReturnType<AppDatabase["listSnapshot"]>;
    trigger: string;
  }) {
    const { runId, companyId, agent, task, connector, workspace, workspaceMode, companyName, companyDescription, snapshot, trigger } = params;
    if (isQuitting()) {
      throw new Error("Application is shutting down — refusing to dispatch new run.");
    }
    if (!hasWorkerReady()) {
      throw new Error("Orchestration worker is not ready.");
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connector);
    if (connectorIssue) {
      throw new Error(connectorIssue);
    }

    const env = db.resolveSecretEnv(connector.envBindingText, companyId);
    const apiPort = getApiPort();
    const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
    const apiKey = apiUrl ? createRunToken(agent.id, companyId, runId) : "";

    const assignedTasks = db.listAgentTasks(agent.id, companyId, ["todo", "in_progress", "blocked"]);
    const reviewTasks = db.listReviewTasksForManager(agent.id, companyId);
    const relevantTaskIds = new Set([
      ...assignedTasks.map((task) => task.id),
      ...reviewTasks.map((task) => task.id),
    ]);
    const allRelevantTasks = [...assignedTasks, ...reviewTasks];
    const recentComments = snapshot.comments
      .filter((comment) => relevantTaskIds.has(comment.taskId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map((comment) => ({
        taskId: comment.taskId,
        taskTitle: allRelevantTasks.find((task) => task.id === comment.taskId)?.title ?? comment.taskId,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt,
      }));

    // D-07: Load handoff from previous rotated session
    let sessionHandoff: string | null = null;
    if (getSessionHandoff) {
      try {
        sessionHandoff = getSessionHandoff(task.id);
      } catch (err) {
        logger.warn(`[run] Failed to load session handoff for task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const systemPrompt = apiUrl ? buildTaskPrompt({
      agent,
      apiUrl,
      apiKey,
      runId,
      task,
      companyName,
      locale: snapshot.locale,
      goals: snapshot.goals.filter((goal) => goal.companyId === companyId),
      projects: snapshot.projects.filter((project) => project.companyId === companyId),
      directReports: db.getDirectReports(agent.id, companyId),
      chainOfCommand: db.getChainOfCommand(agent.id),
      assignedTasks,
      allAgents: snapshot.agents.filter((entry) => entry.companyId === companyId),
      pendingApprovals: snapshot.approvals.filter(
        (approval) => approval.companyId === companyId &&
          approval.requestedByAgentId === agent.id &&
          (approval.state === "pending" || approval.state === "revision_requested"),
      ),
      tasksAwaitingReview: db.listReviewTasksForManager(agent.id, companyId),
      wakeReason: trigger,
      allTasks: snapshot.tasks.filter((entry) => entry.companyId === companyId),
      recentComments,
      companyDescription,
      socialAccounts: db.listSocialAccounts(companyId).map((account) => ({
        id: account.id,
        platform: account.platform,
        accountName: account.accountName,
        status: account.status,
        requireApproval: account.requireApproval,
      })),
      recentMessages: db.listAgentMessages(companyId, { agentId: agent.id, limit: 15 }),
      upcomingMeetings: snapshot.meetings
        .filter((meeting) => meeting.companyId === companyId && (meeting.status === "scheduled" || meeting.status === "in_progress"))
        .filter((meeting) => {
          try {
            const ids: string[] = JSON.parse(meeting.participantAgentIds);
            return ids.includes(agent.id) || meeting.organizerAgentId === agent.id;
          } catch {
            return false;
          }
        })
        .slice(0, 5),
      relevantKnowledge: snapshot.knowledgeBase
        .filter((entry) => entry.companyId === companyId && (entry.importance === "critical" || entry.importance === "high"))
        .slice(0, 8),
      activeSprint: snapshot.sprints.find((sprint) => sprint.companyId === companyId && sprint.status === "active") ?? null,
      recentDocuments: snapshot.documents
        .filter((document) => document.companyId === companyId && (document.authorAgentId === agent.id || document.reviewerAgentId === agent.id || document.status === "in_review"))
        .slice(0, 5),
      allConnectors: snapshot.connectors.map((c) => ({ id: c.id, label: c.label, status: c.status })),
      sessionHandoff,
    }) : null;

    if (apiUrl) {
      env.AGENT_COMPANY_API_URL = apiUrl;
      env.AGENT_COMPANY_API_KEY = apiKey;
      env.AGENT_COMPANY_AGENT_ID = agent.id;
      env.AGENT_COMPANY_COMPANY_ID = companyId;
      env.AGENT_COMPANY_RUN_ID = runId;
      env.AGENT_COMPANY_TASK_ID = task.id;
      env.AGENT_COMPANY_WAKE_REASON = trigger;
    }

    // SESS-01: Prefer task_sessions table, fall back to legacy tasks.session_json
    const activeSession = db.getActiveTaskSession(task.id);
    const taskSession = activeSession
      ? {
          sessionParams: activeSession.sessionParamsJson ? JSON.parse(activeSession.sessionParamsJson) as Record<string, unknown> : null,
          sessionDisplayId: activeSession.sessionDisplayId,
        }
      : db.getTaskSession(task.id);
    let thinkingEffort: string | null = null;
    try {
      const meta = JSON.parse(agent.metadataJson || "{}");
      if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
        thinkingEffort = meta.thinkingEffort;
      }
    } catch {
      thinkingEffort = null;
    }

    // Fetch managed skills for this agent -- best-effort, never blocks run dispatch
    let managedSkills: Array<{ runtimeName: string; sourcePath: string }> = [];
    try {
      managedSkills = listRuntimeSkillEntries(companyId, agent.id, connector.id);
    } catch (err) {
      logger.warn(`[run] Failed to fetch managed skills for agent ${agent.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    enqueueWorkerRun({
      runId,
      companyId,
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      agentId: agent.id,
      agentName: agent.name,
      connectorId: connector.id,
      workspaceId: workspaceMode === "exclusive" ? (workspace?.id ?? null) : null,
      workspacePath: workspace?.localPath ?? null,
      workspaceMode,
      command: connector.command,
      model: connector.model ?? agent.model,
      thinkingEffort,
      env,
      sessionParams: taskSession.sessionParams,
      systemPrompt,
      trigger,
      managedSkills,
    });
  }

  function startAgentHeartbeatRun(agentId: string, companyId: string, trigger: string): string | null {
    if (isQuitting()) return null;
    if (!hasWorkerReady()) return null;
    const companyStatus = db.getCompanyStatus(companyId);
    if (companyStatus !== "active") {
      logger.info(`[heartbeat] Skipping ${agentId} because company ${companyId} is not active.`);
      return null;
    }
    const agent = db.getAgent(agentId);
    if (agent.companyId !== companyId) {
      logger.warn(`[heartbeat] Refusing cross-company run for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
      return null;
    }
    const connector = db.getConnector(agent.connectorId);
    if (getRunEligibilityFailure(agent, connector, null)) {
      return null;
    }
    if (hasActiveRun({ agentId: agent.id, companyId })) {
      logger.info(`[heartbeat] Skipping ${agent.name} because it already has an active run.`);
      return null;
    }
    if (db.isAgentPendingApproval(agentId)) {
      logger.info(`[heartbeat] Skipping ${agent.name} because agent is pending hire approval.`);
      return null;
    }

    // Block heartbeat when agent has tasks awaiting user deliverable review
    // Check both: pending approval (gate created) and requires_user_review flag (gap before approval)
    if (db.hasAgentPendingDeliverableReview(agentId, companyId) || db.hasAgentTaskAwaitingReview(agentId, companyId)) {
      logger.info(`[heartbeat] Skipping ${agent.name} — awaiting user deliverable review.`);
      return null;
    }

    // Block CEO heartbeat when company has any pending deliverable reviews
    // CEO should not create new work while the user hasn't reviewed existing deliverables
    if (!agent.reportsTo && db.hasPendingDeliverableReviews(companyId)) {
      logger.info(`[heartbeat] Skipping CEO ${agent.name} — company has pending deliverable reviews.`);
      return null;
    }

    const assignedTasks = db.listAgentTasks(agentId, companyId, ["todo", "in_progress", "blocked"]);
    const isTimer = trigger === "timer";
    const candidateTasks = isTimer
      ? assignedTasks.filter((entry) => !entry.title.startsWith("[Heartbeat]"))
      : assignedTasks;

    let task = candidateTasks.find((entry) => !entry.activeRunId) ?? null;

    if (!task) {
      const hasActiveAssignedRun = candidateTasks.some(
        (entry) => entry.activeRunId && hasActiveRun({ taskId: entry.id, companyId }),
      );
      if (hasActiveAssignedRun) {
        return null;
      }

      const isCeo = !agent.reportsTo;
      const isManager = db.getDirectReports(agent.id, companyId).length > 0;
      const goalCount = db.countActiveGoalsForCompany(companyId);
      const taskCount = db.countActiveTasksForCompany(companyId);
      const companyNeedsBootstrap = goalCount > 0 && taskCount < goalCount;

      if (isTimer && !isCeo && !isManager && !companyNeedsBootstrap) {
        logger.info(`[heartbeat] Skipping ${agent.name} — no actionable tasks and trigger is timer.`);
        return null;
      }

      const taskTitle = isCeo
        ? `[Heartbeat] ${agent.name} — Strategic planning & task delegation`
        : isManager
          ? `[Heartbeat] ${agent.name} — Review team & delegate work`
          : `[Heartbeat] ${agent.name} — Check for work`;
      const taskDescription = isCeo
        ? "Review active company goals. Break each goal into projects and actionable tasks. Assign tasks to department leads and team members. Create tasks using the API. This is your primary responsibility as CEO — ensure every goal has a clear execution plan with assigned owners."
        : isManager
          ? "Review your department's goals and your team's workload. Create tasks for your direct reports if they have capacity. Review any work submitted for your approval. Ensure your team is productive and unblocked."
          : `Automated heartbeat run for ${agent.name}. Review assigned tasks, check goals, and take action as needed.`;

      const taskId = db.saveTask({
        companyId,
        title: taskTitle,
        description: taskDescription,
        assigneeAgentId: agentId,
        workspaceId: agent.workspaceId ?? undefined,
        status: "in_progress",
        priority: isCeo ? "high" : "medium",
      });
      task = db.getTask(taskId);
      logger.info(`[heartbeat] Created bootstrap task for ${agent.name}: ${taskTitle}`);
    }

    // Generate runId upfront for CAS checkout (EXEC-01, EXEC-02)
    const runId = randomUUID();
    const checkoutSuccess = db.checkoutTask(task.id, runId);
    if (!checkoutSuccess) {
      // D-04: Activity log entry only, no toast/popup
      db.addActivity({
        companyId,
        actor: "system",
        action: "execution.checkout_rejected",
        entityType: "task",
        entityId: task.id,
        detail: `Agent ${agent.name} lost checkout race on task "${task.title}"`,
      });
      logger.info(`[heartbeat] Agent ${agent.name} lost checkout race on task ${task.title}`);
      return null;
    }

    const workspaceResolution = resolveWorkspace(task, agent, companyId);
    const workspace = workspaceResolution.workspace;
    logger.info(
      `[heartbeat] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, projectId=${task.projectId ?? "null"}, source=${workspaceResolution.source}, mode=${workspaceResolution.lockMode}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
    );

    const run = db.createRun({
      id: runId,
      companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });

    const companyBasic = db.getCompanyBasic(companyId);
    dispatchRunToWorker({
      runId: run.id,
      companyId,
      agent,
      task,
      connector,
      workspace,
      workspaceMode: workspaceResolution.lockMode,
      companyName: companyBasic?.name ?? "Unknown",
      companyDescription: companyBasic?.description ?? "",
      snapshot: db.listSnapshot(),
      trigger,
    });

    db.markHeartbeatAt(agentId);
    db.addActivity({
      companyId,
      actor: "system",
      action: "heartbeat.triggered",
      entityType: "agent",
      entityId: agent.id,
      detail: `${trigger} heartbeat for ${agent.name}`,
    });
    emitEvent({ type: "run-updated", runId: run.id, action: "created" });
    return run.id;
  }

  function wakeAgentIfPossible(agentId: string | null | undefined, companyId: string, trigger: string) {
    if (!agentId || isQuitting()) return null;
    try {
      const agent = db.getAgent(agentId);
      if (agent.companyId !== companyId) {
        logger.warn(`[wake] Refusing cross-company wake for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
        return null;
      }
    } catch {
      return null;
    }
    try {
      ensureAgentHeartbeatEnabled(agentId);
    } catch {
      return null;
    }

    const agentBusy = hasActiveRun({ agentId, companyId });
    if (agentBusy) {
      // Agent is busy — enqueue wakeup with lifecycle tracking (D-05)
      db.enqueueWakeupRequest(companyId, agentId, trigger, `Wake for agent: ${trigger}`);
      return null;
    }

    const runId = startAgentHeartbeatRun(agentId, companyId, trigger);
    if (!runId) {
      // Run failed to start but agent not busy — still enqueue for retry
      db.enqueueWakeupRequest(companyId, agentId, trigger, `Wake for agent (deferred): ${trigger}`);
    }
    return runId;
  }

  function queueTaskRun(taskId: string, trigger: string, actor: string) {
    if (isQuitting()) {
      return fail("APP_SHUTTING_DOWN", "Application is shutting down.");
    }
    if (!hasWorkerReady()) {
      logger.warn(`[run] Worker not ready — cannot queue run for task ${taskId} (trigger: ${trigger})`);
      return fail("WORKER_UNAVAILABLE", "Orchestration worker is not ready.");
    }
    const task = db.getTask(taskId);
    const companyStatus = db.getCompanyStatus(task.companyId);
    if (companyStatus !== "active") {
      return fail("COMPANY_NOT_ACTIVE", "Runs can only start while the company is active.");
    }
    if (!task.assigneeAgentId) return fail("TASK_UNASSIGNED", "Assign an agent before starting a run.");
    const agent = db.getAgent(task.assigneeAgentId);
    if (agent.companyId !== task.companyId) {
      return fail("AGENT_COMPANY_MISMATCH", "The assigned agent does not belong to the task company.");
    }
    const connector = db.getConnector(agent.connectorId);
    const eligibilityFailure = getRunEligibilityFailure(agent, connector, task.projectId ?? null);
    if (eligibilityFailure === "AGENT_NOT_RUNNABLE") {
      return fail("AGENT_NOT_RUNNABLE", "The assigned agent is paused, pending approval, or terminated.");
    }
    if (eligibilityFailure === "BUDGET_POLICY_BLOCKED") {
      return fail("BUDGET_POLICY_BLOCKED", "A budget policy blocks this run. Review budget settings.");
    }
    if (eligibilityFailure === "CONNECTOR_NOT_READY") {
      return fail("CONNECTOR_NOT_READY", "The assigned agent connector is not ready.");
    }
    if (hasActiveRun({ agentId: agent.id, companyId: task.companyId })) {
      return fail("AGENT_ALREADY_RUNNING", "The assigned agent already has an active run.");
    }
    if (db.isAgentPendingApproval(agent.id)) {
      return fail("AGENT_PENDING_APPROVAL", "This agent is pending hire approval and cannot run tasks.");
    }
    const blockingApproval = db.getBlockingApproval(task.companyId, agent.id, task.id);
    if (blockingApproval) {
      return fail(
        "APPROVAL_GATE_BLOCKED",
        `Run blocked by pending approval: ${blockingApproval.type} — "${blockingApproval.payloadSummary}". Approve or reject before starting.`,
      );
    }

    // CAS checkout — atomic claim (EXEC-01, EXEC-02)
    const runId = randomUUID();
    const checkoutSuccess = db.checkoutTask(task.id, runId);
    if (!checkoutSuccess) {
      return fail("CHECKOUT_RACE_LOST", "Another run claimed this task. Refresh and try again.");
    }

    const workspaceResolution = resolveWorkspace(task, agent, task.companyId);
    const workspace = workspaceResolution.workspace;
    if (workspace && workspace.companyId !== task.companyId) {
      return fail("WORKSPACE_COMPANY_MISMATCH", "The selected workspace does not belong to the task company.");
    }

    const run = db.createRun({
      id: runId,
      companyId: task.companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });

    const companyBasic = db.getCompanyBasic(task.companyId);
    dispatchRunToWorker({
      runId: run.id,
      companyId: task.companyId,
      agent,
      task,
      connector,
      workspace,
      workspaceMode: workspaceResolution.lockMode,
      companyName: companyBasic?.name ?? "Unknown",
      companyDescription: companyBasic?.description ?? "",
      snapshot: db.listSnapshot(),
      trigger,
    });
    db.addActivity({
      companyId: task.companyId,
      actor,
      action: "run.queued",
      entityType: "run",
      entityId: run.id,
      detail: task.title,
    });
    emitEvent({ type: "run-updated", runId: run.id, action: "created" });
    return ok(run.id);
  }

  function resumeQueuedRuns() {
    // D-02: Stale lock recovery at app startup (EXEC-03)
    try {
      const recovered = db.recoverStaleLocks();
      for (const task of recovered) {
        db.addActivity({
          companyId: task.companyId,
          actor: "system",
          action: "execution.lock_recovered",
          entityType: "task",
          entityId: task.taskId,
          detail: `Recovered stale lock on task "${task.title}" after 15min timeout (startup sweep)`,
        });
        logger.info(`[init] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
      }
      if (recovered.length > 0) {
        logger.info(`[init] Recovered ${recovered.length} stale lock(s) at startup`);
      }
    } catch (err) {
      logger.error(`[init] Stale lock recovery at startup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (isQuitting() || !hasWorkerReady()) {
      return;
    }
    const snapshot = db.listSnapshot();
    const companiesById = new Map(snapshot.companies.map((company) => [company.id, company]));

    for (const run of db.listQueuedRuns()) {
      const company = companiesById.get(run.companyId);
      if (!company || company.status !== "active") {
        continue;
      }

      const hasBlockingSiblingRun = snapshot.runs.some((entry) =>
        entry.id !== run.id &&
        entry.companyId === run.companyId &&
        ["queued", "running"].includes(entry.status) &&
        (entry.taskId === run.taskId || entry.agentId === run.agentId),
      );
      if (hasBlockingSiblingRun) {
        continue;
      }

      try {
        const task = db.getTask(run.taskId);
        const agent = db.getAgent(run.agentId);
        const connector = db.getConnector(run.connectorId);
        if (getRunEligibilityFailure(agent, connector, task.projectId ?? null)) {
          continue;
        }
        const workspaceResolution = resolveWorkspace(task, agent, run.companyId);
        dispatchRunToWorker({
          runId: run.id,
          companyId: run.companyId,
          agent,
          task,
          connector,
          workspace: workspaceResolution.workspace,
          workspaceMode: workspaceResolution.lockMode,
          companyName: company.name,
          companyDescription: company.description,
          snapshot,
          trigger: "recovery",
        });
      } catch (error) {
        logger.warn(`[run] Skipped queued run recovery for ${run.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  function startHeartbeatScheduler() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(() => {
      try {
        if (isQuitting() || !hasWorkerReady()) return;

        // D-02: Stale lock recovery piggybacked on heartbeat cycle (EXEC-03)
        try {
          const recovered = db.recoverStaleLocks();
          for (const task of recovered) {
            // D-04: Activity log entry only
            db.addActivity({
              companyId: task.companyId,
              actor: "system",
              action: "execution.lock_recovered",
              entityType: "task",
              entityId: task.taskId,
              detail: `Recovered stale lock on task "${task.title}" after 15min timeout`,
            });
            logger.info(`[heartbeat] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
          }
        } catch (err) {
          logger.error(`[heartbeat] Stale lock recovery failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        const activeCompanies = db.listActiveCompanyIds();
        const now = Date.now();

        for (const company of activeCompanies) {
          try {
            const eligibleAgents = db.listHeartbeatEligibleAgents(company.id);
            for (const agent of eligibleAgents) {
              if (hasActiveRun({ agentId: agent.id, companyId: company.id })) continue;

              const lastHeartbeat = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
              const intervalMs = agent.heartbeatIntervalSec * 1000;
              if (now - lastHeartbeat < intervalMs) continue;

              logger.info(`[heartbeat] Waking agent ${agent.name} (interval: ${agent.heartbeatIntervalSec}s)`);
              startAgentHeartbeatRun(agent.id, company.id, "timer");
            }

            const goalCount = db.countActiveGoalsForCompany(company.id);
            const taskCount = db.countActiveTasksForCompany(company.id);
            if (goalCount > 0 && taskCount === 0) {
              const ceo = db.getCeoForCompany(company.id);
              const ceoLastWake = ceo?.lastHeartbeatAt ? new Date(ceo.lastHeartbeatAt).getTime() : 0;
              const bootstrapCooldown = 120_000;
              if (ceo && !hasActiveRun({ agentId: ceo.id, companyId: company.id }) && (now - ceoLastWake > bootstrapCooldown)) {
                logger.info(`[heartbeat] Company ${company.name} has ${goalCount} goals but no tasks — bootstrapping CEO ${ceo.name}`);
                startAgentHeartbeatRun(ceo.id, company.id, "bootstrap");
              }
            }

            const scheduleKey = `schedule-${company.id}`;
            const lastScheduleFired = scheduleLastFiredMap.get(scheduleKey) ?? 0;
            if (now - lastScheduleFired >= 60_000) {
              dispatchAutomation("schedule", { companyId: company.id });
              scheduleLastFiredMap.set(scheduleKey, now);
            }

            const companyAgents = db.listActiveAgentsForCompany(company.id);
            for (const agent of companyAgents) {
              if (!db.hasAgentAssignedTasks(agent.id, company.id)) {
                const lastActive = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : 0;
                const idleThreshold = 20 * 60 * 1000;
                if (now - lastActive > idleThreshold) {
                  dispatchAutomation("agent_idle", {
                    companyId: company.id,
                    agentId: agent.id,
                    department: agent.department ?? undefined,
                  });
                }
              }
            }

            const currentMonth = new Date().toISOString().slice(0, 7);
            const lastResetMonth = db.getLastBudgetResetMonth(company.id) ?? "";
            if (currentMonth !== lastResetMonth) {
              db.resetMonthlyBudgets(company.id);
              db.setLastBudgetResetMonth(company.id, currentMonth);
              logger.info(`[heartbeat] Reset monthly budgets for company ${company.name} (${currentMonth})`);
            }

            // D-06: Auto-close incidents from previous budget windows
            const closedIncidents = budgetService.autoCloseExpiredIncidents(company.id);
            if (closedIncidents > 0) {
              logger.info(`[heartbeat] Auto-closed ${closedIncidents} expired budget incident(s) for company ${company.name}`);
            }

            // TASK-04: Stale review escalation sweep
            try {
              const escalated = sweepStaleReviews(company.id, {
                db: db as unknown as import("./task-quality-gates").SweepStaleReviewsDeps["db"],
                dispatchAgentMessage: dispatchAgentMessage as unknown as import("./task-quality-gates").SweepStaleReviewsDeps["dispatchAgentMessage"],
                resolveApprovalDecision: resolveApprovalDecision as unknown as import("./task-quality-gates").SweepStaleReviewsDeps["resolveApprovalDecision"],
                notify: notify as unknown as import("./task-quality-gates").SweepStaleReviewsDeps["notify"],
                handleTaskStatusChange: (_taskId: string, _companyId: string, _prev: string, _next: string) => {
                  publishDomainChanged();
                },
                handleApprovalResolved: (_approvalId: string, _companyId: string, _decision: string) => {
                  publishDomainChanged();
                },
                emitEvent: (..._args: unknown[]) => {},
                publishDomainChanged,
                wakeAgentIfPossible: (agentId: string, cId: string, trigger: string) => {
                  wakeAgentIfPossible(agentId, cId, trigger);
                },
                logger,
              });
              if (escalated > 0) {
                logger.info(`[heartbeat] Auto-escalated ${escalated} stale review(s) for company ${company.name}`);
                publishDomainChanged();
              }
            } catch (error) {
              logger.error(`[heartbeat] Stale review sweep failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          } catch (error) {
            logger.error(`[heartbeat] Error processing company ${company.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const staleReleased = db.releaseStaleWorkspaceLocks();
          if (staleReleased > 0) {
            logger.info(`[heartbeat] Released ${staleReleased} stale workspace lock(s)`);
            publishDomainChanged();
          }
          const staleWakeups = db.purgeExpiredWakeupRequests();
          if (staleWakeups > 0) {
            logger.info(`[heartbeat] Purged ${staleWakeups} expired wakeup request(s)`);
          }
        } catch (error) {
          logger.error(`[heartbeat] Stale lock cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        logger.error(`[heartbeat] Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 15_000);
  }

  function stopHeartbeatScheduler() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return {
    resolveWorkspace,
    autoPauseBudgetExceededAgent,
    wakeAgentIfPossible,
    dispatchRunToWorker,
    queueTaskRun,
    resumeQueuedRuns,
    startAgentHeartbeatRun,
    startHeartbeatScheduler,
    stopHeartbeatScheduler,
  };
}
