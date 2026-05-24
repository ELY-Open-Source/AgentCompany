import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type { DesktopApi, RendererEvent } from "../shared/desktop-api";

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const api: DesktopApi = {
  loadSnapshot: () => invoke(IPC_CHANNELS.loadSnapshot),
  bootstrapOnboarding: (input) => invoke(IPC_CHANNELS.bootstrapOnboarding, input),
  createOrganization: (input) => invoke(IPC_CHANNELS.createOrganization, input),
  setActiveOrganization: (input) => invoke(IPC_CHANNELS.setActiveOrganization, input),
  deleteOrganization: (input) => invoke(IPC_CHANNELS.deleteOrganization, input),
  createAgent: (input) => invoke(IPC_CHANNELS.createAgent, input),
  createTask: (input) => invoke(IPC_CHANNELS.createTask, input),
  updateTaskStatus: (input) => invoke(IPC_CHANNELS.updateTaskStatus, input),
  runTask: (input) => invoke(IPC_CHANNELS.runTask, input),
  createApproval: (input) => invoke(IPC_CHANNELS.createApproval, input),
  decideApproval: (input) => invoke(IPC_CHANNELS.decideApproval, input),
  syncEmployeeIdentity: (input) => invoke(IPC_CHANNELS.syncEmployeeIdentity, input),
  grantRole: (input) => invoke(IPC_CHANNELS.grantRole, input),
  createChatSpace: (input) => invoke(IPC_CHANNELS.createChatSpace, input),
  sendMessage: (input) => invoke(IPC_CHANNELS.sendMessage, input),
  editMessage: (input) => invoke(IPC_CHANNELS.editMessage, input),
  deleteMessage: (input) => invoke(IPC_CHANNELS.deleteMessage, input),
  markChatSpaceRead: (input) => invoke(IPC_CHANNELS.markChatSpaceRead, input),
  saveProviderCredential: (input) => invoke(IPC_CHANNELS.saveProviderCredential, input),
  revokeProviderCredential: (input) => invoke(IPC_CHANNELS.revokeProviderCredential, input),
  launchProviderSignIn: (input) => invoke(IPC_CHANNELS.launchProviderSignIn, input),
  checkProviderHealth: (input) => invoke(IPC_CHANNELS.checkProviderHealth, input),
  updateProviderPolicy: (input) => invoke(IPC_CHANNELS.updateProviderPolicy, input),
  openExternalUrl: (url) => invoke(IPC_CHANNELS.openExternalUrl, url),
  createProviderResponse: (input) => invoke(IPC_CHANNELS.createProviderResponse, input),
  streamProviderResponse: (input) => invoke(IPC_CHANNELS.streamProviderResponse, input),
  cancelProviderResponse: (input) => invoke(IPC_CHANNELS.cancelProviderResponse, input),
  importSkillDirectory: (input) => invoke(IPC_CHANNELS.importSkillDirectory, input),
  bindSkill: (input) => invoke(IPC_CHANNELS.bindSkill, input),
  resolveAgentSkills: (input) => invoke(IPC_CHANNELS.resolveAgentSkills, input),
  createSocialAccount: (input) => invoke(IPC_CHANNELS.createSocialAccount, input),
  launchSocialLogin: (input) => invoke(IPC_CHANNELS.launchSocialLogin, input),
  createScheduledPost: (input) => invoke(IPC_CHANNELS.createScheduledPost, input),
  setScheduledPostState: (input) => invoke(IPC_CHANNELS.setScheduledPostState, input),
  importFile: (input) => invoke(IPC_CHANNELS.importFile, input),
  setFilePinned: (input) => invoke(IPC_CHANNELS.setFilePinned, input),
  createMigrationReport: (input) => invoke(IPC_CHANNELS.createMigrationReport, input),
  createRollbackSnapshot: (input) => invoke(IPC_CHANNELS.createRollbackSnapshot, input),
  setRollbackSnapshotActive: (input) => invoke(IPC_CHANNELS.setRollbackSnapshotActive, input),
  resolveMigrationReconciliation: (input) => invoke(IPC_CHANNELS.resolveMigrationReconciliation, input),
  setFeatureFlag: (input) => invoke(IPC_CHANNELS.setFeatureFlag, input),
  runChaosDrill: (input) => invoke(IPC_CHANNELS.runChaosDrill, input),
  runSdlcReview: (input) => invoke(IPC_CHANNELS.runSdlcReview, input),
  runEvalSuite: (input) => invoke(IPC_CHANNELS.runEvalSuite, input),
  setPrBotGate: (input) => invoke(IPC_CHANNELS.setPrBotGate, input),
  createComplianceExport: (input) => invoke(IPC_CHANNELS.createComplianceExport, input),
  createAuditReplay: (input) => invoke(IPC_CHANNELS.createAuditReplay, input),
  createLegalHold: (input) => invoke(IPC_CHANNELS.createLegalHold, input),
  setLegalHoldState: (input) => invoke(IPC_CHANNELS.setLegalHoldState, input),
  createRetentionFreeze: (input) => invoke(IPC_CHANNELS.createRetentionFreeze, input),
  setRetentionFreezeState: (input) => invoke(IPC_CHANNELS.setRetentionFreezeState, input),
  search: (input) => invoke(IPC_CHANNELS.search, input),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RendererEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
  },
  platform: process.platform as DesktopApi["platform"],
  windowMinimize: () => invoke<void>(IPC_CHANNELS.windowMinimize),
  windowMaximize: () => invoke<void>(IPC_CHANNELS.windowMaximize),
  windowClose: () => invoke<void>(IPC_CHANNELS.windowClose),
};

contextBridge.exposeInMainWorld("agentCompany", api);
