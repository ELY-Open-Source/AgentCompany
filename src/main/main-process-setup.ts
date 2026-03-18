import { delimiter as PATH_DELIMITER } from "node:path";
import { app, protocol } from "electron";

function listExtraPathEntries() {
  return (
    process.platform === "win32"
      ? [
          `${process.env.LOCALAPPDATA ?? ""}\\Programs`,
          `${process.env.APPDATA ?? ""}\\npm`,
          `${process.env.USERPROFILE ?? ""}\\.cargo\\bin`,
          `${process.env.USERPROFILE ?? ""}\\.local\\bin`,
          `${process.env.USERPROFILE ?? ""}\\.bun\\bin`,
        ]
      : [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          `${process.env.HOME}/.local/bin`,
          `${process.env.HOME}/.cargo/bin`,
          `${process.env.HOME}/.nvm/current/bin`,
          `${process.env.HOME}/.volta/bin`,
          `${process.env.HOME}/.bun/bin`,
          "/usr/local/sbin",
          "/snap/bin",
        ]
  ).filter((entry) => entry && !entry.includes("undefined"));
}

function prependCommonCliPaths() {
  const currentPath = process.env.PATH ?? "";
  const existing = new Set(currentPath.split(PATH_DELIMITER).filter(Boolean));
  const toAdd = listExtraPathEntries().filter((entry) => !existing.has(entry));
  if (toAdd.length === 0) {
    return;
  }
  process.env.PATH = [...toAdd, currentPath].join(PATH_DELIMITER);
}

function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

export function configureMainProcess(appName: string) {
  app.name = appName;
  app.enableSandbox();
  prependCommonCliPaths();
  registerPrivilegedSchemes();
}
