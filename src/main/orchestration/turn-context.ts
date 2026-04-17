/**
 * Turn Context Assembly
 *
 * Extracts the run payload assembly logic from dispatchRunToWorker into
 * a single composable function. Each step (env, comments, session, skills,
 * prompt) is an isolated helper, making the pipeline testable and extensible.
 */

import { buildTaskPrompt } from "../prompt-builder";
import type { AppDatabase } from "../database";
import type { ProjectedSkill } from "../skill-types";
import type { ConnectorId, ExecutionMode } from "@shared/types";
import type { WorkspaceLockMode, EnqueueRunPayload } from "./types";
import { normalizeCommentsForPrompt } from "../message-normalize";
import { getConnectorModelPolicy, validateConnectorModelSelection } from "../connector-model-policy";

export interface RunDispatchParams {
  runId: string;
  companyId: string;
  agent: ReturnType<AppDatabase["getAgent"]>;
  // `task` is null for heartbeat runs (agent wake-ups with no assigned task).
  // Downstream code (prompt builder, worker payload, session pointer)
  // branches on this — when null, skip task-scoped state.
  task: ReturnType<AppDatabase["getTask"]> | null;
  connector: ReturnType<AppDatabase["getConnector"]>;
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  workspaceMode: WorkspaceLockMode;
  companyName: string;
  companyDescription: string;
  snapshot: ReturnType<AppDatabase["listSnapshot"]>;
  trigger: string;
}

export interface TurnContextDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  getApiPort: () => number;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  listRuntimeSkillEntries: (companyId: string, agentId: string, connectorId: string) => ProjectedSkill[];
  getSessionHandoff?: (taskId: string) => string | null;
  evaluatePreRunSessionRotation?: (taskId: string, connectorId: string) => {
    rotated: boolean;
    handoff: string | null;
  };
}

function assembleApiEnv(
  db: AppDatabase,
  connector: RunDispatchParams["connector"],
  companyId: string,
  agentId: string,
  runId: string,
  trigger: string,
  deps: Pick<TurnContextDeps, "getApiPort" | "createRunToken">,
) {
  const env = db.resolveSecretEnv(connector.envBindingText, companyId);
  const apiPort = deps.getApiPort();
  const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
  const apiKey = apiUrl ? deps.createRunToken(agentId, companyId, runId) : "";

  if (apiUrl) {
    env.AGENT_COMPANY_API_URL = apiUrl;
    env.AGENT_COMPANY_API_KEY = apiKey;
    env.AGENT_COMPANY_AGENT_ID = agentId;
    env.AGENT_COMPANY_COMPANY_ID = companyId;
    env.AGENT_COMPANY_RUN_ID = runId;
    env.AGENT_COMPANY_TASK_ID = "";
    env.AGENT_COMPANY_WAKE_REASON = trigger;
  }
  return { env, apiUrl, apiKey };
}

function assembleRecentComments(
  assignedTasks: ReturnType<AppDatabase["listAgentTasks"]>,
  reviewTasks: ReturnType<AppDatabase["listAgentTasks"]>,
  snapshot: RunDispatchParams["snapshot"],
) {
  const relevantTaskIds = new Set([
    ...assignedTasks.map((t) => t.id),
    ...reviewTasks.map((t) => t.id),
  ]);
  const allRelevantTasks = [...assignedTasks, ...reviewTasks];
  return snapshot.comments
    .filter((comment) => relevantTaskIds.has(comment.taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((comment) => ({
      taskId: comment.taskId,
      taskTitle: allRelevantTasks.find((t) => t.id === comment.taskId)?.title ?? comment.taskId,
      authorName: comment.authorName,
      body: comment.body,
      createdAt: comment.createdAt,
    }));
}

function resolveSessionHandoff(
  taskId: string,
  deps: Pick<TurnContextDeps, "getSessionHandoff" | "logger">,
): string | null {
  if (!deps.getSessionHandoff) return null;
  try {
    return deps.getSessionHandoff(taskId);
  } catch (err) {
    deps.logger.warn(`[run] Failed to load session handoff for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function resolveSkills(
  companyId: string,
  agentId: string,
  connectorId: string,
  agentName: string,
  deps: Pick<TurnContextDeps, "listRuntimeSkillEntries" | "logger">,
): ProjectedSkill[] {
  try {
    return deps.listRuntimeSkillEntries(companyId, agentId, connectorId);
  } catch (err) {
    deps.logger.warn(`[run] Failed to fetch managed skills for agent ${agentName}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function resolveEnabledConnectorModels(
  db: AppDatabase,
  connector: { id: string; model: string | null },
): string[] {
  return getConnectorModelPolicy(db, connector.id as ConnectorId).enabledModels.map((model) => model.id);
}

function resolveSession(
  db: AppDatabase,
  agent: RunDispatchParams["agent"],
  task: RunDispatchParams["task"],
  companyId: string,
  connectorId: string,
  sessionHandoff: string | null,
  deps: Pick<TurnContextDeps, "evaluatePreRunSessionRotation" | "logger">,
) {
  // Per-agent session: one ongoing transcript per agent; switching tasks
  // becomes a "now work on X" user turn rather than a fresh session.
  const agentSessionId = db.ensureAgentSession({
    agentId: agent.id,
    companyId,
    adapterType: connectorId,
  });
  // Mirror the agent's active session onto the task pointer so UI paths
  // that read per-task active_session_id keep working.
  db.updateTasksActiveSessionForAgent(agent.id, agentSessionId);

  // Heartbeat runs have no task; reuse the agent-scoped session with no
  // task-specific active session lookup.
  if (!task) {
    return {
      taskSession: { id: agentSessionId, sessionParams: null, sessionDisplayId: null },
      sessionHandoff,
    };
  }

  const activeSession = db.getActiveTaskSession(task.id);
  let taskSession: {
    id: string | null;
    sessionParams: Record<string, unknown> | null;
    sessionDisplayId: string | null;
  } = activeSession
    ? {
        id: activeSession.id,
        sessionParams: activeSession.sessionParamsJson
          ? (JSON.parse(activeSession.sessionParamsJson) as Record<string, unknown>)
          : null,
        sessionDisplayId: activeSession.sessionDisplayId,
      }
    : { id: agentSessionId, sessionParams: null, sessionDisplayId: null };

  let finalHandoff = sessionHandoff;
  if (deps.evaluatePreRunSessionRotation && activeSession) {
    const rotationResult = deps.evaluatePreRunSessionRotation(task.id, connectorId);
    if (rotationResult.rotated) {
      taskSession = { id: null, sessionParams: null, sessionDisplayId: null };
      if (!finalHandoff && rotationResult.handoff) {
        finalHandoff = rotationResult.handoff;
      }
      deps.logger.info(`[session] Pre-run compaction for agent ${agent.id}: session rotated before execution`);
    }
  }

  return { taskSession, sessionHandoff: finalHandoff };
}

function extractThinkingEffort(
  metadataJson: string | null,
  logger: TurnContextDeps["logger"],
  agentId: string,
): string | null {
  try {
    const meta = JSON.parse(metadataJson || "{}");
    if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
      return meta.thinkingEffort;
    }
  } catch (error) {
    logger.warn(
      `[run] malformed agent metadataJson for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return null;
}

function filterUpcomingMeetings(
  meetings: RunDispatchParams["snapshot"]["meetings"],
  companyId: string,
  agentId: string,
) {
  return meetings
    .filter((meeting) => meeting.companyId === companyId && (meeting.status === "scheduled" || meeting.status === "in_progress"))
    .filter((meeting) => {
      try {
        const ids: string[] = JSON.parse(meeting.participantAgentIds);
        return ids.includes(agentId) || meeting.organizerAgentId === agentId;
      } catch {
        return false;
      }
    })
    .slice(0, 5);
}

function filterRelevantKnowledge(
  knowledge: RunDispatchParams["snapshot"]["knowledgeBase"],
  companyId: string,
) {
  return knowledge
    .filter((entry) => entry.companyId === companyId && (entry.importance === "critical" || entry.importance === "high"))
    .slice(0, 20);
}

function filterRecentDocuments(
  documents: RunDispatchParams["snapshot"]["documents"],
  companyId: string,
  agentId: string,
) {
  return documents
    .filter((document) => document.companyId === companyId && (document.authorAgentId === agentId || document.reviewerAgentId === agentId || document.status === "in_review"))
    .slice(0, 5);
}

function filterPendingApprovals(
  approvals: RunDispatchParams["snapshot"]["approvals"],
  companyId: string,
  agentId: string,
) {
  return approvals.filter(
    (approval) => approval.companyId === companyId &&
      approval.requestedByAgentId === agentId &&
      (approval.state === "pending" || approval.state === "revision_requested"),
  );
}

function buildConnectorCatalog(
  db: AppDatabase,
  connectors: RunDispatchParams["snapshot"]["connectors"],
) {
  return connectors
    .filter((c) => c.status === "ready")
    .filter((c) => db.hasModelPoolSettings(c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      enabledModels: resolveEnabledConnectorModels(db, c),
    }))
    .filter((c) => c.enabledModels.length > 0);
}

/**
 * Assemble the full run payload from resolved entities and dependencies.
 * This is the core composition step that was previously inlined in dispatchRunToWorker.
 */
export function buildRunPayload(params: RunDispatchParams, deps: TurnContextDeps): EnqueueRunPayload {
  const { runId, companyId, agent, task, connector, workspace, workspaceMode, companyName, companyDescription, snapshot, trigger } = params;
  const { db } = deps;

  const { env, apiUrl, apiKey } = assembleApiEnv(db, connector, companyId, agent.id, runId, trigger, deps);
  env.AGENT_COMPANY_TASK_ID = task?.id ?? "";

  const assignedTasks = db.listAgentTasks(agent.id, companyId, ["todo", "in_progress", "blocked"]);
  const reviewTasks = db.listReviewTasksForManager(agent.id, companyId);
  const recentComments = assembleRecentComments(assignedTasks, reviewTasks, snapshot);
  const initialHandoff = task ? resolveSessionHandoff(task.id, deps) : null;
  const { taskSession, sessionHandoff } = resolveSession(db, agent, task, companyId, connector.id, initialHandoff, deps);
  const skills = resolveSkills(companyId, agent.id, connector.id, agent.name, deps);

  const systemPrompt = apiUrl ? buildTaskPrompt({
    agent,
    apiUrl,
    apiKey,
    runId,
    task,
    companyName,
    locale: snapshot.locale,
    executionMode: db.getCompanyExecutionMode(companyId) as ExecutionMode,
    goals: snapshot.goals.filter((goal) => goal.companyId === companyId),
    projects: snapshot.projects.filter((project) => project.companyId === companyId),
    directReports: db.getDirectReports(agent.id, companyId),
    chainOfCommand: db.getChainOfCommand(agent.id),
    assignedTasks,
    allAgents: snapshot.agents.filter((entry) => entry.companyId === companyId),
    pendingApprovals: filterPendingApprovals(snapshot.approvals, companyId, agent.id),
    tasksAwaitingReview: reviewTasks,
    wakeReason: trigger,
    allTasks: snapshot.tasks.filter((entry) => entry.companyId === companyId),
    recentComments: normalizeCommentsForPrompt(recentComments),
    companyDescription,
    socialAccounts: db.listSocialAccounts(companyId).map((account) => ({
      id: account.id,
      platform: account.platform,
      accountName: account.accountName,
      status: account.status,
      requireApproval: account.requireApproval,
    })),
    upcomingMeetings: filterUpcomingMeetings(snapshot.meetings, companyId, agent.id),
    relevantKnowledge: filterRelevantKnowledge(snapshot.knowledgeBase, companyId),
    activeSprint: snapshot.sprints.find((sprint) => sprint.companyId === companyId && sprint.status === "active") ?? null,
    recentDocuments: filterRecentDocuments(snapshot.documents, companyId, agent.id),
    allConnectors: buildConnectorCatalog(db, snapshot.connectors),
    sessionHandoff,
    skills,
    companySkillCatalog: db.listCompanySkills(companyId).map((skill) => ({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
    })),
    companyWorkspaces: snapshot.workspaces
      .filter((workspace) => workspace.companyId === companyId)
      .map((workspace) => ({ name: workspace.name, localPath: workspace.localPath })),
    companyDocuments: snapshot.documents.filter((d) => d.companyId === companyId),
  }) : null;

  const thinkingEffort = extractThinkingEffort(agent.metadataJson, deps.logger, agent.id);
  const modelSelection = validateConnectorModelSelection(db, connector.id, agent.model);
  if (!modelSelection.ok) {
    throw new Error(modelSelection.error);
  }

  return {
    runId,
    companyId,
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? "",
    taskDescription: task?.description ?? "",
    agentId: agent.id,
    agentName: agent.name,
    connectorId: connector.id,
    workspaceId: workspaceMode === "exclusive" ? (workspace?.id ?? null) : null,
    workspacePath: workspace?.localPath ?? null,
    workspaceMode,
    command: connector.command,
    model: modelSelection.effectiveModel,
    thinkingEffort,
    env,
    sessionParams: taskSession.sessionParams,
    systemPrompt,
    trigger,
    taskSessionId: taskSession.id ?? runId,
    executionMode: db.getCompanyExecutionMode(companyId) as "ai_ceo" | "ai_cofounder",
  };
}
