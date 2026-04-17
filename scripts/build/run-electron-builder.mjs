import { spawn } from "node:child_process";
import { hasExplicitArchArg } from "./emit-builder-config.mjs";

const filteredUnsignedMacWarningSnippets = [
  "skipped macOS code signing  reason=identity explicitly is set to null",
  "arm64 requires signing, but identity is set to null and signing is being skipped",
];

function resolveCurrentPlatformArg() {
  switch (process.platform) {
    case "darwin": return "--mac";
    case "win32": return "--win";
    default: return "--linux";
  }
}

function resolveCurrentArchArg() {
  switch (process.arch) {
    case "arm64": return "--arm64";
    case "x64": return "--x64";
    default: return null;
  }
}

function shouldSuppressBuildLine(line) {
  return filteredUnsignedMacWarningSnippets.some((snippet) => line.includes(snippet));
}

function forwardChildOutput(stream, writer) {
  if (!stream) return;
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!shouldSuppressBuildLine(line)) writer.write(`${line}\n`);
    }
  });
  stream.on("end", () => {
    if (!pending) return;
    if (!shouldSuppressBuildLine(pending)) writer.write(`${pending}\n`);
  });
}

export function buildElectronBuilderArgs({ runtimeConfigPath, extraArgs, publishMode, prepared }) {
  const explicitPublishArg = extraArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish="));
  const explicitPlatformArg = extraArgs.some((arg) =>
    arg === "--mac" || arg === "--win" || arg === "--linux" ||
    arg === "-m" || arg === "-w" || arg === "-l" ||
    arg.startsWith("--mac=") || arg.startsWith("--win=") || arg.startsWith("--linux="),
  );
  const explicitArchArg = hasExplicitArchArg(extraArgs);
  const { env, hasR2PublishConfig, resolvedUpdateUrl, hasMacSigningMaterial, isDirBuild } = prepared;
  const shouldForceLocalMacZip = (
    process.platform === "darwin" &&
    !hasMacSigningMaterial &&
    env.AGENTCOMPANY_ENABLE_LOCAL_DMG !== "true" &&
    !explicitPlatformArg &&
    !isDirBuild
  );

  if (publishMode !== "never" && !hasR2PublishConfig && !resolvedUpdateUrl) {
    throw new Error(
      "[build-desktop] Publishing requires either AGENTCOMPANY_UPDATE_URL (generic feed only) " +
      "or full Cloudflare R2 publish configuration.",
    );
  }

  const args = ["exec", "electron-builder", "--config", runtimeConfigPath];
  if (!explicitPublishArg) args.push("--publish", publishMode);
  if (!explicitPlatformArg) args.push(resolveCurrentPlatformArg());
  if (!explicitArchArg) {
    const currentArchArg = resolveCurrentArchArg();
    if (currentArchArg) args.push(currentArchArg);
  }
  if (shouldForceLocalMacZip) args.push("zip");
  args.push(...extraArgs);
  return args;
}

export function runElectronBuilder(builderArgs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", builderArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: process.platform === "win32",
    });
    forwardChildOutput(child.stdout, process.stdout);
    forwardChildOutput(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}
