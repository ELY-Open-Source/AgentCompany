import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";
import { app } from "electron";

interface HostEnvironmentDependencies {
  iconPath: string;
  logger: {
    info: (...args: unknown[]) => void;
  };
}

/**
 * On Windows, Electron apps launched from installer shortcuts inherit a minimal PATH
 * that often lacks user-installed CLI tool directories. This function enriches
 * process.env.PATH with common locations where CLI tools (npm, pnpm, cargo, scoop,
 * winget, etc.) are typically installed.
 */
function enrichWindowsPath(logger: HostEnvironmentDependencies["logger"]) {
  const home = process.env.USERPROFILE ?? homedir();
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");

  const candidateDirs = [
    join(appData, "npm"),
    join(localAppData, "pnpm"),
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
    join(localAppData, "Programs", "Python", "Python312", "Scripts"),
    join(localAppData, "Programs", "Python", "Python311", "Scripts"),
    join(home, "scoop", "shims"),
    join(home, ".bun", "bin"),
    join(home, ".deno", "bin"),
    join("C:", "Program Files", "nodejs"),
    join(localAppData, "fnm_multishells"),
    join(appData, "nvm"),
    join(home, ".claude"),
    join(localAppData, "Claude"),
  ];

  const current = new Set(
    (process.env.PATH ?? "").split(pathDelimiter).map((entry) => entry.toLowerCase()),
  );
  const toAdd = candidateDirs.filter(
    (dir) => !current.has(dir.toLowerCase()) && existsSync(dir),
  );

  if (toAdd.length > 0) {
    process.env.PATH = [process.env.PATH, ...toAdd].filter(Boolean).join(pathDelimiter);
    logger.info(`[path] Windows: added ${toAdd.length} PATH entries: ${toAdd.join(", ")}`);
  }
}

export async function prepareHostEnvironment({
  iconPath,
  logger,
}: HostEnvironmentDependencies) {
  if (process.platform === "win32") {
    enrichWindowsPath(logger);
    app.setAppUserModelId("com.agentcompany.desktop");
  } else if (process.env.AGENTCOMPANY_ENABLE_SHELL_PATH_PROBE === "true") {
    try {
      const userShell = process.env.SHELL || "/bin/zsh";
      const shellPath = await new Promise<string>((resolve) => {
        const child = spawn(userShell, ["-ilc", "echo -n $PATH"], {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        let output = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on("close", () => resolve(output.trim()));
        child.on("error", () => resolve(""));
      });
      if (shellPath && shellPath.length > 0) {
        const current = new Set((process.env.PATH ?? "").split(pathDelimiter).filter(Boolean));
        const shellParts = shellPath.split(pathDelimiter).filter(Boolean);
        const toAdd = shellParts.filter((entry) => !current.has(entry));
        if (toAdd.length > 0) {
          process.env.PATH = [process.env.PATH, ...toAdd].join(pathDelimiter);
          logger.info(`[path] Added ${toAdd.length} shell PATH entries.`);
        }
      }
    } catch {
      // Non-fatal environment enrichment.
    }
  } else {
    logger.info("[path] Skipping interactive shell PATH probe; using deterministic PATH setup only.");
  }

  // Dock icon: macOS uses the .icns from the app bundle with the system squircle
  // mask applied automatically. Do not call dock.setIcon() — it bypasses the mask
  // and renders the raw PNG oversized and square.
}
