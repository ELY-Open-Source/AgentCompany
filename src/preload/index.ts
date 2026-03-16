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
  saveGoal: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveGoal, input),
  saveProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, input),
  saveTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveTask, input),
  requestApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.requestApproval, input),
  decideApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.decideApproval, input),
  saveSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSecret, input),
  startTaskRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.startTaskRun, input),
  cancelRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.cancelRun, input),
  getRunLog: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRunLog, input),
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
  addComment: (input) => ipcRenderer.invoke(IPC_CHANNELS.addComment, input),
  listComments: (input) => ipcRenderer.invoke(IPC_CHANNELS.listComments, input),
  setHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.setHeartbeat, input),
  triggerHeartbeat: (input) => ipcRenderer.invoke(IPC_CHANNELS.triggerHeartbeat, input),
  getApiPort: () => ipcRenderer.invoke(IPC_CHANNELS.getApiPort),
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld("agentCompany", api);
