import { useState } from "react";
import { NEW_ENTITY_ID } from "../../lib/constants";
import type { SectionId } from "@shared/types";
import {
  Kanban,
  ListChecks,
  Target,
} from "../../components/ui/icons";
import { ConnectorEditor } from "../../components/connectors";
import { KanbanBoard } from "../../components/dashboard/KanbanBoard";
import { TwoPaneLayout } from "../../components/TwoPaneLayout";
import { RunCenter } from "../../components/runs/RunCenter";
import { ActivityList } from "../../components/execution/ActivityList";
import { ApprovalInspector } from "../../components/execution/approval-inspector";
import { ApprovalList } from "../../components/execution/ApprovalList";
import { BudgetSummary } from "../../components/execution/BudgetSummary";
import { CostList } from "../../components/execution/CostList";
import { PendingReviewList } from "../../components/execution/PendingReviewList";
import { TaskCreator } from "../../components/execution/TaskCreator";
import { TaskInspector } from "../../components/execution/TaskInspector";
import { TaskQueue } from "../../components/execution/TaskQueue";
import { PolicyList } from "../../components/execution/PolicyList";
import { IncidentList } from "../../components/execution/IncidentList";
import { GoalCreator } from "../../components/organization/GoalCreator";
import { GoalEditor } from "../../components/organization/GoalEditor";
import { GoalList } from "../../components/organization/GoalList";
import { ActionButton, ListFrame, ListRow, Modal, Panel, StatusPill } from "../../components/ui";
import { unwrap } from "../../lib/desktop";
import { useAppStore } from "../../state/store";
import { useSectionContext } from "../../hooks/useSectionContext";
import { useAppActions } from "../../hooks/useAppActions";

interface ExecutionSectionsProps {
  section: SectionId;
}

// Policy: blocked tasks need an operator unblock via secret_access approval;
// everything else routes through CEO strategy review.
function buildTaskEscalation(task: {
  status: string;
  title: string;
}): {
  type: "secret_access" | "approve_ceo_strategy";
  payloadSummary: string;
  impactSummary: string;
} {
  if (task.status === "blocked") {
    return {
      type: "secret_access",
      payloadSummary: `Blocker: ${task.title} — needs operator assistance`,
      impactSummary: "Agent is blocked and needs operator input (credentials, access, or decision).",
    };
  }
  return {
    type: "approve_ceo_strategy",
    payloadSummary: `Review needed: ${task.title}`,
    impactSummary: "No automated reviewer available. Operator review required.",
  };
}

export function ExecutionSections({ section }: ExecutionSectionsProps) {
  const {
    snapshot,
    currentCompany,
    tasks,
    runs,
    pendingApprovals,
    companyAgents,
    companyGoals,
    companyProjects,
    companyWorkspaces,
    companyCosts,
    companyDocuments,
    filteredActivity,
    selectedTask,
    selectedConnector,
    selectedApproval,
    selectedGoal,
  } = useSectionContext();
  const { refresh, startRun, cancelRun, openPathWithFeedback } = useAppActions();

  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const setSelectedRunId = useAppStore((s) => s.setSelectedRunId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);
  const setSelectedApprovalId = useAppStore((s) => s.setSelectedApprovalId);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const setSelectedGoalId = useAppStore((s) => s.setSelectedGoalId);
  const taskViewMode = useAppStore((s) => s.taskViewMode);
  const setTaskViewMode = useAppStore((s) => s.setTaskViewMode);
  const setSection = useAppStore((s) => s.setSection);
  const setSelectedCommunicationEntityId = useAppStore((s) => s.setSelectedCommunicationEntityId);

  const [costsTab, setCostsTab] = useState<"costs" | "policies" | "incidents">("costs");

  if (!snapshot || !currentCompany) return null;

  return (
    <>
      {section === "runs" ? (
        <RunCenter
          runs={runs}
          tasks={tasks}
          agents={companyAgents}
          workspaces={companyWorkspaces}
          selectedRunId={selectedRunId}
          onSelectRun={(runId: string) => {
            setSelectedRunId(runId);
          }}
          onOpenLogPath={async (path: string) => {
            await openPathWithFeedback(path);
          }}
          onCancelRun={cancelRun}
        />
      ) : null}

      {section === "connectors" && selectedConnector ? (
        <div className="space-y-10">
          <Panel title="Connector registry">
            <ListFrame>
              {snapshot.connectors.map((connector) => (
                <ListRow
                  key={connector.id}
                  onClick={() => setSelectedConnectorId(connector.id)}
                  className={`cursor-pointer transition-colors duration-100 ${
                    selectedConnector.id === connector.id
                      ? "bg-accent"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-foreground">{connector.label}</div>
                      <div className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{connector.command}</div>
                    </div>
                    <StatusPill status={connector.status} />
                  </div>
                </ListRow>
              ))}
            </ListFrame>
          </Panel>
          <Panel title={selectedConnector.label}>
            <ConnectorEditor connector={selectedConnector} onSaved={refresh} />
          </Panel>
        </div>
      ) : null}

      {section === "tasks" ? (
        <>
          <Panel title="Goals" action={<ActionButton label="New goal" icon={Target} tone="accent" onClick={() => setSelectedGoalId(NEW_ENTITY_ID)} />}>
            <GoalList goals={companyGoals} agents={companyAgents} selectedGoalId={selectedGoalId} onSelect={setSelectedGoalId} />
          </Panel>
          <Modal open={selectedGoalId === NEW_ENTITY_ID && section === "tasks"} title="New goal" onClose={() => setSelectedGoalId(null)}>
            <GoalCreator companyId={currentCompany.id} agents={companyAgents} goals={companyGoals} onSaved={async () => { setSelectedGoalId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedGoal && section === "tasks"} title={selectedGoal ? `Edit: ${selectedGoal.title}` : ""} onClose={() => setSelectedGoalId(null)}>
            {selectedGoal ? (
              <GoalEditor
                key={selectedGoalId}
                goal={selectedGoal}
                goals={companyGoals}
                agents={companyAgents}
                companyId={currentCompany.id}
                onSaved={async () => { setSelectedGoalId(null); await refresh(); }}
                onDeleted={async () => { setSelectedGoalId(null); await refresh(); }}
              />
            ) : null}
          </Modal>

          <Panel
            title="Task queue"
            action={
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setTaskViewMode("list")}
                    className={`px-2.5 py-1.5 text-[11px] font-medium transition ${taskViewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <ListChecks size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskViewMode("kanban")}
                    className={`px-2.5 py-1.5 text-[11px] font-medium transition ${taskViewMode === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Kanban size={14} />
                  </button>
                </div>
                <ActionButton label="New task" icon={ListChecks} tone="accent" onClick={() => setSelectedTaskId(NEW_ENTITY_ID)} />
              </div>
            }
          >
            {taskViewMode === "kanban" ? (
              <KanbanBoard tasks={tasks} agents={companyAgents} runs={runs} onSelectTask={setSelectedTaskId} />
            ) : (
              <TaskQueue tasks={tasks} runs={runs} onSelect={setSelectedTaskId} selectedTaskId={selectedTask?.id ?? null} />
            )}
          </Panel>
          <Modal open={selectedTaskId === NEW_ENTITY_ID} title="New task" onClose={() => setSelectedTaskId(null)}>
            <TaskCreator companyId={currentCompany.id} goals={companyGoals} projects={companyProjects} agents={companyAgents} workspaces={companyWorkspaces} onSaved={async () => { setSelectedTaskId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedTask} title={selectedTask?.title ?? ""} onClose={() => setSelectedTaskId(null)} width="720px">
            {selectedTask ? (
              <TaskInspector
                task={selectedTask}
                tasks={tasks}
                runs={runs.filter((run) => run.taskId === selectedTask.id)}
                agents={companyAgents}
                goals={companyGoals}
                projects={companyProjects}
                workspaces={companyWorkspaces}
                companyId={currentCompany.id}
                comments={(snapshot.comments ?? []).filter((comment) => comment.taskId === selectedTask.id)}
                onRefresh={refresh}
                onRun={startRun}
                onCancelRun={cancelRun}
                onCreateApproval={async () => {
                  const escalation = buildTaskEscalation(selectedTask);
                  const approvalId = unwrap(await window.agentCompany.requestApproval({
                    companyId: currentCompany.id,
                    relatedTaskId: selectedTask.id,
                    requestedByAgentId: selectedTask.assigneeAgentId,
                    ...escalation,
                  }));
                  setSelectedApprovalId(approvalId);
                  await refresh();
                }}
                onOpenDiscussion={(taskId) => {
                  setSelectedTaskId(null);
                  setSection("communication");
                  setSelectedCommunicationEntityId(taskId);
                }}
                onDeleted={async () => { setSelectedTaskId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "approvals" ? (
        <>
          <Panel title="Agent reviews in progress">
            <PendingReviewList tasks={tasks} agents={companyAgents} />
          </Panel>
          <Panel title="Pending approvals">
            <ApprovalList approvals={pendingApprovals} selectedApprovalId={selectedApproval?.id ?? null} onSelect={setSelectedApprovalId} />
          </Panel>
          <Modal open={!!selectedApproval} title={selectedApproval?.payloadSummary ?? "Approval detail"} onClose={() => setSelectedApprovalId(null)}>
            {selectedApproval ? (
              <ApprovalInspector
                approval={selectedApproval}
                agents={companyAgents}
                tasks={tasks}
                documents={companyDocuments}
                companyId={currentCompany.id}
                onDecide={async (state, note) => {
                  unwrap(await window.agentCompany.decideApproval({ companyId: currentCompany.id, approvalId: selectedApproval.id, state, decisionNote: note ?? `${state} from desktop control surface.` }));
                  await refresh();
                }}
                onDeleted={async () => { setSelectedApprovalId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "costs" ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-1 border-b border-border px-4 pt-2">
            {(["costs", "policies", "incidents"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setCostsTab(tab)}
                className={`rounded-t px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  costsTab === tab
                    ? "border-b-2 border-[color:var(--primary)] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "costs" ? "Cost Entries" : tab === "policies" ? "Policies" : "Incidents"}
              </button>
            ))}
          </div>
          {costsTab === "costs" ? (
            <TwoPaneLayout
              title="Costs"
              eyebrow={undefined}
              primary={
                <Panel title="Recent cost entries">
                  <CostList costs={companyCosts} agents={companyAgents} runs={runs} />
                </Panel>
              }
              secondary={
                <Panel title="Budget posture">
                  <BudgetSummary agents={companyAgents} costs={companyCosts} companyId={currentCompany?.id} />
                </Panel>
              }
            />
          ) : costsTab === "policies" ? (
            <PolicyList
              companyId={currentCompany.id}
              agents={companyAgents.map((a) => ({ id: a.id, name: a.name }))}
              projects={companyProjects.map((p) => ({ id: p.id, name: p.name }))}
            />
          ) : (
            <IncidentList
              companyId={currentCompany.id}
              agents={companyAgents.map((a) => ({ id: a.id, name: a.name }))}
              projects={companyProjects.map((p) => ({ id: p.id, name: p.name }))}
            />
          )}
        </div>
      ) : null}

      {section === "activity" ? (
        <Panel title="Activity timeline">
          <ActivityList activity={filteredActivity} />
        </Panel>
      ) : null}
    </>
  );
}
