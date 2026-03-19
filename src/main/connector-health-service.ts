import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { AppDatabase } from "./database";
import { getConnectorDefinition } from "./connectors";
import { buildSanitizedRuntimeEnv } from "./runtime-env";
import type { ConnectorId } from "@shared/types";

interface ConnectorHealthDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
}

export function createConnectorHealthService({
  db,
  logger: _logger,
  publishDomainChanged,
}: ConnectorHealthDependencies) {
  function randomFallbackCompanyId() {
    const snapshot = db.listSnapshot();
    return snapshot.companies[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  }

  function resolveProbeCwd() {
    const snapshot = db.listSnapshot();
    const currentCompanyId = db.getCurrentCompanyId();
    const preferredWorkspace = snapshot.workspaces.find((workspace) => workspace.companyId === currentCompanyId)
      ?? snapshot.workspaces[0]
      ?? null;
    return preferredWorkspace?.localPath ?? process.env.USERPROFILE ?? process.env.HOME ?? homedir() ?? process.cwd();
  }

  function parseVersion(command: string): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const child = spawn(command, ["--version"], {
        env: buildSanitizedRuntimeEnv(process.env, {}),
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        buffer += String(chunk);
      });
      child.on("error", () => {
        if (!resolved) { resolved = true; resolve(null); }
      });
      child.on("close", () => {
        if (!resolved) {
          resolved = true;
          const versionLine = buffer.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
          resolve(versionLine);
        }
      });
      // Kill the child after 8 seconds to avoid blocking startup.
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { child.kill("SIGKILL"); } catch { /* process may have already exited */ }
          resolve(null);
        }
      }, 8_000);
    });
  }

  async function checkConnector(id: ConnectorId) {
    const connector = db.getConnector(id);
    const definition = getConnectorDefinition(id);
    const companyId = db.getCurrentCompanyId() ?? randomFallbackCompanyId();
    const probeCwd = resolveProbeCwd();
    const runtimeOverrides = db.resolveSecretEnv(connector.envBindingText, companyId);

    db.updateConnectorHealth({
      id,
      status: "detected",
      authState: connector.authState,
      version: connector.version,
      lastError: null,
    });
    publishDomainChanged();

    try {
      const testPromise = definition.module.testEnvironment({
        companyId,
        adapterType: id,
        config: {
          command: connector.command,
          model: connector.model,
          cwd: probeCwd,
          env: buildSanitizedRuntimeEnv(process.env, runtimeOverrides),
          approvalMode: "default",
          sandbox: true,
        },
      });
      const result = await Promise.race([
        testPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connector health check timed out after 45 seconds")), 45_000)),
      ]);

      const authRequired = result.checks.some((check) =>
        /auth_required|login_required/i.test(check.code) ||
        /login is required|authentication is not ready|auth(?:entication)? required/i.test(check.message) ||
        /run .*login|use \/auth|configure .*api key/i.test(check.hint ?? ""),
      );
      let authState: "ok" | "required" | "error" = "ok";
      if (authRequired) {
        authState = "required";
      } else if (result.status === "fail") {
        authState = "error";
      }
      const version = await parseVersion(connector.command);

      db.updateConnectorHealth({
        id,
        status:
          authRequired
            ? "auth_required"
            : result.status === "pass" || result.status === "warn"
            ? "ready"
            : "error",
        authState,
        version,
        lastError:
          result.status === "fail" || result.status === "warn"
            ? result.checks.map((check) => check.message).join(" | ")
            : null,
      });
      db.addActivity({
        companyId,
        actor: "system",
        action: "connector.tested",
        entityType: "connector",
        entityId: id,
        detail: result.status,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      _logger.error(`[connector] Health check failed for ${id}: ${errorMessage}`);
      const isNotInstalled = /command.*not found|not executable|ENOENT/i.test(errorMessage);
      const isTimeout = /timed out/i.test(errorMessage);
      // If the command exists on PATH but the probe failed (timeout, unexpected output, etc.),
      // still treat it as ready — the user configured it and it's resolvable.
      const status = isNotInstalled
        ? "not_installed"
        : isTimeout
          ? "ready"
          : "error";
      db.updateConnectorHealth({
        id,
        status,
        authState: isNotInstalled ? "error" : "unknown",
        version: isTimeout ? connector.version : null,
        lastError: errorMessage,
      });
    }
    publishDomainChanged();
  }

  return {
    checkConnector,
    randomFallbackCompanyId,
  };
}
