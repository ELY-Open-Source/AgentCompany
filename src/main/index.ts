import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { configureMainProcess } from "./main-process-setup";
import { createMainRuntime } from "./main-runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));

configureMainProcess("AgentCompany");

const profileDir = process.env.AGENTCOMPANY_PROFILE_DIR ?? join(app.getPath("userData"), "profile");
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const devServerOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : null;
const hasSingleInstanceLock =
  process.env.AGENTCOMPANY_DISABLE_SINGLE_INSTANCE === "true"
    ? true
    : app.requestSingleInstanceLock();

const runtime = createMainRuntime({
  hasSingleInstanceLock,
  isDev,
  devServerOrigin,
  profileDir,
  windowStatePath: join(profileDir, "window-state.json"),
  preloadPath: join(__dirname, "../preload/index.js"),
  rendererDist: join(__dirname, "../renderer"),
  iconPath: resolve(__dirname, "../../assets/icon.png"),
  workerPath: join(__dirname, "worker.js"),
  devServerUrl: process.env.ELECTRON_RENDERER_URL,
});

if (hasSingleInstanceLock) {
  void runtime.bootstrap();
} else {
  app.quit();
}
