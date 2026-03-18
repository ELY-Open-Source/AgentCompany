import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

export function getElectronExecutablePath() {
  return require("electron");
}

export function getMainEntryPath() {
  return resolve(process.cwd(), "out/main/index.js");
}
