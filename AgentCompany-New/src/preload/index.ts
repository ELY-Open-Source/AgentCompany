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
  createAgent: (input) => invoke(IPC_CHANNELS.createAgent, input),
  createTask: (input) => invoke(IPC_CHANNELS.createTask, input),
  updateTaskStatus: (input) => invoke(IPC_CHANNELS.updateTaskStatus, input),
  createApproval: (input) => invoke(IPC_CHANNELS.createApproval, input),
  decideApproval: (input) => invoke(IPC_CHANNELS.decideApproval, input),
  createChatSpace: (input) => invoke(IPC_CHANNELS.createChatSpace, input),
  sendMessage: (input) => invoke(IPC_CHANNELS.sendMessage, input),
  markChatSpaceRead: (input) => invoke(IPC_CHANNELS.markChatSpaceRead, input),
  saveProviderCredential: (input) => invoke(IPC_CHANNELS.saveProviderCredential, input),
  createProviderResponse: (input) => invoke(IPC_CHANNELS.createProviderResponse, input),
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
