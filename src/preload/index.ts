import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type DesktopApi,
} from "@shared/contracts";
import type { DesktopEvent } from "@shared/types";

const api: DesktopApi = {
  loadSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.loadSnapshot),
  pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickDirectory),
  openPath: (targetPath) => ipcRenderer.invoke(IPC_CHANNELS.openPath, targetPath),
  saveCompany: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveCompany, input),
  setCurrentCompany: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.setCurrentCompany, companyId),
  saveConnector: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveConnector, input),
  testConnector: (id) => ipcRenderer.invoke(IPC_CHANNELS.testConnector, id),
  saveWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveWorkspace, input),
  saveAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveAgent, input),
  requestHire: (input) => ipcRenderer.invoke(IPC_CHANNELS.requestHire, input),
  saveGoal: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveGoal, input),
  saveProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, input),
  saveTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveTask, input),
  requestApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.requestApproval, input),
  decideApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.decideApproval, input),
  saveSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSecret, input),
  startTaskRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.startTaskRun, input),
  cancelRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.cancelRun, input),
  getRunLog: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRunLog, input),
  getRunLogChunk: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRunLogChunk, input),
  backupProfile: () => ipcRenderer.invoke(IPC_CHANNELS.backupProfile),
  restoreProfile: () => ipcRenderer.invoke(IPC_CHANNELS.restoreProfile),
  updateSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, input),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  deleteCompany: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.deleteCompany, companyId),
  deleteAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteAgent, input),
  deleteTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteTask, input),
  deleteGoal: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteGoal, input),
  deleteProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteProject, input),
  deleteWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspace, input),
  deleteApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteApproval, input),
  deleteSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteSecret, input),
  getSidebarBadges: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getSidebarBadges, companyId),
  listConnectorModels: (connectorId) => ipcRenderer.invoke(IPC_CHANNELS.listConnectorModels, connectorId),
  getConnectorDisabledModels: (connectorId) => ipcRenderer.invoke(IPC_CHANNELS.getConnectorDisabledModels, connectorId),
  setConnectorDisabledModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.setConnectorDisabledModels, input),
  openConnectorAuthTerminal: (connectorId) => ipcRenderer.invoke(IPC_CHANNELS.openConnectorAuthTerminal, connectorId),
  addComment: (input) => ipcRenderer.invoke(IPC_CHANNELS.addComment, input),
  listComments: (input) => ipcRenderer.invoke(IPC_CHANNELS.listComments, input),
  setHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.setHeartbeat, input),
  triggerHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.triggerHeartbeat, input),
  getApiPort: () => ipcRenderer.invoke(IPC_CHANNELS.getApiPort),
  getInbox: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getInbox, companyId),
  getCompanyMetrics: (input) => ipcRenderer.invoke(IPC_CHANNELS.getCompanyMetrics, input),
  getAgentMetrics: (input) => ipcRenderer.invoke(IPC_CHANNELS.getAgentMetrics, input),
  getStandupReport: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getStandupReport, companyId),
  bootstrapOnboarding: (input) => ipcRenderer.invoke(IPC_CHANNELS.bootstrapOnboarding, input),
  checkNodeInstalled: () => ipcRenderer.invoke(IPC_CHANNELS.checkNodeInstalled),
  openTerminalCommand: (input) => ipcRenderer.invoke(IPC_CHANNELS.openTerminalCommand, input),
  saveSocialAccount: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSocialAccount, input),
  deleteSocialAccount: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteSocialAccount, input),
  listBrowserActions: (input) => ipcRenderer.invoke(IPC_CHANNELS.listBrowserActions, input),
  cancelBrowserAction: (input) => ipcRenderer.invoke(IPC_CHANNELS.cancelBrowserAction, input),
  triggerBrowserLogin: (input) => ipcRenderer.invoke(IPC_CHANNELS.triggerBrowserLogin, input),
  saveMeeting: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveMeeting, input),
  deleteMeeting: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteMeeting, input),
  saveDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveDocument, input),
  deleteDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteDocument, input),
  saveKnowledgeEntry: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveKnowledgeEntry, input),
  deleteKnowledgeEntry: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteKnowledgeEntry, input),
  saveSprint: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSprint, input),
  deleteSprint: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteSprint, input),
  saveAutomationRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveAutomationRule, input),
  deleteAutomationRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteAutomationRule, input),
  toggleAutomationRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.toggleAutomationRule, input),
  getAutomationLog: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getAutomationLog, companyId),
  sendAgentMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.sendAgentMessage, input),
  listAgentMessages: (input) => ipcRenderer.invoke(IPC_CHANNELS.listAgentMessages, input),
  searchMessages: (input) => ipcRenderer.invoke(IPC_CHANNELS.searchMessages, input),
  markMessageRead: (input) => ipcRenderer.invoke(IPC_CHANNELS.markMessageRead, input),
  saveWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveWorkflow, input),
  deleteWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkflow, input),
  runWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkflow, input),
  autoAssignTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.autoAssignTask, input),
  importSkill: (companyId, source) =>
    ipcRenderer.invoke(IPC_CHANNELS.importSkill, { companyId, source }),
  listSkills: (companyId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listSkills, { companyId }),
  getSkillDetail: (companyId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getSkillDetail, { companyId, skillId }),
  deleteSkill: (companyId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSkill, { companyId, skillId }),
  assignSkillToAgent: (companyId, agentId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.assignSkillToAgent, { companyId, agentId, skillId }),
  removeSkillFromAgent: (companyId, agentId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeSkillFromAgent, { companyId, agentId, skillId }),
  checkSkillUpdate: (companyId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkSkillUpdate, { companyId, skillId }),
  listSkillAgents: (companyId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listSkillAgents, { companyId, skillId }),
  listAgentSkills: (companyId, agentId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listAgentSkills, { companyId, agentId }),
  listWakeupRequests: (input) => ipcRenderer.invoke(IPC_CHANNELS.listWakeupRequests, input),
  saveBudgetPolicy: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveBudgetPolicy, input),
  deleteBudgetPolicy: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteBudgetPolicy, input),
  listBudgetPolicies: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.listBudgetPolicies, { companyId }),
  listBudgetIncidents: (input) => ipcRenderer.invoke(IPC_CHANNELS.listBudgetIncidents, input),
  resolveBudgetIncident: (input) => ipcRenderer.invoke(IPC_CHANNELS.resolveBudgetIncident, input),
  getBudgetStatus: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getBudgetStatus, { companyId }),
  recoveryRetry: (taskId: string, agentId: string, companyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoveryRetry, { taskId, agentId, companyId }),
  recoveryDismiss: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoveryDismiss, { taskId }),
  recoveryFail: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoveryFail, { taskId }),
  getTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.getTask, input),
  getAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.getAgent, input),
  getRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRun, input),
  getApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.getApproval, input),
  listConfigRevisions: (companyId: string, agentId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listConfigRevisions, { companyId, agentId }),
  getConfigRevision: (companyId: string, revisionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getConfigRevision, { companyId, revisionId }),
  rollbackConfigRevision: (companyId: string, agentId: string, revisionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.rollbackConfigRevision, { companyId, agentId, revisionId }),
  listRunEvents: (companyId: string, runId: string, opts?: { offset?: number; limit?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.listRunEvents, { companyId, runId, ...opts }),
  getAgentPermissions: (agentId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getAgentPermissions, { agentId }),
  setAgentPermission: (companyId: string, agentId: string, permissionKey: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setAgentPermission, { companyId, agentId, permissionKey, enabled }),
  getHeartbeatPolicy: (agentId: string, companyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getHeartbeatPolicy, { companyId, agentId }),
  setHeartbeatPolicy: (companyId: string, agentId: string, policy: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.setHeartbeatPolicy, { companyId, agentId, ...policy }),
  getRuntimeState: (agentId: string, companyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getRuntimeState, { companyId, agentId }),
  setRuntimeState: (companyId: string, agentId: string, state: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.setRuntimeState, { companyId, agentId, state }),
  // Thread runtime
  createThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.createThread, input),
  listThreads: (input) => ipcRenderer.invoke(IPC_CHANNELS.listThreads, input),
  getThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.getThread, input),
  addThreadEvent: (input) => ipcRenderer.invoke(IPC_CHANNELS.addThreadEvent, input),
  listThreadEvents: (input) => ipcRenderer.invoke(IPC_CHANNELS.listThreadEvents, input),
  setThreadWaitState: (input) => ipcRenderer.invoke(IPC_CHANNELS.setThreadWaitState, input),
  resolveThreadWaitState: (input) => ipcRenderer.invoke(IPC_CHANNELS.resolveThreadWaitState, input),
  listThreadWaitStates: (input) => ipcRenderer.invoke(IPC_CHANNELS.listThreadWaitStates, input),
  listParticipants: (input) => ipcRenderer.invoke(IPC_CHANNELS.listParticipants, input),
  addParticipant: (input) => ipcRenderer.invoke(IPC_CHANNELS.addParticipant, input),
  removeParticipant: (input) => ipcRenderer.invoke(IPC_CHANNELS.removeParticipant, input),
  subscribeThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.subscribeThread, input),
  unsubscribeThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.unsubscribeThread, input),
  listSubscriptions: (input) => ipcRenderer.invoke(IPC_CHANNELS.listSubscriptions, input),
  listSubscribedThreads: (input) => ipcRenderer.invoke(IPC_CHANNELS.listSubscribedThreads, input),
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
  platform: process.platform as "win32" | "darwin" | "linux",
  windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized) as Promise<boolean>,
};

contextBridge.exposeInMainWorld("agentCompany", api);
