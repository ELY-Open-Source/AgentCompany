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
  recoveryRetry: (taskId: string, agentId: string, companyId: string) =>
    ipcRenderer.invoke("recovery:retry", { taskId, agentId, companyId }),
  recoveryDismiss: (taskId: string) =>
    ipcRenderer.invoke("recovery:dismiss", { taskId }),
  recoveryFail: (taskId: string) =>
    ipcRenderer.invoke("recovery:fail", { taskId }),
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld("agentCompany", api);
