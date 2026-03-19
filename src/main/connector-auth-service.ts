import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import type { ConnectorId } from "@shared/types";

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeAppleScript(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function connectorAuthSpec(connectorId: ConnectorId, command: string) {
  switch (connectorId) {
    case "codex_local":
      return {
        title: "Codex Login",
        shellCommand: `${quoteShell(command)} login`,
        intro: "AgentCompany is opening the Codex login flow.",
      };
    case "claude_local":
      return {
        title: "Claude Code Login",
        shellCommand: `${quoteShell(command)} auth login`,
        intro: "AgentCompany is opening the Claude Code login flow.",
      };
    case "gemini_local":
      return {
        title: "Gemini CLI Login",
        shellCommand: `${quoteShell(command)}`,
        intro: "AgentCompany is opening Gemini CLI. If authentication is required, use /auth in the Gemini session.",
      };
  }
}

function buildTerminalCommand(connectorId: ConnectorId, command: string, cwd: string) {
  const spec = connectorAuthSpec(connectorId, command);
  const shell = process.env.SHELL || "/bin/zsh";
  const script = [
    "clear",
    `echo ${quoteShell(spec.intro)}`,
    "echo",
    `cd ${quoteShell(cwd)}`,
    spec.shellCommand,
    "echo",
    `echo ${quoteShell("You can close this terminal after the login flow completes.")}`,
    `exec ${quoteShell(shell)} -l`,
  ].join("; ");
  return { title: spec.title, script };
}

export async function openConnectorAuthTerminal(connectorId: ConnectorId, command: string, cwd?: string) {
  const targetCwd = cwd || process.env.HOME || homedir() || process.cwd();
  const { script } = buildTerminalCommand(connectorId, command, targetCwd);

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
    const spec = connectorAuthSpec(connectorId, command);
    const winScript = [
      `@echo off`,
      `echo ${spec.intro}`,
      `echo.`,
      `cd /d "${targetCwd}"`,
      spec.shellCommand,
      `echo.`,
      `echo You can close this terminal after the login flow completes.`,
      `pause`,
    ].join(" & ");
    const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", winScript], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return true;
  }

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

  throw new Error("No supported terminal application was found for connector login.");
}
