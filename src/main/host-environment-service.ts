import { spawn } from "node:child_process";
import { delimiter as pathDelimiter } from "node:path";
import { app, nativeImage } from "electron";

interface HostEnvironmentDependencies {
  iconPath: string;
  logger: {
    info: (...args: unknown[]) => void;
  };
}

export async function prepareHostEnvironment({
  iconPath,
  logger,
}: HostEnvironmentDependencies) {
  if (process.platform !== "win32" && process.env.AGENTCOMPANY_ENABLE_SHELL_PATH_PROBE === "true") {
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
  } else if (process.platform !== "win32") {
    logger.info("[path] Skipping interactive shell PATH probe; using deterministic PATH setup only.");
  }

  const appIcon = nativeImage.createFromPath(iconPath);
  if (!appIcon.isEmpty()) {
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
  }

  if (process.platform === "win32") {
    app.setAppUserModelId("com.agentcompany.desktop");
  }
}
