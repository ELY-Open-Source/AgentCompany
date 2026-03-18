import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const patchScriptPath = join(__dirname, "patch-electron-name.sh");

if (process.platform !== "darwin") {
  console.log("[postinstall] Skipping macOS Electron plist patch on non-darwin host.");
  process.exit(0);
}

if (!existsSync(patchScriptPath)) {
  console.log("[postinstall] No Electron name patch script found.");
  process.exit(0);
}

const result = spawnSync("bash", [patchScriptPath], {
  cwd: dirname(__dirname),
  stdio: "inherit",
});

if (result.error) {
  console.warn(`[postinstall] Electron name patch failed: ${result.error.message}`);
  process.exit(0);
}

if ((result.status ?? 0) !== 0) {
  console.warn(`[postinstall] Electron name patch exited with status ${result.status}. Continuing install.`);
}

process.exit(0);
