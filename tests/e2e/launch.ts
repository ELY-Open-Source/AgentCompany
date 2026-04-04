import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const EXPERIMENTAL_WARNING_FLAG = "--disable-warning=ExperimentalWarning";

export function getElectronExecutablePath() {
  return require("electron");
}

export function getMainEntryPath() {
  return resolve(repoRoot, "out/main/index.js");
}

export function createElectronLaunchEnv(
  overrides: Record<string, string>,
) : Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  Object.assign(env, overrides);

  if (env.FORCE_COLOR && env.NO_COLOR) {
    delete env.NO_COLOR;
  }

  const existingNodeOptions = env.NODE_OPTIONS?.trim();
  if (!existingNodeOptions) {
    env.NODE_OPTIONS = EXPERIMENTAL_WARNING_FLAG;
    return env;
  }

  if (!existingNodeOptions.includes(EXPERIMENTAL_WARNING_FLAG)) {
    env.NODE_OPTIONS = `${existingNodeOptions} ${EXPERIMENTAL_WARNING_FLAG}`;
  }

  return env;
}
