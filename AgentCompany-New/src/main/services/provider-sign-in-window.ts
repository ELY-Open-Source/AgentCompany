import { BrowserWindow, session } from "electron";

export interface LaunchProviderSignInWindowInput {
  providerId: string;
  label: string;
  signInUrl: string;
}

export function launchProviderSignInWindow(input: LaunchProviderSignInWindowInput): void {
  const partition = `persist:agentcompany-provider-${input.providerId}`;
  const providerSession = session.fromPartition(partition);
  providerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  providerSession.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: input.label,
    webPreferences: {
      session: providerSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  attachNavigationPolicy(win, input.signInUrl);
  win.loadURL(input.signInUrl);
}

function attachNavigationPolicy(win: BrowserWindow, signInUrl: string): void {
  const allowedHost = new URL(signInUrl).hostname.toLowerCase();
  const allow = (url: string) => {
    const host = new URL(url).hostname.toLowerCase();
    return host === allowedHost || host.endsWith(`.${allowedHost}`);
  };
  const blockOffHost = (event: Electron.Event, url: string) => {
    if (!allow(url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", blockOffHost);
  win.webContents.on("will-redirect", blockOffHost);
}
