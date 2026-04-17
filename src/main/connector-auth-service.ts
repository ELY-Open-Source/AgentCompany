import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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

function writeWindowsBatchFile(lines: string[]): string {
  const fileName = `agent-company-${randomBytes(6).toString("hex")}.bat`;
  const batchPath = join(tmpdir(), fileName);
  writeFileSync(batchPath, lines.join("\r\n"), { encoding: "utf8" });
  return batchPath;
}

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

  // Linux — try $TERMINAL first, then a broad list of common emulators.
  // Supported list documented in docs/platform-support.md.
  const linuxCandidates: Array<[string, string[]]> = [];
  const envTerminal = process.env.TERMINAL?.trim();
  if (envTerminal) {
    linuxCandidates.push([envTerminal, ["-e", "sh", "-lc", script]]);
  }
  linuxCandidates.push(
    ["x-terminal-emulator", ["-e", "sh", "-lc", script]],
    ["gnome-terminal", ["--", "sh", "-lc", script]],
    ["konsole", ["-e", "sh", "-lc", script]],
    ["xfce4-terminal", ["-e", `sh -lc ${quoteShell(script)}`]],
    ["kitty", ["sh", "-lc", script]],
    ["alacritty", ["-e", "sh", "-lc", script]],
    ["wezterm", ["start", "--", "sh", "-lc", script]],
    ["tilix", ["-e", "sh", "-lc", script]],
    ["terminator", ["-e", `sh -lc ${quoteShell(script)}`]],
  );

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
    // Windows: emit a real .bat file instead of chaining commands with " & ".
    // Chaining via " & " means any unescaped "&" in an embedded field (title,
    // command, intro) would open a shell operator injection. A batch file has
    // one command per line and is not subject to that risk.
    const batchPath = writeWindowsBatchFile([
      `@echo off`,
      `echo ${spec.intro}`,
      `echo.`,
      `cd /d "${targetCwd}"`,
      spec.windowsCommand,
      `echo.`,
      `echo You can close this terminal after the login flow completes.`,
      `pause`,
    ]);
    return spawnTerminalWithScript(`"${batchPath}"`, spec.title, targetCwd);
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

const TERMINAL_COMMAND_MAP: Record<string, { title: string; unix: string | null; win32: string | null }> = {
  install_node_darwin: {
    title: "Install Node.js",
    unix: "brew install node@22",
    win32: null,
  },
  install_node_win32: {
    title: "Install Node.js",
    unix: null,
    win32: "winget install -e --id OpenJS.NodeJS.LTS",
  },
  install_node_linux: {
    title: "Install Node.js",
    unix: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash && \\. "$HOME/.nvm/nvm.sh" && nvm install 22`,
    win32: null,
  },
  install_claude_unix: {
    title: "Install Claude Code",
    unix: "curl -fsSL https://claude.ai/install.sh | bash",
    win32: null,
  },
  install_claude_win32: {
    title: "Install Claude Code",
    unix: null,
    win32: "irm https://claude.ai/install.ps1 | iex",
  },
  install_codex: {
    title: "Install Codex",
    unix: "npm i -g @openai/codex",
    win32: "npm i -g @openai/codex",
  },
  install_gemini: {
    title: "Install Gemini CLI",
    unix: "npm install -g @google/gemini-cli",
    win32: "npm install -g @google/gemini-cli",
  },
};

export async function openGenericTerminal(input: { commandKey: string }) {
  const spec = TERMINAL_COMMAND_MAP[input.commandKey];
  if (!spec) {
    throw new Error(`Unknown terminal command key: ${input.commandKey}`);
  }

  const cwd = process.env.HOME || homedir() || process.cwd();
  const command = process.platform === "win32" ? spec.win32 : spec.unix;
  if (!command) {
    throw new Error(`Command "${input.commandKey}" is not available on this platform.`);
  }

  if (process.platform === "win32") {
    const batchPath = writeWindowsBatchFile([
      `@echo off`,
      `echo AgentCompany - ${spec.title}`,
      `echo.`,
      `cd /d "${cwd}"`,
      command,
      `echo.`,
      `echo Done. You can close this terminal.`,
      `pause`,
    ]);
    return spawnTerminalWithScript(`"${batchPath}"`, spec.title, cwd);
  }

  const shell = process.env.SHELL || "/bin/zsh";
  const script = [
    "clear",
    `echo ${quoteShell(`AgentCompany — ${spec.title}`)}`,
    "echo",
    `cd ${quoteShell(cwd)}`,
    command,
    "echo",
    `echo ${quoteShell("Done. You can close this terminal.")}`,
    `exec ${quoteShell(shell)} -l`,
  ].join("; ");
  return spawnTerminalWithScript(script, spec.title, cwd);
}
