import { createDesktopShellWindow, type DesktopShellWindowDependencies } from "./desktop-shell-window";
import { createDesktopShellMenu, type DesktopShellMenuDependencies } from "./desktop-shell-menu";

export type DesktopShellServiceDependencies = DesktopShellWindowDependencies & {
  registerHandle: DesktopShellMenuDependencies["registerHandle"];
};

export function createDesktopShellService(deps: DesktopShellServiceDependencies) {
  const window = createDesktopShellWindow(deps);
  const menu = createDesktopShellMenu({
    iconPath: deps.iconPath,
    isDev: deps.isDev,
    onCheckForUpdates: deps.onCheckForUpdates,
    onBackupProfile: deps.onBackupProfile,
    onShortcut: deps.onShortcut,
    getMainWindow: window.getMainWindow,
    ensureWindow: window.ensureWindow,
    requestQuitWithConfirmation: window.requestQuitWithConfirmation,
    registerHandle: deps.registerHandle,
  });

  function initialize() {
    window.installSecurityGuards();
    window.registerProtocol();
    menu.buildMenu();
    menu.createTray();
    menu.registerWindowControlIpc();
  }

  function destroy() {
    menu.destroy();
  }

  return {
    initialize,
    installSecurityGuards: window.installSecurityGuards,
    registerProtocol: window.registerProtocol,
    buildMenu: menu.buildMenu,
    createTray: menu.createTray,
    createWindow: window.createWindow,
    ensureWindow: window.ensureWindow,
    getMainWindow: window.getMainWindow,
    destroy,
  };
}
