export function isMac(): boolean {
  return window.agentCompany.platform === "darwin";
}

export function cmdOrCtrlLabel(): string {
  return isMac() ? "Cmd" : "Ctrl";
}
