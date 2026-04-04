import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { normalizeCommandValue } from "@agentcompany/adapter-utils/server-utils";
import type { ConnectorId } from "@shared/types";

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeAppleScript(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteCmd(value: string) {
  const normalized = normalizeCommandValue(value);
  if (!normalized.length) return '""';
  const escaped = normalized.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

/* ------------------------------------------------------------------ */
/*  Shared terminal spawning — used by both auth and generic commands  */
/* ------------------------------------------------------------------ */

function spawnTerminalWithScript(script: string, _title: string, _cwd: string): boolean {
  if (process.platform === "darwin") {
    const appleScript = `tell application "Terminal" to do script "${escapeAppleScript(script)}"\ntell application "Terminal" to activate`;
    const child = spawn("osascript", ["-e", appleScript], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  }

  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", script], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return true;
  }

  // Linux — try multiple terminal emulators
  const linuxCandidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", "sh", "-lc", script]],
    ["gnome-terminal", ["--", "sh", "-lc", script]],
    ["konsole", ["-e", "sh", "-lc", script]],
    ["xfce4-terminal", ["-e", `sh -lc ${quoteShell(script)}`]],
  ];

  for (const [binary, args] of linuxCandidates) {
    const availability = spawnSync("sh", ["-lc", `command -v ${quoteShell(binary)}`], {
      stdio: "ignore",
    });
    if ((availability.status ?? 1) !== 0) {
      continue;
    }
    try {
      const child = spawn(binary, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    } catch {
      // Try next terminal candidate.
    }
  }

  throw new Error("No supported terminal application was found.");
}

/* ------------------------------------------------------------------ */
/*  Connector auth terminal (existing API — unchanged behavior)       */
/* ------------------------------------------------------------------ */

function connectorAuthSpec(connectorId: ConnectorId, command: string) {
  const normalizedCommand = normalizeCommandValue(command);
  switch (connectorId) {
    case "codex_local":
      return {
        title: "Codex Login",
        shellCommand: `${quoteShell(normalizedCommand)} login`,
        windowsCommand: `${quoteCmd(normalizedCommand)} login`,
        intro: "AgentCompany is opening the Codex login flow.",
      };
    case "claude_local":
      return {
        title: "Claude Code Login",
        shellCommand: `${quoteShell(normalizedCommand)} auth login`,
        windowsCommand: `${quoteCmd(normalizedCommand)} auth login`,
        intro: "AgentCompany is opening the Claude Code login flow.",
      };
    case "gemini_local":
      return {
        title: "Gemini CLI Login",
        shellCommand: `${quoteShell(normalizedCommand)}`,
        windowsCommand: quoteCmd(normalizedCommand),
        intro: "AgentCompany is opening Gemini CLI. If authentication is required, use /auth in the Gemini session.",
      };
  }
}

export async function openConnectorAuthTerminal(connectorId: ConnectorId, command: string, cwd?: string) {
  const targetCwd = cwd || process.env.HOME || homedir() || process.cwd();
  const spec = connectorAuthSpec(connectorId, command);
  if (!spec) return false;

  if (process.platform === "win32") {
    // Windows: build a CMD-compatible script directly
    const winScript = [
      `@echo off`,
      `echo ${spec.intro}`,
      `echo.`,
      `cd /d "${targetCwd}"`,
      spec.windowsCommand,
      `echo.`,
      `echo You can close this terminal after the login flow completes.`,
      `pause`,
    ].join(" & ");
    return spawnTerminalWithScript(winScript, spec.title, targetCwd);
  }

  // Unix: build a shell script
  const shell = process.env.SHELL || "/bin/zsh";
  const script = [
    "clear",
    `echo ${quoteShell(spec.intro)}`,
    "echo",
    `cd ${quoteShell(targetCwd)}`,
    spec.shellCommand,
    "echo",
    `echo ${quoteShell("You can close this terminal after the login flow completes.")}`,
    `exec ${quoteShell(shell)} -l`,
  ].join("; ");
  return spawnTerminalWithScript(script, spec.title, targetCwd);
}

/* ------------------------------------------------------------------ */
/*  Generic terminal command (for install flows, etc.)                 */
/* ------------------------------------------------------------------ */

export async function openGenericTerminal(input: { title: string; command: string }) {
  const cwd = process.env.HOME || homedir() || process.cwd();

  if (process.platform === "win32") {
    const winScript = [
      `@echo off`,
      `echo AgentCompany - ${input.title}`,
      `echo.`,
      `cd /d "${cwd}"`,
      input.command,
      `echo.`,
      `echo Done. You can close this terminal.`,
      `pause`,
    ].join(" & ");
    return spawnTerminalWithScript(winScript, input.title, cwd);
  }

  const shell = process.env.SHELL || "/bin/zsh";
  const script = [
    "clear",
    `echo ${quoteShell(`AgentCompany — ${input.title}`)}`,
    "echo",
    `cd ${quoteShell(cwd)}`,
    input.command,
    "echo",
    `echo ${quoteShell("Done. You can close this terminal.")}`,
    `exec ${quoteShell(shell)} -l`,
  ].join("; ");
  return spawnTerminalWithScript(script, input.title, cwd);
}
