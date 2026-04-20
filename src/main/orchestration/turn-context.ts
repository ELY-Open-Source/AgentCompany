/**
 * Turn Context Assembly
 *
 * Extracts the run payload assembly logic from dispatchRunToWorker into
 * a single composable function. Each step (env, comments, session, skills,
 * prompt) is an isolated helper, making the pipeline testable and extensible.
 */

import { buildTaskPrompt } from "../prompt-builder/index";
import type { AppDatabase } from "../database";
import type { ProjectedSkill } from "../skill-types";
import type { ConnectorId, ExecutionMode } from "@shared/types";
import type { WorkspaceLockMode, EnqueueRunPayload } from "./types";
import { normalizeCommentsForPrompt } from "../messaging/normalize";
import { getConnectorModelPolicy, validateConnectorModelSelection } from "../connector-model-policy";
import { resolveInitialUserTurn } from "./initial-user-turn";
import { resolveInternalToolsForAgent } from "./internal-tool-selector";
import { logAppError } from "../errors/index.js";

export interface RunDispatchParams {
  runId: string;
  companyId: string;
  agent: ReturnType<AppDatabase["entityCrud"]["getAgent"]>;
  // `task` is null for heartbeat runs (agent wake-ups with no assigned task).
  // Downstream code (prompt builder, worker payload, session pointer)
  // branches on this — when null, skip task-scoped state.
  task: ReturnType<AppDatabase["entityCrud"]["getTask"]> | null;
  connector: ReturnType<AppDatabase["connectorsCrud"]["getConnector"]>;
  workspace: ReturnType<AppDatabase["workspacesMod"]["getWorkspace"]>;
  workspaceMode: WorkspaceLockMode;
  companyName: string;
  companyDescription: string;
  snapshot: ReturnType<AppDatabase["snap"]["listSnapshot"]>;
  trigger: string;
  /**
   * Model id resolved by `pickModelForAgent` at dispatch time. When the
   * agent runs under `modelStrategy = "auto"` this differs from
   * `agent.model` (the column now becomes a legacy fallback). Optional so
   * explicit-strategy callers and legacy tests keep working; when absent
   * we read `agent.model` verbatim.
   */
  resolvedModel?: string | null;
}

export interface TurnContextDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  getApiPort: () => number;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  listRuntimeSkillEntries: (companyId: string, agentId: string, connectorId: string) => ProjectedSkill[];
  getSessionHandoff?: (agentId: string) => string | null;
  evaluatePreRunSessionRotation?: (agentId: string, connectorId: string) => {
    rotated: boolean;
    handoff: string | null;
    sessionId: string | null;
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
  const env = db.entityCrud.resolveSecretEnv(connector.envBindingText, companyId);
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
  assignedTasks: ReturnType<AppDatabase["tasks"]["listAgentTasks"]>,
  reviewTasks: ReturnType<AppDatabase["tasks"]["listAgentTasks"]>,
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
  agentId: string,
  deps: Pick<TurnContextDeps, "getSessionHandoff" | "logger">,
): string | null {
  if (!deps.getSessionHandoff) return null;
  try {
    return deps.getSessionHandoff(agentId);
  } catch (err) {
    logAppError(deps.logger, err, {
      kind: "recoverable",
      code: "run.session_handoff.load_failed",
      message: `Failed to load session handoff for agent ${agentId}; continuing without handoff`,
      context: { agentId },
    }, "warn");
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
    logAppError(deps.logger, err, {
      kind: "recoverable",
      code: "run.skills.fetch_failed",
      message: `Failed to fetch managed skills for agent ${agentName}; proceeding with empty skill set`,
      context: { agentId, agentName, connectorId, companyId },
    }, "warn");
    return [];
  }
}

function resolveEnabledConnectorModels(
  db: AppDatabase,
  companyId: string,
  connector: { id: string; model: string | null },
): string[] {
  return getConnectorModelPolicy(
    {
      getConnector: (id) => db.connectorsCrud.getConnector(id),
      getDisabledModels: (cid, connId) => db.settings.getDisabledModels(cid, connId),
    },
    companyId,
    connector.id as ConnectorId,
  ).enabledModels.map((model) => model.id);
}

function resolveSession(
  db: AppDatabase,
  agent: RunDispatchParams["agent"],
  companyId: string,
  connectorId: string,
  sessionHandoff: string | null,
  deps: Pick<TurnContextDeps, "evaluatePreRunSessionRotation" | "logger">,
) {
  // Per-agent session: one ongoing transcript per agent; switching tasks
  // (or running taskless heartbeats) becomes a "now work on X" user turn
  // on the ongoing transcript rather than starting a fresh session.
  const agentSessionId = db.tasks.ensureAgentSession({
    agentId: agent.id,
    companyId,
    adapterType: connectorId,
  });

  // Evaluate rotation against the agent-scoped session unconditionally.
  // Heartbeat runs (no task) must rotate too, or their transcript grows
  // forever — the exact failure mode that burned through 7M token windows.
  let currentSessionId = agentSessionId;
  let finalHandoff = sessionHandoff;
  if (deps.evaluatePreRunSessionRotation) {
    const rotationResult = deps.evaluatePreRunSessionRotation(agent.id, connectorId);
    if (rotationResult.rotated) {
      currentSessionId = rotationResult.sessionId ?? agentSessionId;
      if (!finalHandoff && rotationResult.handoff) {
        finalHandoff = rotationResult.handoff;
      }
      deps.logger.info(`[session] Pre-run compaction for agent ${agent.id}: session rotated before execution`);
    }
  }

  return {
    taskSessionId: currentSessionId,
    sessionHandoff: finalHandoff,
  };
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
  companyId: string,
  connectors: RunDispatchParams["snapshot"]["connectors"],
) {
  return connectors
    .filter((c) => c.status === "ready")
    .filter((c) => db.settings.hasModelPoolSettings(companyId, c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      enabledModels: resolveEnabledConnectorModels(db, companyId, c),
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

  const assignedTasks = db.tasks.listAgentTasks(agent.id, companyId, ["todo", "in_progress", "blocked"]);
  const reviewTasks = db.tasks.listReviewTasksForManager(agent.id, companyId);
  const recentComments = assembleRecentComments(assignedTasks, reviewTasks, snapshot);
  const initialHandoff = resolveSessionHandoff(agent.id, deps);
  const { taskSessionId, sessionHandoff } = resolveSession(db, agent, companyId, connector.id, initialHandoff, deps);
  const skills = resolveSkills(companyId, agent.id, connector.id, agent.name, deps);

  const systemPrompt = apiUrl ? buildTaskPrompt({
    agent,
    apiUrl,
    apiKey,
    runId,
    task,
    companyName,
    locale: snapshot.locale,
    executionMode: db.company.getCompanyExecutionMode(companyId) as ExecutionMode,
    goals: snapshot.goals.filter((goal) => goal.companyId === companyId),
    projects: snapshot.projects.filter((project) => project.companyId === companyId),
    directReports: db.agents.getDirectReports(agent.id, companyId),
    chainOfCommand: db.agents.getChainOfCommand(agent.id),
    assignedTasks,
    allAgents: snapshot.agents.filter((entry) => entry.companyId === companyId),
    pendingApprovals: filterPendingApprovals(snapshot.approvals, companyId, agent.id),
    tasksAwaitingReview: reviewTasks,
    wakeReason: trigger,
    allTasks: snapshot.tasks.filter((entry) => entry.companyId === companyId),
    recentComments: normalizeCommentsForPrompt(recentComments),
    companyDescription,
    socialAccounts: db.social.listSocialAccounts(companyId).map((account) => ({
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
    allConnectors: buildConnectorCatalog(db, companyId, snapshot.connectors),
    sessionHandoff,
    skills,
    companySkillCatalog: db.skills.listCompanySkills(companyId).map((skill) => ({
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
  const modelForRun = params.resolvedModel !== undefined ? params.resolvedModel : agent.model;
  const modelSelection = validateConnectorModelSelection(
    {
      getConnector: (id) => db.connectorsCrud.getConnector(id),
      getDisabledModels: (cid, connId) => db.settings.getDisabledModels(cid, connId),
    },
    companyId,
    connector.id,
    modelForRun,
  );
  if (!modelSelection.ok) {
    throw new Error(modelSelection.error);
  }

  const initialUserTurn = resolveInitialUserTurn(
    { trigger, task, companyId, agentId: agent.id },
    { db },
  );

  const internalTools = resolveInternalToolsForAgent(db, agent);

  return {
    runId,
    companyId,
    taskId: task?.id ?? null,
    agentId: agent.id,
    agentName: agent.name,
    connectorId: connector.id,
    workspaceId: workspaceMode === "exclusive" ? (workspace?.id ?? null) : null,
    workspacePath: workspace?.localPath ?? null,
    workspaceMode,
    model: modelSelection.effectiveModel,
    thinkingEffort,
    env,
    systemPrompt,
    trigger,
    taskSessionId: taskSessionId ?? runId,
    executionMode: db.company.getCompanyExecutionMode(companyId) as "ai_ceo" | "ai_cofounder",
    initialUserTurn,
    internalTools,
  };
}
