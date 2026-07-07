import { BrowserWindow, session } from "electron";

export interface SocialLoginWindowInput {
  title: string;
  loginUrl: string;
  partitionKey: string;
  allowedHosts: string[];
  sandboxEnabled: boolean;
}

export type SocialLoginWindowLauncher = (input: SocialLoginWindowInput) => void;

export function openSocialLoginWindow(input: SocialLoginWindowInput): void {
  const socialSession = session.fromPartition(input.partitionKey);
  socialSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  socialSession.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: input.title,
    webPreferences: {
      session: socialSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: input.sandboxEnabled,
    },
  });
  attachNavigationPolicy(win, input.allowedHosts);
  win.loadURL(input.loginUrl);
}

function attachNavigationPolicy(win: BrowserWindow, allowedHosts: string[]): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guard = (event: Electron.Event, url: string) => {
    if (!isAllowedNavigation(allowedHosts, url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", guard);
  win.webContents.on("will-redirect", guard);
}

function isAllowedNavigation(allowedHosts: string[], url: string): boolean {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}
