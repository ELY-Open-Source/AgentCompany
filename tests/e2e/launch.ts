import { resolve } from "node:path";

export function getElectronExecutablePath() {
  return resolve(process.cwd(), process.platform === "win32" ? "node_modules/.bin/electron.cmd" : "node_modules/.bin/electron");
}

export function getMainEntryPath() {
  return resolve(process.cwd(), "out/main/index.js");
}
