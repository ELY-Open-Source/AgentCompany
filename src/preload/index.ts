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
  listConnectorModels: (connectorId) => ipcRenderer.invoke(IPC_CHANNELS.listConnectorModels, connectorId),
  getConnectorDisabledModels: (connectorId) => ipcRenderer.invoke(IPC_CHANNELS.getConnectorDisabledModels, connectorId),
  setConnectorDisabledModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.setConnectorDisabledModels, input),
  addComment: (input) => ipcRenderer.invoke(IPC_CHANNELS.addComment, input),
  setHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.setHeartbeat, input),
  triggerHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.triggerHeartbeat, input),
  getCompanyMetrics: (input) => ipcRenderer.invoke(IPC_CHANNELS.getCompanyMetrics, input),
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
  searchMessages: (input) => ipcRenderer.invoke(IPC_CHANNELS.searchMessages, input),
  markMessageRead: (input) => ipcRenderer.invoke(IPC_CHANNELS.markMessageRead, input),
  saveWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveWorkflow, input),
  deleteWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteWorkflow, input),
  runWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.runWorkflow, input),
  importSkill: (companyId, source) =>
    ipcRenderer.invoke(IPC_CHANNELS.importSkill, { companyId, source }),
  listSkills: (companyId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listSkills, { companyId }),
  getSkillDetail: (companyId, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getSkillDetail, { companyId, skillId }),
  getSkillMarkdown: (companyId, slug) =>
    ipcRenderer.invoke(IPC_CHANNELS.getSkillMarkdown, { companyId, slug }),
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
  saveBudgetPolicy: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveBudgetPolicy, input),
  deleteBudgetPolicy: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteBudgetPolicy, input),
  listBudgetPolicies: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.listBudgetPolicies, { companyId }),
  listBudgetIncidents: (input) => ipcRenderer.invoke(IPC_CHANNELS.listBudgetIncidents, input),
  resolveBudgetIncident: (input) => ipcRenderer.invoke(IPC_CHANNELS.resolveBudgetIncident, input),
  getBudgetStatus: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getBudgetStatus, { companyId }),
  recoveryRetry: (taskId: string, agentId: string, companyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoveryRetry, { taskId, agentId, companyId }),
  recoveryFail: (taskId: string, companyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoveryFail, { taskId, companyId }),
  getTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.getTask, input),
  getAgent: (input) => ipcRenderer.invoke(IPC_CHANNELS.getAgent, input),
  getRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRun, input),
  getApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.getApproval, input),
  // Thread runtime (read-only)
  getThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.getThread, input),
  listThreadEvents: (input) => ipcRenderer.invoke(IPC_CHANNELS.listThreadEvents, input),
  listThreadWaitStates: (input) => ipcRenderer.invoke(IPC_CHANNELS.listThreadWaitStates, input),
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
  platform: process.platform as "win32" | "darwin" | "linux",
  windowMinimize: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowMinimize);
  },
  windowMaximize: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowMaximize);
  },
  windowClose: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowClose);
  },
  windowIsMaximized: async () => {
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized)) as { ok: true; data: boolean } | { ok: false };
    return result.ok ? result.data : false;
  },
  // Credentials (pi-mono)
  listCredentials: () => ipcRenderer.invoke(IPC_CHANNELS.credentialsList),
  saveCredential: (input) => ipcRenderer.invoke(IPC_CHANNELS.credentialsSave, input),
  removeCredential: (input) => ipcRenderer.invoke(IPC_CHANNELS.credentialsRemove, input),
  testCredential: (input) => ipcRenderer.invoke(IPC_CHANNELS.credentialsTest, input),
  // OAuth (pi-mono)
  startOAuth: (input) => ipcRenderer.invoke(IPC_CHANNELS.oauthStart, input),
  cancelOAuth: (input) => ipcRenderer.invoke(IPC_CHANNELS.oauthCancel, input),
  submitOAuthPrompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.oauthPromptResponse, input),
  submitOAuthManualCode: (input) => ipcRenderer.invoke(IPC_CHANNELS.oauthManualCodeResponse, input),
};

contextBridge.exposeInMainWorld("agentCompany", api);
